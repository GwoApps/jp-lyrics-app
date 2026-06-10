import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { anonymizeEmail } from '@/lib/anonymize';
import type { Song } from '@/lib/types';

/** Strip email from song response, replace with anonymized name */
function sanitizeSong(song: Song) {
  return {
    ...song,
    created_by: undefined,
    created_by_name: anonymizeEmail(song.created_by),
  };
}

// GET /api/songs/[id] - get single song
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const song = await db.prepare('SELECT * FROM songs WHERE id = ?').get(id) as Song | undefined;
  if (!song) {
    return NextResponse.json({ error: '曲が見つかりません' }, { status: 404 });
  }
  return NextResponse.json(sanitizeSong(song));
}

// PUT /api/songs/[id] - update song
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  const { title, artist, lyrics_raw, lyrics_synced } = body;

  const existing = await db.prepare('SELECT * FROM songs WHERE id = ?').get(id) as Song | undefined;
  if (!existing) {
    return NextResponse.json({ error: '曲が見つかりません' }, { status: 404 });
  }

  let lyricsFurigana = existing.lyrics_furigana;
  const newRaw = lyrics_raw !== undefined ? lyrics_raw : existing.lyrics_raw;

  // Clear furigana when lyrics change — client will recompute via kuromoji-es
  if (lyrics_raw !== undefined && lyrics_raw !== existing.lyrics_raw) {
    lyricsFurigana = '[]';
  }

  const newSynced = lyrics_synced !== undefined ? lyrics_synced : existing.lyrics_synced;

  await db.prepare(
    `UPDATE songs SET title = ?, artist = ?, lyrics_raw = ?, lyrics_furigana = ?, lyrics_synced = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`
  ).run(
    title !== undefined ? title : existing.title,
    artist !== undefined ? artist : existing.artist,
    newRaw,
    lyricsFurigana,
    newSynced,
    id
  );

  const updated = await db.prepare('SELECT * FROM songs WHERE id = ?').get(id) as unknown as Song | undefined;
  if (!updated) {
    return NextResponse.json({ error: '曲が見つかりません' }, { status: 404 });
  }
  return NextResponse.json(sanitizeSong(updated));
}

// DELETE /api/songs/[id] - delete song
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const result = await db.prepare('DELETE FROM songs WHERE id = ?').run(id);
  if (result.rowsAffected === 0) {
    return NextResponse.json({ error: '曲が見つかりません' }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
