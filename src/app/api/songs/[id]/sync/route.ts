import { NextResponse } from 'next/server';
import db from '@/lib/db';

interface LrcLine {
  timeMs: number;
  text: string;
}

/** Parse LRC format into structured timestamps */
function parseLrc(lrc: string): LrcLine[] {
  const lines: LrcLine[] = [];
  for (const raw of lrc.split('\n')) {
    const match = raw.match(/^\[(\d{2}):(\d{2})\.(\d{2,3})\]\s*(.*)$/);
    if (match) {
      const ms = parseInt(match[1]) * 60000 + parseInt(match[2]) * 1000 + parseInt(match[3].padEnd(3, '0'));
      const text = match[4].trim();
      if (text) lines.push({ timeMs: ms, text });
    }
  }
  return lines.sort((a, b) => a.timeMs - b.timeMs);
}

/** lrclib.net lookup */
async function fetchFromLrclib(title: string, artist: string): Promise<string | null> {
  const params = new URLSearchParams({ track_name: title, artist_name: artist });
  try {
    const res = await fetch(`https://lrclib.net/api/get?${params}`, {
      headers: { 'User-Agent': 'jp-lyrics-app/1.0' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    // Prefer synced lyrics, fall back to plain
    return data.syncedLyrics || null;
  } catch {
    return null;
  }
}

/** Spotify unofficial lyrics endpoint */
async function fetchFromSpotify(trackName: string, artistName: string): Promise<string | null> {
  const auth = db.prepare('SELECT access_token, refresh_token, expires_at FROM spotify_auth WHERE id = 1').get();
  if (!auth || !auth.access_token) return null;

  let accessToken = auth.access_token;

  // Refresh if expired
  if (Math.floor(Date.now() / 1000) > auth.expires_at - 60) {
    const { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET } = await import('@/lib/spotify');
    const refreshRes = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64')}`,
      },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: auth.refresh_token }),
    });
    if (!refreshRes.ok) return null;
    const refreshData = await refreshRes.json();
    accessToken = refreshData.access_token;
    db.prepare(`UPDATE spotify_auth SET access_token = ?, expires_at = ?, updated_at = datetime('now','localtime') WHERE id = 1`)
      .run(accessToken, Math.floor(Date.now() / 1000) + refreshData.expires_in);
  }

  // Search for track to get Spotify ID
  const searchRes = await fetch(
    `https://api.spotify.com/v1/search?q=${encodeURIComponent(`${trackName} ${artistName}`)}&type=track&limit=1`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!searchRes.ok) return null;
  const searchData = await searchRes.json();
  const trackId = searchData.tracks?.items?.[0]?.id;
  if (!trackId) return null;

  // Get lyrics from spclient
  const lyricsRes = await fetch(
    `https://spclient.wg.spotify.com/color-lyrics/v2/track/${trackId}?format=json&market=from_token`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!lyricsRes.ok) return null;
  const lyricsData = await lyricsRes.json();

  // Convert Spotify lines to LRC format
  const lines = lyricsData?.lyrics?.lines;
  if (!lines || !lines.length) return null;

  const lrcLines: string[] = [];
  for (const line of lines) {
    const ts = parseInt(line.startTimeMs);
    const min = Math.floor(ts / 60000);
    const sec = Math.floor((ts % 60000) / 1000);
    const ms = ts % 1000;
    lrcLines.push(`[${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(ms).padStart(3, '0')}] ${line.words}`);
  }
  return lrcLines.join('\n');
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const song = db.prepare('SELECT * FROM songs WHERE id = ?').get(id);
  if (!song) {
    return NextResponse.json({ error: '曲が見つかりません' }, { status: 404 });
  }

  // Already synced?
  if (song.lyrics_synced) {
    const parsed = parseLrc(song.lyrics_synced);
    return NextResponse.json({ synced: true, source: 'cached', lines: parsed.length, lrc: song.lyrics_synced });
  }

  // Try lrclib.net first
  let lrc = await fetchFromLrclib(song.title, song.artist);
  let source = 'lrclib';

  // Fallback to Spotify
  if (!lrc) {
    lrc = await fetchFromSpotify(song.title, song.artist);
    source = 'spotify';
  }

  if (!lrc) {
    return NextResponse.json({ synced: false, error: '同期歌詞が見つかりません' });
  }

  // Store
  db.prepare(`UPDATE songs SET lyrics_synced = ?, updated_at = datetime('now','localtime') WHERE id = ?`)
    .run(lrc, id);

  const parsed = parseLrc(lrc);
  return NextResponse.json({ synced: true, source, lines: parsed.length, lrc });
}
