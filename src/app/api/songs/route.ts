import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import db from '@/lib/db';
import { convertToFurigana } from '@/lib/kuroshiro';
import type { SongListItem } from '@/lib/types';

// GET /api/songs - list all songs
export async function GET() {
  const songs = db.prepare(
    'SELECT id, title, artist, created_at, updated_at FROM songs ORDER BY updated_at DESC'
  ).all() as SongListItem[];
  return NextResponse.json(songs);
}

// POST /api/songs - create a new song
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { title, artist, lyrics_raw } = body;

  if (!title) {
    return NextResponse.json({ error: '曲名は必須です' }, { status: 400 });
  }

  const id = uuidv4();
  let lyricsFurigana = '[]';

  if (lyrics_raw && lyrics_raw.trim()) {
    const furigana = await convertToFurigana(lyrics_raw);
    lyricsFurigana = JSON.stringify(furigana);
  }

  db.prepare(
    'INSERT INTO songs (id, title, artist, lyrics_raw, lyrics_furigana) VALUES (?, ?, ?, ?, ?)'
  ).run(id, title, artist || '', lyrics_raw || '', lyricsFurigana);

  const song = db.prepare('SELECT * FROM songs WHERE id = ?').get(id);
  return NextResponse.json(song, { status: 201 });
}
