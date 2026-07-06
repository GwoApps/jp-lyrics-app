import { NextResponse, type NextRequest } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { getDB, schema, sql } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { getSpotifyTokenForUser } from '@/lib/spotify';
import { fetchLyrics } from '@/lib/lyrics-fetcher';

interface SpotifyTrack {
  name: string;
  artists: { name: string }[];
}

interface PlaylistResponse {
  items: { track: SpotifyTrack | null }[];
  next: string | null;
}

function extractPlaylistId(input: string): string | null {
  const urlMatch = input.match(/spotify\.com\/playlist\/([a-zA-Z0-9]+)/);
  if (urlMatch) return urlMatch[1];
  const uriMatch = input.match(/spotify:playlist:([a-zA-Z0-9]+)/);
  if (uriMatch) return uriMatch[1];
  if (/^[a-zA-Z0-9]+$/.test(input)) return input;
  return null;
}

interface TrackResult {
  title: string;
  artist: string;
  status: 'imported' | 'skipped' | 'failed';
  source?: string;
  synced?: boolean;
}

// POST /api/songs/import-playlist — batch import from Spotify playlist
export async function POST(request: NextRequest) {
  const db = getDB();
  const user = await getAuthUser(request);
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

  // Look up Spotify display name once
  const nameRow = await db.select({ displayName: schema.spotifyAuth.displayName })
    .from(schema.spotifyAuth)
    .where(sql`user_email = ${user.email}`)
    .get();
  const createdByName = nameRow?.displayName || '';

  // Import each track — allow failures, continue on error
  const results: TrackResult[] = [];
  let imported = 0, skipped = 0, failed = 0;

  for (const track of tracks) {
    // Skip duplicates
    const existing = await db.select({ id: schema.songs.id })
      .from(schema.songs)
      .where(sql`title = ${track.title} AND artist = ${track.artist}`)
      .get();

    if (existing) {
      results.push({ title: track.title, artist: track.artist, status: 'skipped' });
      skipped++;
      continue;
    }

    // Fetch lyrics from all sources — failure is non-fatal
    let lyrics: { synced: string; plain: string } | null = null;
    let source = '';
    try {
      const r = await fetchLyrics(track.title, track.artist);
      lyrics = r.result;
      source = r.source;
    } catch {
      // Individual track failure — continue to next
    }

    try {
      const id = uuidv4();
      await db.insert(schema.songs).values({
        id,
        title: track.title,
        artist: track.artist,
        lyricsRaw: lyrics?.plain || '',
        lyricsFurigana: '[]',
        lyricsSynced: lyrics?.synced || '',
        createdBy: user.email,
        createdByName,
      });

      const synced = !!(lyrics?.synced);
      results.push({ title: track.title, artist: track.artist, status: 'imported', source, synced });
      imported++;
    } catch {
      results.push({ title: track.title, artist: track.artist, status: 'failed' });
      failed++;
    }
  }

  return NextResponse.json({
    total: tracks.length,
    imported,
    skipped,
    failed,
    tracks: results,
  });
}
