import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { convertToFurigana } from '@/lib/kuroshiro';
import type { Song } from '@/lib/types';

// GET /api/songs/[id] - get single song
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const song = db.prepare('SELECT * FROM songs WHERE id = ?').get(id) as Song | undefined;
  if (!song) {
    return NextResponse.json({ error: '曲が見つかりません' }, { status: 404 });
  }
  return NextResponse.json(song);
}

// PUT /api/songs/[id] - update song
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  const { title, artist, lyrics_raw, lyrics_synced } = body;

  const existing = db.prepare('SELECT * FROM songs WHERE id = ?').get(id) as Song | undefined;
  if (!existing) {
    return NextResponse.json({ error: '曲が見つかりません' }, { status: 404 });
  }

  let lyricsFurigana = existing.lyrics_furigana;
  const newRaw = lyrics_raw !== undefined ? lyrics_raw : existing.lyrics_raw;

  // Re-convert if lyrics changed
  if (lyrics_raw !== undefined && lyrics_raw !== existing.lyrics_raw) {
    if (newRaw.trim()) {
      const furigana = await convertToFurigana(newRaw);
      lyricsFurigana = JSON.stringify(furigana);
    } else {
      lyricsFurigana = '[]';
    }
  }

  const newSynced = lyrics_synced !== undefined ? lyrics_synced : existing.lyrics_synced;

  db.prepare(
    `UPDATE songs SET title = ?, artist = ?, lyrics_raw = ?, lyrics_furigana = ?, lyrics_synced = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`
  ).run(
    title !== undefined ? title : existing.title,
    artist !== undefined ? artist : existing.artist,
    newRaw,
    lyricsFurigana,
    newSynced,
    id
  );

  const updated = db.prepare('SELECT * FROM songs WHERE id = ?').get(id);
  return NextResponse.json(updated);
}

// DELETE /api/songs/[id] - delete song
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const result = db.prepare('DELETE FROM songs WHERE id = ?').run(id);
  if (result.changes === 0) {
    return NextResponse.json({ error: '曲が見つかりません' }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
