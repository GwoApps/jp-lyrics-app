import { NextRequest, NextResponse } from 'next/server';
import { getDB, schema, sql } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { eq } from 'drizzle-orm';

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
  const { lyrics_furigana, reading_scheme } = body;

  if (!lyrics_furigana) {
    return NextResponse.json({ error: 'missing_furigana' }, { status: 400 });
  }
  if (reading_scheme !== undefined && reading_scheme !== 'ja-kana' && reading_scheme !== 'yue-jyutping') {
    return NextResponse.json({ error: 'invalid_reading_scheme' }, { status: 400 });
  }

  const existing = await db.select({
    id: schema.songs.id,
    createdBy: schema.songs.createdBy,
    readingScheme: schema.songs.readingScheme,
  }).from(schema.songs).where(eq(schema.songs.id, id)).get();
  if (!existing) {
    return NextResponse.json({ error: 'song_not_found' }, { status: 404 });
  }

  if (!user.isAdmin && existing.createdBy !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (reading_scheme !== undefined && reading_scheme !== existing.readingScheme) {
    return NextResponse.json({ error: 'stale_reading_scheme' }, { status: 409 });
  }

  const furiganaStr = typeof lyrics_furigana === 'string' ? lyrics_furigana : JSON.stringify(lyrics_furigana);

  await db.update(schema.songs).set({
    lyricsFurigana: furiganaStr,
    updatedAt: sql`(datetime('now', 'localtime'))`,
  }).where(eq(schema.songs.id, id));

  return NextResponse.json({ ok: true });
}
