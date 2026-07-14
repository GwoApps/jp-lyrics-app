import { NextRequest, NextResponse } from 'next/server';
import { getDB, schema, sql } from '@/lib/db';
import type { Song } from '@/lib/types';
import { getAuthUser } from '@/lib/auth';

/** Strip internal email from song response */
function sanitizeSong(song: Song) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { created_by, ...rest } = song;
  return rest;
}

// GET /api/songs/[id] - get single song
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(request);
  const db = getDB();
  const { id } = await params;
  const song = await db.get(sql`SELECT * FROM songs WHERE id = ${id}`) as unknown as Song | undefined;
  if (!song || (song.is_public !== 1 && !user?.isAdmin && song.created_by !== user?.id)) {
    return NextResponse.json({ error: 'song_not_found' }, { status: 404 });
  }
  return NextResponse.json(sanitizeSong(song));
}

// PUT /api/songs/[id] - update song
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'login_required' }, { status: 401 });
  }

  const db = getDB();
  const { id } = await params;
  const body = await request.json();
  const { title, artist, lyrics_raw, lyrics_synced } = body;

  const existing = await db.get(sql`SELECT * FROM songs WHERE id = ${id}`) as unknown as Song | undefined;
  if (!existing) {
    return NextResponse.json({ error: 'song_not_found' }, { status: 404 });
  }
  if (!user.isAdmin && existing.created_by !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  let lyricsFurigana = existing.lyrics_furigana;
  const newRaw = lyrics_raw !== undefined ? lyrics_raw : existing.lyrics_raw;

  // Clear furigana when lyrics change — client will recompute via kuromoji-es
  if (lyrics_raw !== undefined && lyrics_raw !== existing.lyrics_raw) {
    lyricsFurigana = '[]';
  }

  const newSynced = lyrics_synced !== undefined ? lyrics_synced : existing.lyrics_synced;

  await db.update(schema.songs).set({
    title: title !== undefined ? title : existing.title,
    artist: artist !== undefined ? artist : existing.artist,
    lyricsRaw: newRaw,
    lyricsFurigana,
    lyricsSynced: newSynced,
    updatedAt: sql`(datetime('now', 'localtime'))`,
  }).where(sql`id = ${id}`);

  const updated = await db.get(sql`SELECT * FROM songs WHERE id = ${id}`) as unknown as Song | undefined;
  if (!updated) {
    return NextResponse.json({ error: 'song_not_found' }, { status: 404 });
  }
  return NextResponse.json(sanitizeSong(updated));
}

// DELETE /api/songs/[id] - delete song
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'login_required' }, { status: 401 });
  }

  const db = getDB();
  const { id } = await params;
  const existing = await db.get(sql`SELECT id, created_by FROM songs WHERE id = ${id}`) as { id: string; created_by: string } | undefined;
  if (!existing) {
    return NextResponse.json({ error: 'song_not_found' }, { status: 404 });
  }
  if (!user.isAdmin && existing.created_by !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  await db.delete(schema.songs).where(sql`id = ${id}`);
  return NextResponse.json({ success: true });
}
