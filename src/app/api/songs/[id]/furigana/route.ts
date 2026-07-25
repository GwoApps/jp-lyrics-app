import { NextRequest, NextResponse } from 'next/server';
import { getDB, schema, sql } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { and, eq } from 'drizzle-orm';
import { validateFuriganaPayload } from '@/lib/furigana-validation';

// PUT /api/songs/[id]/furigana — save client-computed furigana to server
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const db = getDB();
  const { id } = await params;

  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'login_required' }, { status: 401 });
  }

  const body = await request.json();
  const { lyrics_furigana, reading_scheme, source_lyrics } = body;

  if (!Array.isArray(lyrics_furigana)) {
    return NextResponse.json({ error: 'missing_furigana' }, { status: 400 });
  }
  if (reading_scheme !== 'ja-kana' && reading_scheme !== 'yue-jyutping') {
    return NextResponse.json({ error: 'invalid_reading_scheme' }, { status: 400 });
  }
  if (typeof source_lyrics !== 'string') {
    return NextResponse.json({ error: 'missing_source_lyrics' }, { status: 400 });
  }

  const existing = await db.select({
    id: schema.songs.id,
    createdBy: schema.songs.createdBy,
    readingScheme: schema.songs.readingScheme,
    lyricsRaw: schema.songs.lyricsRaw,
  }).from(schema.songs).where(eq(schema.songs.id, id)).get();
  if (!existing) {
    return NextResponse.json({ error: 'song_not_found' }, { status: 404 });
  }

  if (!user.isAdmin && existing.createdBy !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (reading_scheme !== existing.readingScheme || source_lyrics !== existing.lyricsRaw) {
    return NextResponse.json({ error: 'stale_annotation_source' }, { status: 409 });
  }

  const validation = validateFuriganaPayload(lyrics_furigana, source_lyrics);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }
  const furiganaStr = JSON.stringify(validation.lines);

  const updated = await db.update(schema.songs).set({
    lyricsFurigana: furiganaStr,
    updatedAt: sql`(datetime('now', 'localtime'))`,
  }).where(and(
    eq(schema.songs.id, id),
    eq(schema.songs.readingScheme, reading_scheme),
    eq(schema.songs.lyricsRaw, source_lyrics),
  )).returning({ id: schema.songs.id }).get();

  if (!updated) {
    return NextResponse.json({ error: 'stale_annotation_source' }, { status: 409 });
  }

  return NextResponse.json({ ok: true });
}
