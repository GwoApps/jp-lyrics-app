import { NextRequest, NextResponse } from 'next/server';
import { getDB, schema, sql } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { getAuthUser } from '@/lib/auth';
import { extractLyricsGlossary, getTranslationConfig, translateLyricLines, TranslationError, type GlossaryEntry } from '@/lib/translation';
import { getStoredTranslationConfig, resolveTranslationConfig } from '@/lib/translation-settings';
// POST /api/songs/[id]/translate — translate lyrics via the configured LLM provider and cache the result.
// Body: { force?: boolean, start?: number, count?: number }
//   - Without `start`: translate the whole song (cache hit short-circuits unless `force`).
//   - With `start`: translate only lines [start, start + count); the result is MERGED into the
//     stored cache so partial translations survive failures (resume/continue support).
// Response: { start, count, translations } — the translated slice, aligned to lyric lines.
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

  let body: { force?: boolean; start?: number; count?: number } = {};
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
  // Sliced requests never short-circuit: the client skips already-translated batches.
  const start = Math.max(0, body.start ?? 0);
  const isSlice = body.start !== undefined;
  if (!isSlice && !body.force && existing.lyricsTranslation) {
    try {
      const cached = JSON.parse(existing.lyricsTranslation);
      if (Array.isArray(cached) && cached.length > 0 && cached.every((item) => typeof item === 'string')) {
        return NextResponse.json({ start: 0, count: cached.length, translations: cached, cached: true });
      }
    } catch { /* fall through to re-translate */ }
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
    } catch { /* start empty */ }
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
    } catch { /* ignored */ }
  }
  if (!glossary && !isSlice) {
    glossary = await extractLyricsGlossary(existing.title, existing.artist, lines, config);
    await db.update(schema.songs).set({
      lyricsGlossary: JSON.stringify(glossary),
      updatedAt: sql`(datetime('now', 'localtime'))`,
    }).where(eq(schema.songs.id, id)).run();
  }

  let translations: string[];
  try {
    translations = uniqueLines.length > 0
      ? await translateLyricLines(uniqueLines, config, fetch, { title: existing.title, artist: existing.artist, glossary: glossary ?? undefined })
      : [];
  } catch (error) {
    if (error instanceof TranslationError) {
      return NextResponse.json(
        { error: error.code },
        { status: error.code === 'ai_quota_exceeded' ? 429 : 502 },
      );
    }
    console.error('[translate] unexpected error:', error);
    return NextResponse.json({ error: 'translation_failed' }, { status: 502 });
  }

  // Expand: fill duplicates from their first occurrence's result.
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

  // Merge the slice into the stored cache so partial progress survives failures.
  let merged: string[] = [];
  if (cache.length > 0) {
    merged = [...cache];
  }
  if (merged.length < lines.length) {
    merged = [...merged, ...Array(lines.length - merged.length).fill('')];
  }
  finalSlice.forEach((translation, i) => { merged[start + i] = translation; });

  await db.update(schema.songs).set({
    lyricsTranslation: JSON.stringify(merged),
    updatedAt: sql`(datetime('now', 'localtime'))`,
  }).where(eq(schema.songs.id, id)).run();

  return NextResponse.json({ start, count: finalSlice.length, translations: finalSlice, cached: false });
}
