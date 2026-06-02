import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET } from '@/lib/spotify';
import { convertToFurigana } from '@/lib/kuroshiro';

interface LrcLine {
  timeMs: number;
  text: string;
}

interface LyricsResult {
  synced: string;
  plain: string;
}

function stripTimestamps(lrc: string): string {
  return lrc.replace(/^\[\d{2}:\d{2}\.\d{2,3}\]\s*/gm, '').trim();
}

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

function normalize(s: string): string {
  return s.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
}

function fuzzyMatch(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  if (na.includes(nb) || nb.includes(na)) return true;
  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length > nb.length ? na : nb;
  let hits = 0;
  for (const ch of shorter) { if (longer.includes(ch)) hits++; }
  return hits / shorter.length >= 0.5;
}

/** Get a valid Spotify access token (refresh if needed) */
async function getSpotifyToken(): Promise<string | null> {
  const auth = db.prepare('SELECT access_token, refresh_token, expires_at FROM spotify_auth WHERE id = 1').get();
  if (!auth || !auth.access_token) return null;

  if (Math.floor(Date.now() / 1000) > auth.expires_at - 60) {
    const refreshRes = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64')}`,
      },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: auth.refresh_token }),
    });
    if (!refreshRes.ok) return null;
    const data = await refreshRes.json();
    db.prepare(`UPDATE spotify_auth SET access_token = ?, expires_at = ?, updated_at = datetime('now','localtime') WHERE id = 1`)
      .run(data.access_token, Math.floor(Date.now() / 1000) + data.expires_in);
    return data.access_token;
  }
  return auth.access_token;
}

/** Use Spotify search to get the canonical track name */
async function getSpotifyCanonicalName(title: string, artist: string): Promise<{ name: string; artist: string } | null> {
  const token = await getSpotifyToken();
  if (!token) return null;

  const searchRes = await fetch(
    `https://api.spotify.com/v1/search?q=${encodeURIComponent(`${title} ${artist}`)}&type=track&limit=3`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!searchRes.ok) return null;
  const data = await searchRes.json();
  const tracks = data.tracks?.items || [];

  for (const t of tracks) {
    if (fuzzyMatch(t.name, title)) {
      return { name: t.name, artist: t.artists?.[0]?.name || artist };
    }
  }
  return null;
}

/** lrclib.net: exact get → search with canonical name → search with artist */
async function fetchFromLrclib(title: string, artist: string): Promise<LyricsResult | null> {
  const headers = { 'User-Agent': 'jp-lyrics-app/1.0' };

  function toResult(data: { syncedLyrics?: string; plainLyrics?: string }): LyricsResult | null {
    if (!data.syncedLyrics) return null;
    return { synced: data.syncedLyrics, plain: data.plainLyrics || stripTimestamps(data.syncedLyrics) };
  }

  // 1) Exact match
  try {
    const params = new URLSearchParams({ track_name: title, artist_name: artist });
    const res = await fetch(`https://lrclib.net/api/get?${params}`, { headers });
    if (res.ok) {
      const data = await res.json();
      const r = toResult(data);
      if (r) return r;
    }
  } catch { /* */ }

  // 2) Search with canonical Spotify name (fixes CJK variant issues)
  const canonical = await getSpotifyCanonicalName(title, artist);
  if (canonical && canonical.name !== title) {
    try {
      const params = new URLSearchParams({ q: `${canonical.name} ${canonical.artist}` });
      const res = await fetch(`https://lrclib.net/api/search?${params}`, { headers });
      if (res.ok) {
        const results = await res.json();
        for (const item of results) {
          if (item.syncedLyrics && fuzzyMatch(item.trackName, canonical.name)) {
            return toResult(item);
          }
        }
      }
    } catch { /* */ }
  }

  // 3) Broader search with original title
  try {
    const params = new URLSearchParams({ q: `${title} ${artist}` });
    const res = await fetch(`https://lrclib.net/api/search?${params}`, { headers });
    if (res.ok) {
      const results = await res.json();
      for (const item of results) {
        if (item.syncedLyrics && fuzzyMatch(item.trackName, title)) {
          return toResult(item);
        }
      }
    }
  } catch { /* */ }

  return null;
}

/** Spotify unofficial lyrics endpoint */
async function fetchFromSpotify(title: string, artist: string): Promise<LyricsResult | null> {
  const token = await getSpotifyToken();
  if (!token) return null;

  const searchRes = await fetch(
    `https://api.spotify.com/v1/search?q=${encodeURIComponent(`${title} ${artist}`)}&type=track&limit=1`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!searchRes.ok) return null;
  const searchData = await searchRes.json();
  const trackId = searchData.tracks?.items?.[0]?.id;
  if (!trackId) return null;

  const lyricsRes = await fetch(
    `https://spclient.wg.spotify.com/color-lyrics/v2/track/${trackId}?format=json&market=from_token`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!lyricsRes.ok) return null;
  const lyricsData = await lyricsRes.json();

  const lines = lyricsData?.lyrics?.lines;
  if (!lines || !lines.length) return null;

  const lrcLines: string[] = [];
  const plainLines: string[] = [];
  for (const line of lines) {
    const ts = parseInt(line.startTimeMs);
    const min = Math.floor(ts / 60000);
    const sec = Math.floor((ts % 60000) / 1000);
    const ms = ts % 1000;
    lrcLines.push(`[${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(ms).padStart(3, '0')}] ${line.words}`);
    plainLines.push(line.words);
  }
  return { synced: lrcLines.join('\n'), plain: plainLines.join('\n') };
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

  // Always re-fetch to allow overwrite
  let result = await fetchFromLrclib(song.title, song.artist);
  let source = 'lrclib';

  if (!result) {
    result = await fetchFromSpotify(song.title, song.artist);
    source = 'spotify';
  }

  if (!result) {
    return NextResponse.json({ synced: false, error: '同期歌詞が見つかりません' });
  }

  // Generate furigana from plain lyrics
  let furigana: unknown[] = [];
  try {
    furigana = await convertToFurigana(result.plain);
  } catch (e) {
    console.error('Furigana conversion failed:', e);
  }

  db.prepare(`UPDATE songs SET lyrics_raw = ?, lyrics_furigana = ?, lyrics_synced = ?, updated_at = datetime('now','localtime') WHERE id = ?`)
    .run(result.plain, JSON.stringify(furigana), result.synced, id);

  const parsed = parseLrc(result.synced);
  return NextResponse.json({ synced: true, source, lines: parsed.length, lrc: result.synced });
}
