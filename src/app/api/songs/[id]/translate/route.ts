import { NextRequest, NextResponse } from 'next/server';
import { getDB, schema, sql } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { eq } from 'drizzle-orm';
import { getTranslationConfig, translateLyricLines, TranslationError } from '@/lib/translation';
import { getStoredTranslationConfig, resolveTranslationConfig } from '@/lib/translation-settings';
// POST /api/songs/[id]/translate — translate lyrics via the configured LLM provider and cache the result.
// Body: { force?: boolean, start?: number, count?: number }
//   - Without `start`: translate the whole song (cache hit short-circuits unless `force`).
//   - With `start`: translate only lines [start, start + count); the result is MERGED into the
//     stored cache so partial translations survive failures (resume/continue support).
// Response: { start, count, translations } — the translated slice, aligned to lyric lines.
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
    lyricsRaw: schema.songs.lyricsRaw,
    lyricsTranslation: schema.songs.lyricsTranslation,
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

  // Whole-song requests short-circuit on a valid cache unless force is set.
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

  const slice = lines.slice(start, body.count !== undefined && body.count > 0 ? start + body.count : undefined);
  if (slice.length === 0) {
    return NextResponse.json({ error: 'empty_lyrics' }, { status: 400 });
  }

  let translations: string[];
  try {
    translations = await translateLyricLines(slice, config);
  } catch (error) {
    if (error instanceof TranslationError) {
      return NextResponse.json({ error: error.code }, { status: 502 });
    }
    console.error('[translate] unexpected error:', error);
    return NextResponse.json({ error: 'translation_failed' }, { status: 502 });
  }

  // Merge the slice into the stored cache so partial progress survives failures.
  let merged: string[] = [];
  if (existing.lyricsTranslation) {
    try {
      const parsed = JSON.parse(existing.lyricsTranslation);
      if (Array.isArray(parsed)) merged = parsed.filter((item): item is string => typeof item === 'string');
    } catch { /* start from empty */ }
  }
  if (merged.length < lines.length) {
    merged = [...merged, ...Array(lines.length - merged.length).fill('')];
  }
  translations.forEach((translation, i) => { merged[start + i] = translation; });

  await db.update(schema.songs).set({
    lyricsTranslation: JSON.stringify(merged),
    updatedAt: sql`(datetime('now', 'localtime'))`,
  }).where(eq(schema.songs.id, id)).run();

  return NextResponse.json({ start, count: translations.length, translations, cached: false });
}
