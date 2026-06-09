import { NextResponse, type NextRequest } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import db from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { getSpotifyTokenForUser } from '@/lib/spotify';

const LRCLIB_HEADERS = { 'User-Agent': 'jp-lyrics-app/1.0' };

function stripTimestamps(lrc: string): string {
  return lrc.replace(/^\[\d{2}:\d{2}\.\d{2,3}\]\s*/gm, '').trim();
}

function extractPlaylistId(input: string): string | null {
  const urlMatch = input.match(/spotify\.com\/playlist\/([a-zA-Z0-9]+)/);
  if (urlMatch) return urlMatch[1];
  const uriMatch = input.match(/spotify:playlist:([a-zA-Z0-9]+)/);
  if (uriMatch) return uriMatch[1];
  if (/^[a-zA-Z0-9]+$/.test(input)) return input;
  return null;
}

async function fetchLyrics(title: string, artist: string): Promise<{ synced: string; plain: string } | null> {
  async function fetchWithTimeout(url: string, timeoutMs = 10000): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { headers: LRCLIB_HEADERS, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  try {
    const params = new URLSearchParams({ track_name: title, artist_name: artist });
    const r = await fetchWithTimeout(`https://lrclib.net/api/get?${params}`);
    if (r.ok) {
      const d = await r.json();
      if (d.syncedLyrics) return { synced: d.syncedLyrics, plain: d.plainLyrics || stripTimestamps(d.syncedLyrics) };
    }
  } catch { /* */ }

  try {
    const params = new URLSearchParams({ q: `${title} ${artist}` });
    const r = await fetchWithTimeout(`https://lrclib.net/api/search?${params}`);
    if (r.ok) {
      const results = await r.json();
      for (const item of results) {
        if (item.syncedLyrics) return { synced: item.syncedLyrics, plain: item.plainLyrics || stripTimestamps(item.syncedLyrics) };
      }
    }
  } catch { /* */ }

  return null;
}

interface SpotifyTrack {
  name: string;
  artists: { name: string }[];
}

interface PlaylistResponse {
  items: { track: SpotifyTrack | null }[];
  next: string | null;
}

// POST /api/songs/import-playlist — batch import from Spotify playlist
export async function POST(request: NextRequest) {
  const user = getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'ログインが必要です' }, { status: 401 });
  }

  const { playlistUrl } = await request.json();
  const playlistId = extractPlaylistId(playlistUrl || '');
  if (!playlistId) {
    return NextResponse.json({ error: '有効なSpotifyプレイリストURLを入力してください' }, { status: 400 });
  }

  const accessToken = await getSpotifyTokenForUser(user.email);
  if (!accessToken) {
    return NextResponse.json({ error: 'Spotifyの接続が必要です' }, { status: 401 });
  }

  // Fetch playlist tracks from Spotify
  const tracks: { title: string; artist: string }[] = [];
  let nextUrl: string | null = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100&fields=items(track(name,artists(name))),next`;

  while (nextUrl) {
    const spotifyRes = await fetch(nextUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!spotifyRes.ok) {
      return NextResponse.json({ error: 'プレイリストの取得に失敗しました' }, { status: spotifyRes.status });
    }
    const data: PlaylistResponse = await spotifyRes.json();
    for (const item of data.items || []) {
      if (item.track?.name) {
        tracks.push({
          title: item.track.name,
          artist: item.track.artists?.map((a) => a.name).join(', ') || '',
        });
      }
    }
    nextUrl = data.next || null;
  }

  if (tracks.length === 0) {
    return NextResponse.json({ error: 'プレイリストが空です' }, { status: 400 });
  }

  // Import each track
  const results = { total: tracks.length, imported: 0, skipped: 0, failed: 0 };

  for (const track of tracks) {
    const existing = await db.prepare(
      'SELECT id FROM songs WHERE title = ? AND artist = ?'
    ).get(track.title, track.artist) as { id: string } | undefined;

    if (existing) {
      results.skipped++;
      continue;
    }

    const lyrics = await fetchLyrics(track.title, track.artist);

    const id = uuidv4();
    await db.prepare(
      'INSERT INTO songs (id, title, artist, lyrics_raw, lyrics_furigana, lyrics_synced, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(
      id,
      track.title,
      track.artist,
      lyrics?.plain || '',
      '[]',
      lyrics?.synced || '',
      user.email
    );

    if (lyrics) {
      results.imported++;
    } else {
      results.failed++;
    }
  }

  return NextResponse.json(results);
}
