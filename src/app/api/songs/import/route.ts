import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import db from '@/lib/db';
import { convertToFurigana } from '@/lib/kuroshiro';

const LRCLIB_HEADERS = { 'User-Agent': 'jp-lyrics-app/1.0' };

function stripTimestamps(lrc: string): string {
  return lrc.replace(/^\[\d{2}:\d{2}\.\d{2,3}\]\s*/gm, '').trim();
}

async function fetchLyrics(title: string, artist: string): Promise<{ synced: string; plain: string } | null> {
  // 1) Exact match
  try {
    const params = new URLSearchParams({ track_name: title, artist_name: artist });
    const res = await fetch(`https://lrclib.net/api/get?${params}`, { headers: LRCLIB_HEADERS });
    if (res.ok) {
      const data = await res.json();
      if (data.syncedLyrics) {
        return { synced: data.syncedLyrics, plain: data.plainLyrics || stripTimestamps(data.syncedLyrics) };
      }
    }
  } catch { /* */ }

  // 2) Fuzzy search
  try {
    const params = new URLSearchParams({ q: `${title} ${artist}` });
    const res = await fetch(`https://lrclib.net/api/search?${params}`, { headers: LRCLIB_HEADERS });
    if (res.ok) {
      const results = await res.json();
      for (const r of results) {
        if (r.syncedLyrics) {
          return { synced: r.syncedLyrics, plain: r.plainLyrics || stripTimestamps(r.syncedLyrics) };
        }
      }
    }
  } catch { /* */ }

  return null;
}

// POST /api/songs/import — one-click import from lrclib
export async function POST(request: Request) {
  const { title, artist } = await request.json();

  if (!title?.trim()) {
    return NextResponse.json({ error: '曲名を入力してください' }, { status: 400 });
  }

  const cleanTitle = title.trim();
  const cleanArtist = (artist || '').trim();

  // Check if already exists (exact match)
  const existing = db.prepare(
    'SELECT id FROM songs WHERE title = ? AND artist = ?'
  ).get(cleanTitle, cleanArtist) as { id: string } | undefined;

  if (existing) {
    return NextResponse.json({ id: existing.id, alreadyExists: true });
  }

  // Fetch lyrics from lrclib
  const result = await fetchLyrics(cleanTitle, cleanArtist);

  // Generate furigana
  let furigana: unknown[] = [];
  const plain = result?.plain || '';
  if (plain) {
    try {
      furigana = await convertToFurigana(plain);
    } catch (e) {
      console.error('Furigana conversion failed:', e);
    }
  }

  // Insert
  const id = uuidv4();
  db.prepare(
    'INSERT INTO songs (id, title, artist, lyrics_raw, lyrics_furigana, lyrics_synced) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, cleanTitle, cleanArtist, plain, JSON.stringify(furigana), result?.synced || '');

  return NextResponse.json({ id, alreadyExists: false, hasLyrics: !!result }, { status: 201 });
}
