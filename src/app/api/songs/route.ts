import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import db from '@/lib/db';
import { parseLrc } from '@/lib/lrc';
import { getAuthUser } from '@/lib/auth';
import { anonymizeEmail } from '@/lib/anonymize';
import type { SongListItem } from '@/lib/types';

// GET /api/songs - list songs with optional search and filter
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q')?.trim() || '';
  const mine = request.nextUrl.searchParams.get('mine') === '1';
  const favoritesOnly = request.nextUrl.searchParams.get('favorites') === '1';
  const user = getAuthUser(request);

  let sql = 'SELECT s.id, s.title, s.artist, s.created_by, s.created_at, s.updated_at FROM songs s';
  const conditions: string[] = [];
  const args: (string | number)[] = [];

  if (favoritesOnly) {
    if (!user) {
      return NextResponse.json([]);
    }
    sql += ' INNER JOIN favorites f ON f.song_id = s.id AND f.user_email = ?';
    args.push(user.email);
  }

  if (q) {
    conditions.push('(s.title LIKE ? OR s.artist LIKE ?)');
    const pattern = `%${q}%`;
    args.push(pattern, pattern);
  }
  if (mine && user) {
    conditions.push('s.created_by = ?');
    args.push(user.email);
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }
  sql += ' ORDER BY s.updated_at DESC';

  const songs = await db.prepare(sql).all(...args) as unknown as (SongListItem & { created_by: string })[];
  // Anonymize: replace email with short hash, add created_by_name
  const result = songs.map((s) => ({
    id: s.id,
    title: s.title,
    artist: s.artist,
    created_by_name: anonymizeEmail(s.created_by),
    created_at: s.created_at,
    updated_at: s.updated_at,
  }));
  return NextResponse.json(result);
}

// POST /api/songs - create a new song
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { title, artist, lyrics_raw, lyrics_synced } = body;
  const user = getAuthUser(request);

  if (!title) {
    return NextResponse.json({ error: '曲名は必須です' }, { status: 400 });
  }

  const id = uuidv4();

  // If LRC synced lyrics provided, strip timestamps to get raw text
  let rawLyrics = lyrics_raw || '';
  let syncedLyrics = lyrics_synced || '';
  if (syncedLyrics && !rawLyrics) {
    const parsed = parseLrc(syncedLyrics);
    rawLyrics = parsed.map((l) => l.text).join('\n');
  }

  await db.prepare(
    'INSERT INTO songs (id, title, artist, lyrics_raw, lyrics_furigana, lyrics_synced, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, title, artist || '', rawLyrics, '[]', syncedLyrics, user?.email || '');

  const song = await db.prepare('SELECT * FROM songs WHERE id = ?').get(id) as Record<string, unknown>;
  return NextResponse.json({
    ...song,
    created_by: undefined,
    created_by_name: anonymizeEmail(song.created_by as string),
  }, { status: 201 });
}
