import { NextResponse, type NextRequest } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import db from '@/lib/db';
import { convertToFurigana } from '@/lib/kuroshiro';
import { getAuthUser } from '@/lib/auth';

const LRCLIB_HEADERS = { 'User-Agent': 'jp-lyrics-app/1.0' };

function stripTimestamps(lrc: string): string {
  return lrc.replace(/^\[\d{2}:\d{2}\.\d{2,3}\]\s*/gm, '').trim();
}

async function fetchLyrics(title: string, artist: string): Promise<{ synced: string; plain: string } | null> {
  async function fetchWithTimeout(url: string, timeoutMs = 15000): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { headers: LRCLIB_HEADERS, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  // 1) Exact match
  try {
    const params = new URLSearchParams({ track_name: title, artist_name: artist });
    const res = await fetchWithTimeout(`https://lrclib.net/api/get?${params}`);
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
    const res = await fetchWithTimeout(`https://lrclib.net/api/search?${params}`);
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
export async function POST(request: NextRequest) {
  const { title, artist } = await request.json();
  const user = getAuthUser(request);

  if (!title?.trim()) {
    return NextResponse.json({ error: '曲名を入力してください' }, { status: 400 });
  }

  const cleanTitle = title.trim();
  const cleanArtist = (artist || '').trim();

  // Check if already exists (exact match)
  const existing = await db.prepare(
    'SELECT id FROM songs WHERE title = ? AND artist = ?'
  ).get(cleanTitle, cleanArtist) as { id: string } | undefined;

  if (existing) {
    return NextResponse.json({ id: existing.id, alreadyExists: true });
  }

  // Fetch lyrics from lrclib
  const result = await fetchLyrics(cleanTitle, cleanArtist);

  if (!result) {
    return NextResponse.json({ error: '歌詞が見つかりませんでした — 手動で貼り付けてください', hasLyrics: false }, { status: 404 });
  }

  // Generate furigana
  let furigana: unknown[] = [];
  try {
    furigana = await convertToFurigana(result.plain);
  } catch (e) {
    console.error('Furigana conversion failed:', e);
  }

  // Insert
  const id = uuidv4();
  await db.prepare(
    'INSERT INTO songs (id, title, artist, lyrics_raw, lyrics_furigana, lyrics_synced, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, cleanTitle, cleanArtist, result.plain, JSON.stringify(furigana), result.synced || '', user?.email || '');

  return NextResponse.json({ id, alreadyExists: false, hasLyrics: true }, { status: 201 });
}
