import { NextRequest, NextResponse } from 'next/server';
import { getDB, schema, sql } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { getAuthUser } from '@/lib/auth';
import { extractLyricsGlossary, getTranslationConfig, streamTranslateLyricLines, translateLyricLines, TranslationError, type GlossaryEntry } from '@/lib/translation';
import { getStoredTranslationConfig, resolveTranslationConfig } from '@/lib/translation-settings';
import { extractCompletedArrayItems } from '@/lib/translation-progress';

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
    lyricsTranslationReasoning: schema.songs.lyricsTranslationReasoning,
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

  // Terminology: reuse a stored glossary, or extract one from the full song.
  // Three distinguishable states (see extractLyricsGlossary): a stored array
  // (possibly empty = genuinely no terms) is reused as-is; a stored `null`
  // means the last extraction FAILED, so it is retried on the next whole-song
  // request instead of being pinned to "no terms" forever.
  let glossary: GlossaryEntry[] | null = null;
  if (existing.lyricsGlossary) {
    try {
      const parsed = JSON.parse(existing.lyricsGlossary);
      if (Array.isArray(parsed)) {
        glossary = parsed as GlossaryEntry[];
      } else if (parsed === null) {
        // Last extraction failed — fall through and retry below.
        console.warn(`[translate] retrying glossary extraction for "${existing.title}" (previous attempt failed)`);
      }
    } catch (error) {
      // Damaged glossary — ignore and translate without terminology.
      console.warn(`[translate] stored glossary unparseable for "${existing.title}" — ${error instanceof Error ? error.message : String(error)}`);
      /* ignored */
    }
  }
  if (glossary === null && !isSlice) {
    const extracted = await extractLyricsGlossary(existing.title, existing.artist, lines, config);
    if (extracted !== null) {
      // Only persist a SUCCESSFUL extraction. A failure returns null and is
      // left unwritten, so the next whole-song translation retries it instead
      // of permanently pinning this song to an empty glossary.
      glossary = extracted;
      await db.update(schema.songs).set({
        lyricsGlossary: JSON.stringify(glossary),
        updatedAt: sql`(datetime('now', 'localtime'))`,
      }).where(eq(schema.songs.id, id)).run();
    } else {
      // Degrade to "no terminology" for THIS run only; extraction is retried
      // on the next request. Still observable in the logs for triage.
      console.warn(`[translate] glossary extraction failed for "${existing.title}" — translating without terminology; will retry next time`);
    }
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
  // emit live `progress` events ({ done, total }) so the client can show a
  // per-line counter, then a final `done` event with the aligned translations
  // array. On failure, whatever complete lines arrived before the error are
  // merged into the stored cache (resume support) and reported in the `error`
  // event so the client can offer a "continue" button with real numbers.
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
        const total = uniqueLines.length;
        // Reasoning text streamed so far — persisted on success AND on failure
        // so the user can review what the model thought before it finished
        // (or before it errored) from the song page later.
        let reasoningBuffer = '';
        // Slice-relative indices that still need the model; entries are filled
        // in as complete lines stream in (used for partial-cache persistence).
        const pending: number[] = [...needTranslation];
        let partial: string[] = [];
        const emitProgress = (translationText: string) => {
          const completed = extractCompletedArrayItems(translationText);
          partial = completed.slice(0, total);
          const done = Math.min(completed.length, total);
          if (done > 0) {
            send('progress', { done, total });
          }
        };
        try {
          const translations = total > 0
            ? await streamTranslateLyricLines(uniqueLines, config, (chunk) => {
              if (chunk.type === 'translation') emitProgress(chunk.text);
              else {
                reasoningBuffer += chunk.text;
                send(chunk.type, { text: chunk.text });
              }
            }, fetch, ctx, request.signal)
            : [];
          const finalSlice = expandAndMerge(translations);
          // Persist the model's reasoning together with the completed
          // translation so it survives a page reload / can be re-opened later.
          if (reasoningBuffer.trim()) {
            try {
              await db.update(schema.songs).set({
                lyricsTranslationReasoning: reasoningBuffer,
                updatedAt: sql`(datetime('now', 'localtime'))`,
              }).where(eq(schema.songs.id, id)).run();
            } catch (reasoningError) {
              console.warn('[translate] failed to persist reasoning:', reasoningError);
            }
          }
          send('done', { start, count: finalSlice.length, translations: finalSlice, cached: false });
        } catch (error) {
          // Client cancelled (cancel button or closed the page): the upstream
          // fetch was aborted via request.signal, so no AI quota is wasted.
          // Everything below reuses the failure path — persist streamed
          // reasoning + completed lines, then report done/total so the
          // client can offer the resume entry with real numbers.
          const cancelled = request.signal.aborted;
          let code = cancelled ? 'translation_cancelled' : 'translation_failed';
          if (error instanceof TranslationError && !cancelled) {
            code = error.code;
            console.error(`[translate] stream failed: ${error.code} — ${error.message}`);
          } else {
            if (cancelled) console.warn('[translate] stream cancelled by client');
            else console.error('[translate] stream error:', error);
          }
          // Persist the reasoning streamed before the failure so the user can
          // see how far the model got (quota / network / output diagnostics).
          if (reasoningBuffer.trim()) {
            try {
              await db.update(schema.songs).set({
                lyricsTranslationReasoning: reasoningBuffer,
                updatedAt: sql`(datetime('now', 'localtime'))`,
              }).where(eq(schema.songs.id, id)).run();
            } catch (reasoningMergeError) {
              console.warn('[translate] failed to persist partial reasoning:', reasoningMergeError);
            }
          }
          // Persist whatever complete lines streamed in before the failure so
          // a retry/continue skips them (partial-translation resume support).
          let partialDone = 0;
          if (partial.length > 0) {
            try {
              // Map partial line translations to their slice indices, then
              // merge into the stored cache through the same path as success.
              pending.forEach((sliceIndex, j) => {
                if (j < partial.length) resolved[sliceIndex] = partial[j];
              });
              // Duplicate copies reuse their first occurrence's translation
              // (or an earlier cached value) exactly like expandAndMerge.
              slice.forEach((line, i) => {
                if (resolved[i] !== null) return;
                const key = line.trim();
                if (!key) { resolved[i] = ''; return; }
                const first = firstOccurrence.get(key)!;
                const fromPartial = pending.indexOf(first - start);
                resolved[i] = fromPartial >= 0
                  ? (partial[fromPartial] ?? '')
                  : (first < cache.length ? cache[first] : '');
              });
              let merged: string[] = [];
              if (cache.length > 0) merged = [...cache];
              if (merged.length < lines.length) {
                merged = [...merged, ...Array(lines.length - merged.length).fill('')];
              }
              resolved.forEach((translation, i) => { if (translation) merged[start + i] = translation; });
              await db.update(schema.songs).set({
                lyricsTranslation: JSON.stringify(merged),
                updatedAt: sql`(datetime('now', 'localtime'))`,
              }).where(eq(schema.songs.id, id)).run();
              partialDone = partial.length;
            } catch (mergeError) {
              console.warn('[translate] failed to persist partial translation:', mergeError);
            }
          }
          send('error', { error: code, done: partialDone, total });
        } finally {
          // After a client disconnect (or a normal close) the stream may
          // already be closed — closing again throws, so swallow it.
          try { controller.close(); } catch { /* already closed */ }
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
