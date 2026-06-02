import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { getSpotifyTokenForUser } from '@/lib/spotify';
import { getAuthUser } from '@/lib/auth';
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

/** Use Spotify search to get the canonical track name */
async function getSpotifyCanonicalName(userEmail: string, title: string, artist: string): Promise<{ name: string; artist: string } | null> {
  const token = await getSpotifyTokenForUser(userEmail);
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

  /** Fetch with timeout */
  async function fetchWithTimeout(url: string, timeoutMs = 15000): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { headers, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  function toResult(data: { syncedLyrics?: string; plainLyrics?: string }): LyricsResult | null {
    if (!data.syncedLyrics) return null;
    return { synced: data.syncedLyrics, plain: data.plainLyrics || stripTimestamps(data.syncedLyrics) };
  }

  // 1) Exact match
  try {
    const params = new URLSearchParams({ track_name: title, artist_name: artist });
    const res = await fetchWithTimeout(`https://lrclib.net/api/get?${params}`);
    if (res.ok) {
      const data = await res.json();
      const r = toResult(data);
      if (r) return r;
    }
  } catch { /* */ }

  return null;
}

/** lrclib search (fuzzy) */
async function searchLrclib(query: string): Promise<LyricsResult | null> {
  const headers = { 'User-Agent': 'jp-lyrics-app/1.0' };
  async function fetchWithTimeout(url: string, timeoutMs = 15000): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { headers, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  try {
    const params = new URLSearchParams({ q: query });
    const res = await fetchWithTimeout(`https://lrclib.net/api/search?${params}`);
    if (res.ok) {
      const results = await res.json();
      for (const item of results) {
        if (item.syncedLyrics) {
          return { synced: item.syncedLyrics, plain: item.plainLyrics || stripTimestamps(item.syncedLyrics) };
        }
      }
    }
  } catch { /* */ }

  return null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = getAuthUser(request);

  const song = db.prepare('SELECT * FROM songs WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!song) {
    return NextResponse.json({ error: '曲が見つかりません' }, { status: 404 });
  }

  let result: LyricsResult | null = null;
  let source = 'lrclib';

  // 1) Exact lrclib match
  result = await fetchFromLrclib(song.title as string, song.artist as string);

  // 2) Try with Spotify canonical name (fixes CJK variant issues)
  if (!result && user) {
    const canonical = await getSpotifyCanonicalName(user.email, song.title as string, song.artist as string);
    if (canonical) {
      result = await fetchFromLrclib(canonical.name, canonical.artist);
      if (!result) {
        // 3) Fuzzy lrclib search with canonical name
        result = await searchLrclib(`${canonical.name} ${canonical.artist}`);
      }
    }
  }

  // 4) Broader fuzzy search with original title
  if (!result) {
    result = await searchLrclib(`${song.title} ${song.artist}`);
    source = 'lrclib-search';
  }

  if (!result) {
    return NextResponse.json({
      synced: false,
      error: '歌詞が見つかりません。手動でLRC歌詞を貼り付けてください。',
    });
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
