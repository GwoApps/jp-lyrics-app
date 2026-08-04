import { NextRequest, NextResponse } from 'next/server';
import { getDB, schema, sql } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { getAuthUser } from '@/lib/auth';
import { extractLyricsGlossary, getTranslationConfig, streamTranslateLyricLines, translateLyricLines, TranslationError, type GlossaryEntry } from '@/lib/translation';
import { getStoredTranslationConfig, resolveTranslationConfig } from '@/lib/translation-settings';

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
};
// POST /api/songs/[id]/translate — translate lyrics via the configured LLM provider and cache the result.
// Body: { force?: boolean, start?: number, count?: number, stream?: boolean }
//   - Without `start`: translate the whole song (cache hit short-circuits unless `force`).
//   - With `start`: translate only lines [start, start + count); the result is MERGED into the
//     stored cache so partial translations survive failures (resume/continue support).
//   - With `stream: true`: responds text/event-stream (SSE) — the provider's
//     reasoning/translation deltas are forwarded live as `reasoning` and
//     `translation` events, then a final `done` event carries the aligned
//     translations array. Errors arrive as `error` events.
// Response (non-stream): { start, count, translations } — the translated slice, aligned to lyric lines.
//
// Optimization: repeated lines (choruses) are translated once per distinct
// content — copies reuse the first occurrence's translation from the cache
// or from within the same batch. A terminology glossary extracted from the
// full song is attached to the prompt for consistent proper-noun rendering.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const db = getDB();
  const { id } = await params;

  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'login_required' }, { status: 401 });
  }

  let body: { force?: boolean; start?: number; count?: number; stream?: boolean } = {};
  try {
    body = await request.json();
  } catch { /* empty body is fine */ }

  const existing = await db.select({
    id: schema.songs.id,
    createdBy: schema.songs.createdBy,
    title: schema.songs.title,
    artist: schema.songs.artist,
    lyricsRaw: schema.songs.lyricsRaw,
    lyricsTranslation: schema.songs.lyricsTranslation,
    lyricsGlossary: schema.songs.lyricsGlossary,
  }).from(schema.songs).where(eq(schema.songs.id, id)).get();
  if (!existing) {
    return NextResponse.json({ error: 'song_not_found' }, { status: 404 });
  }
  if (!user.isAdmin && existing.createdBy !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // Effective config: admin-stored DB settings override environment variables.
  const stored = await getStoredTranslationConfig(db);
  const config = resolveTranslationConfig(stored, getTranslationConfig());
  if (!config) {
    return NextResponse.json({ error: 'translation_not_configured' }, { status: 503 });
  }

  const lines: string[] = existing.lyricsRaw.split('\n');
  if (!lines.some((line) => line.trim())) {
    return NextResponse.json({ error: 'empty_lyrics' }, { status: 400 });
  }

  // An empty array (the default '[]' placeholder) is NOT a valid cache — it means
  // the song was never translated, so fall through to real translation.
  // A cache only short-circuits when it is COMPLETE (line count aligned and
  // every non-empty source line has a translation). Partial caches fall
  // through so the whole-song request re-translates just the missing lines
  // (cache/dedup skip the rest) — one request, full-lyrics context.
  const start = Math.max(0, body.start ?? 0);
  const isSlice = body.start !== undefined;
  if (!isSlice && !body.force && existing.lyricsTranslation) {
    try {
      const cached = JSON.parse(existing.lyricsTranslation);
      if (Array.isArray(cached) && cached.length === lines.length
        && cached.every((item, i) => typeof item === 'string' && (lines[i].trim() ? item !== '' : true))) {
        if (body.stream === true) {
          const encoder = new TextEncoder();
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode(`event: done\ndata: ${JSON.stringify({ start: 0, count: cached.length, translations: cached, cached: true })}\n\n`));
              controller.close();
            },
          });
          return new Response(stream, { headers: SSE_HEADERS });
        }
        return NextResponse.json({ start: 0, count: cached.length, translations: cached, cached: true });
      }
    } catch (error) {
      // Damaged translation cache — re-translate instead.
      console.warn(`[translate] stored translation cache unparseable for "${existing.title}" — ${error instanceof Error ? error.message : String(error)}`);
      /* fall through to re-translate */
    }
  }

  const end = body.count !== undefined && body.count > 0 ? start + body.count : undefined;
  const slice = lines.slice(start, end);
  if (slice.length === 0) {
    return NextResponse.json({ error: 'empty_lyrics' }, { status: 400 });
  }

  // Existing cache (may be partial).
  let cache: string[] = [];
  if (existing.lyricsTranslation) {
    try {
      const parsed = JSON.parse(existing.lyricsTranslation);
      if (Array.isArray(parsed)) cache = parsed.filter((item): item is string => typeof item === 'string');
    } catch (error) {
      // Damaged cache — start from an empty seed.
      console.warn(`[translate] stored translation cache unparseable (slice) — ${error instanceof Error ? error.message : String(error)}`);
      /* start empty */
    }
  }

  // Dedup: map each distinct non-empty line to its first occurrence (whole song),
  // so repeated lines reuse one translation instead of burning tokens per copy.
  const firstOccurrence = new Map<string, number>();
  lines.forEach((line, i) => {
    const key = line.trim();
    if (key && !firstOccurrence.has(key)) firstOccurrence.set(key, i);
  });

  const needTranslation: number[] = []; // slice-relative indices of lines to send to the model
  const resolved: (string | null)[] = Array(slice.length).fill(null);
  slice.forEach((line, i) => {
    const key = line.trim();
    if (!key) {
      resolved[i] = ''; // empty source → empty translation
      return;
    }
    const first = firstOccurrence.get(key)!;
    const cachedTr = first < cache.length ? cache[first] : '';
    if (cachedTr) {
      resolved[i] = cachedTr; // already translated (this line or its duplicate)
      return;
    }
    if (first === start + i) {
      needTranslation.push(i); // first occurrence within this batch → translate
    } else if (first >= start && first < start + slice.length) {
      // Duplicate of a line earlier in this same batch → copied after translation.
    } else if (first < start && first < cache.length && cache[first] !== '') {
      resolved[i] = cache[first]; // duplicate of an earlier cached line
    } else {
      // First occurrence is outside this batch and untranslated (partial
      // translation edge case) — translate this copy as the representative.
      needTranslation.push(i);
    }
  });

  // Only the distinct lines actually hit the model.
  const uniqueLines = needTranslation.map((i) => slice[i]);

  // Terminology: reuse a stored glossary, or extract one from the full song
  // (best-effort; failure just means translation without terminology).
  let glossary: GlossaryEntry[] | null = null;
  if (existing.lyricsGlossary) {
    try {
      const parsed = JSON.parse(existing.lyricsGlossary);
      if (Array.isArray(parsed)) glossary = parsed as GlossaryEntry[];
    } catch (error) {
      // Damaged glossary — ignore and translate without terminology.
      console.warn(`[translate] stored glossary unparseable for "${existing.title}" — ${error instanceof Error ? error.message : String(error)}`);
      /* ignored */
    }
  }
  if (!glossary && !isSlice) {
    glossary = await extractLyricsGlossary(existing.title, existing.artist, lines, config);
    await db.update(schema.songs).set({
      lyricsGlossary: JSON.stringify(glossary),
      updatedAt: sql`(datetime('now', 'localtime'))`,
    }).where(eq(schema.songs.id, id)).run();
  }

  const ctx = { title: existing.title, artist: existing.artist, glossary: glossary ?? undefined };

  // Expand duplicates from their first occurrence's result, merge into the
  // stored cache, persist, and return the final line-aligned slice.
  const expandAndMerge = (translations: string[]): string[] => {
    const bySliceIndex = new Map<number, string>();
    needTranslation.forEach((sliceIndex, j) => { bySliceIndex.set(sliceIndex, translations[j] ?? ''); });
    slice.forEach((line, i) => {
      if (resolved[i] !== null) return;
      const key = line.trim();
      if (!key) { resolved[i] = ''; return; }
      const first = firstOccurrence.get(key)!;
      const fromBatch = bySliceIndex.get(first - start);
      resolved[i] = fromBatch ?? (first < cache.length ? cache[first] : '');
    });
    const finalSlice = resolved.map((v) => v ?? '');

    let merged: string[] = [];
    if (cache.length > 0) {
      merged = [...cache];
    }
    if (merged.length < lines.length) {
      merged = [...merged, ...Array(lines.length - merged.length).fill('')];
    }
    finalSlice.forEach((translation, i) => { merged[start + i] = translation; });

    void db.update(schema.songs).set({
      lyricsTranslation: JSON.stringify(merged),
      updatedAt: sql`(datetime('now', 'localtime'))`,
    }).where(eq(schema.songs.id, id)).run();

    return finalSlice;
  };

  // Streaming mode: forward the provider's reasoning/translation deltas live,
  // then emit a final `done` event with the aligned translations array.
  if (body.stream === true) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: string, data: unknown) => {
          try {
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          } catch {
            // Client disconnected mid-stream (page closed) — stop sending.
          }
        };
        try {
          const translations = uniqueLines.length > 0
            ? await streamTranslateLyricLines(uniqueLines, config, (chunk) => send(chunk.type, { text: chunk.text }), fetch, ctx)
            : [];
          const finalSlice = expandAndMerge(translations);
          send('done', { start, count: finalSlice.length, translations: finalSlice, cached: false });
        } catch (error) {
          if (error instanceof TranslationError) {
            console.error(`[translate] stream failed: ${error.code} — ${error.message}`);
            send('error', { error: error.code });
          } else {
            console.error('[translate] stream error:', error);
            send('error', { error: 'translation_failed' });
          }
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, { headers: SSE_HEADERS });
  }

  // Non-streaming path (unchanged behaviour).
  let translations: string[];
  try {
    translations = uniqueLines.length > 0
      ? await translateLyricLines(uniqueLines, config, fetch, ctx)
      : [];
  } catch (error) {
    if (error instanceof TranslationError) {
      if (error.code === 'ai_quota_exceeded') {
        // Expected daily-cap behaviour, but still observable in logs.
        console.warn(`[translate] daily AI quota exceeded — ${error.message}`);
      } else {
        console.error(`[translate] failed: ${error.code} — ${error.message}`);
      }
      return NextResponse.json(
        { error: error.code },
        { status: error.code === 'ai_quota_exceeded' ? 429 : 502 },
      );
    }
    console.error('[translate] unexpected error:', error);
    return NextResponse.json({ error: 'translation_failed' }, { status: 502 });
  }

  const finalSlice = expandAndMerge(translations);
  return NextResponse.json({ start, count: finalSlice.length, translations: finalSlice, cached: false });
}
