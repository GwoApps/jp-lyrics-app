import { NextRequest, NextResponse } from 'next/server';
import { getDB, schema, sql } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { eq } from 'drizzle-orm';
import { getTranslationConfig, isTranslationConfigured, translateLyricLines, TranslationError } from '@/lib/translation';
// POST /api/songs/[id]/translate — translate lyrics via the configured LLM provider and cache the result.
// Body: { force?: boolean } — force re-translation, skipping the cached result.
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

  let body: { force?: boolean } = {};
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

  if (!isTranslationConfigured()) {
    return NextResponse.json({ error: 'translation_not_configured' }, { status: 503 });
  }
  const config = getTranslationConfig()!;

  // Cache hit: return existing translation unless force is requested.
  // An empty array (the default '[]' placeholder) is NOT a valid cache — it means
  // the song was never translated, so fall through to real translation.
  if (!body.force && existing.lyricsTranslation) {
    try {
      const cached = JSON.parse(existing.lyricsTranslation);
      if (Array.isArray(cached) && cached.length > 0 && cached.every((item) => typeof item === 'string')) {
        return NextResponse.json({ translations: cached, cached: true });
      }
    } catch { /* fall through to re-translate */ }
  }

  const lines: string[] = existing.lyricsRaw.split('\n');
  if (!lines.some((line) => line.trim())) {
    return NextResponse.json({ error: 'empty_lyrics' }, { status: 400 });
  }

  let translations: string[];
  try {
    translations = await translateLyricLines(lines, config);
  } catch (error) {
    if (error instanceof TranslationError) {
      return NextResponse.json({ error: error.code }, { status: 502 });
    }
    console.error('[translate] unexpected error:', error);
    return NextResponse.json({ error: 'translation_failed' }, { status: 502 });
  }

  await db.update(schema.songs).set({
    lyricsTranslation: JSON.stringify(translations),
    updatedAt: sql`(datetime('now', 'localtime'))`,
  }).where(eq(schema.songs.id, id)).run();

  return NextResponse.json({ translations, cached: false });
}
