import { NextResponse, type NextRequest } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { getDB, schema, sql } from '@/lib/db';
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
  const db = getDB();
  const { title, artist } = await request.json();
  const user = await getAuthUser(request);

  if (!title?.trim()) {
    return NextResponse.json({ error: 'title_required' }, { status: 400 });
  }

  const cleanTitle = title.trim();
  const cleanArtist = (artist || '').trim();

  // Check if already exists (exact match)
  const existing = await db.select({ id: schema.songs.id })
    .from(schema.songs)
    .where(sql`title = ${cleanTitle} AND artist = ${cleanArtist}`)
    .get();

  if (existing) {
    return NextResponse.json({ id: existing.id, alreadyExists: true });
  }

  // Fetch lyrics from lrclib
  const result = await fetchLyrics(cleanTitle, cleanArtist);

  if (!result) {
    return NextResponse.json({ error: 'lyrics_not_found', hasLyrics: false }, { status: 404 });
  }

  // Insert
  const id = uuidv4();
  const createdBy = user?.email || '';
  // Look up Spotify display name
  let createdByName = '';
  if (user) {
    const row = await db.select({ displayName: schema.spotifyAuth.displayName })
      .from(schema.spotifyAuth)
      .where(sql`user_email = ${user.email}`)
      .get();
    createdByName = row?.displayName || '';
  }
  await db.insert(schema.songs).values({
    id,
    title: cleanTitle,
    artist: cleanArtist,
    lyricsRaw: result.plain,
    lyricsFurigana: '[]',
    lyricsSynced: result.synced || '',
    createdBy,
    createdByName,
  });

  return NextResponse.json({ id, alreadyExists: false, hasLyrics: true }, { status: 201 });
}
