import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import db from '@/lib/db';
import { convertToFurigana } from '@/lib/kuroshiro';
import { getAuthUser } from '@/lib/auth';
import type { SongListItem } from '@/lib/types';

// GET /api/songs - list songs with optional search and filter
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q')?.trim() || '';
  const mine = request.nextUrl.searchParams.get('mine') === '1';
  const user = getAuthUser(request);

  let sql = 'SELECT id, title, artist, created_by, created_at, updated_at FROM songs';
  const conditions: string[] = [];
  const args: string[] = [];

  if (q) {
    conditions.push('(title LIKE ? OR artist LIKE ?)');
    const pattern = `%${q}%`;
    args.push(pattern, pattern);
  }
  if (mine && user) {
    conditions.push('created_by = ?');
    args.push(user.email);
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }
  sql += ' ORDER BY updated_at DESC';

  const songs = db.prepare(sql).all(...args) as SongListItem[];
  return NextResponse.json(songs);
}

// POST /api/songs - create a new song
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { title, artist, lyrics_raw } = body;
  const user = getAuthUser(request);

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
    'INSERT INTO songs (id, title, artist, lyrics_raw, lyrics_furigana, created_by) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, title, artist || '', lyrics_raw || '', lyricsFurigana, user?.email || '');

  const song = db.prepare('SELECT * FROM songs WHERE id = ?').get(id);
  return NextResponse.json(song, { status: 201 });
}
