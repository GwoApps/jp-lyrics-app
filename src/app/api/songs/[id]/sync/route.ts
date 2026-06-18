import { NextRequest, NextResponse } from 'next/server';
import { getDB, schema, sql } from '@/lib/db';
import { getSpotifyTokenForUser } from '@/lib/spotify';
import { getAuthUser } from '@/lib/auth';

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
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;
  const bg = (s: string) => { const set = new Set<string>(); for (let i = 0; i < s.length - 1; i++) set.add(s.substring(i, i + 2)); return set; };
  const aSet = bg(na), bSet = bg(nb);
  let common = 0; for (const g of aSet) { if (bSet.has(g)) common++; }
  return (2 * common) / (aSet.size + bSet.size) >= 0.4;
}

function msToLrcTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  const centis = Math.floor((ms % 1000) / 10);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(centis).padStart(2, '0')}`;
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ─── LRCLIB ──────────────────────────────────────────────────────────────────

async function fetchFromLrclib(title: string, artist: string): Promise<LyricsResult | null> {
  const headers = { 'User-Agent': 'jp-lyrics-app/1.0' };
  try {
    const params = new URLSearchParams({ track_name: title, artist_name: artist });
    const res = await fetchWithTimeout(`https://lrclib.net/api/get?${params}`, { headers });
    if (res.ok) {
      const data = await res.json();
      if (data.syncedLyrics) return { synced: data.syncedLyrics, plain: data.plainLyrics || stripTimestamps(data.syncedLyrics) };
    }
  } catch { /* */ }
  return null;
}

async function searchLrclib(query: string): Promise<LyricsResult | null> {
  const headers = { 'User-Agent': 'jp-lyrics-app/1.0' };
  try {
    const res = await fetchWithTimeout(`https://lrclib.net/api/search?q=${encodeURIComponent(query)}`, { headers });
    if (res.ok) {
      const results = await res.json();
      for (const item of results) {
        if (item.syncedLyrics) return { synced: item.syncedLyrics, plain: item.plainLyrics || stripTimestamps(item.syncedLyrics) };
      }
    }
  } catch { /* */ }
  return null;
}

// ─── PetitLyrics ─────────────────────────────────────────────────────────────

/**
 * PetitLyrics API — supports synced (word-level) and plain lyrics for JP songs.
 * Type 1 = plain text, Type 3 = word-synced XML (converted to LRC).
 */
async function fetchFromPetitLyrics(title: string, artist: string): Promise<LyricsResult | null> {
  const url = 'https://p0.petitlyrics.com/api/GetPetitLyricsData.php';
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
    'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 14; Pixel 8 Build/AP1A.240305.019.A1)',
  };

  async function fetchType(lyricsType: number): Promise<{ type: number; data: string } | null> {
    const body = new URLSearchParams({
      clientAppId: 'p1110417',
      lyricsType: String(lyricsType),
      terminalType: '10',
      key_artist: artist,
      key_title: title,
      key_album: '',
      maxcount: '1',
      index: '0',
      logFlag: '0',
    });
    try {
      const res = await fetchWithTimeout(url, { method: 'POST', headers, body });
      if (!res.ok) return null;
      const xml = await res.text();
      // Extract lyricsData and lyricsType from XML
      const dataMatch = xml.match(/<lyricsData>([\s\S]*?)<\/lyricsData>/);
      const typeMatch = xml.match(/<lyricsType>(\d+)<\/lyricsType>/);
      if (!dataMatch?.[1]) return null;
      const decoded = atob(dataMatch[1].trim());
      return { type: typeMatch ? parseInt(typeMatch[1]) : lyricsType, data: decoded };
    } catch { return null; }
  }

  // Try synced (Type 3) first, fall back to plain (Type 1)
  const synced = await fetchType(3);
  if (synced) {
    if (synced.type === 3) {
      // Word-synced XML → convert to LRC
      const lrc = xmlToLrc(synced.data);
      if (lrc) {
        const plain = stripTimestamps(lrc);
        return { synced: lrc, plain };
      }
    } else if (synced.type === 1) {
      // Got plain text instead
      return { synced: '', plain: synced.data.trim() };
    }
  }

  // Fallback: Type 1 (plain text)
  const plain = await fetchType(1);
  if (plain?.data?.trim()) {
    return { synced: '', plain: plain.data.trim() };
  }

  return null;
}

/** Convert PetitLyrics Type 3 XML to LRC format */
function xmlToLrc(xml: string): string | null {
  const lines: string[] = [];
  const lineMatches = xml.matchAll(/<line>([\s\S]*?)<\/line>/g);
  for (const m of lineMatches) {
    const block = m[1];
    const timeMatch = block.match(/<starttime>(\d+)<\/starttime>/);
    const textMatch = block.match(/<linestring>([\s\S]*?)<\/linestring>/);
    if (timeMatch && textMatch) {
      const ms = parseInt(timeMatch[1]);
      const text = textMatch[1].trim();
      if (text) lines.push(`[${msToLrcTime(ms)}]${text}`);
    }
  }
  return lines.length > 0 ? lines.join('\n') : null;
}

// ─── Uta-Net ─────────────────────────────────────────────────────────────────

/**
 * Uta-Net — large JP lyrics database (plain text only).
 * Search → scrape lyrics page → extract from #kashi_area.
 */
async function fetchFromUtaNet(title: string, artist: string): Promise<LyricsResult | null> {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept-Language': 'ja,en;q=0.9',
  };

  // Search for the song
  let songId: string | null = null;
  try {
    const q = encodeURIComponent(`${title} ${artist}`);
    const res = await fetchWithTimeout(`https://www.uta-net.com/search/?Keyword=${q}&x=0&y=0&Aselect=2&Bselect=3`, { headers });
    if (!res.ok) return null;
    const html = await res.text();
    // Extract first song link: /song/{id}/
    const linkMatch = html.match(/\/song\/(\d+)\//);
    if (linkMatch) songId = linkMatch[1];
  } catch { return null; }
  if (!songId) return null;

  // Fetch lyrics page
  try {
    const res = await fetchWithTimeout(`https://www.uta-net.com/song/${songId}/`, { headers });
    if (!res.ok) return null;
    const html = await res.text();

    // Extract lyrics from #kashi_area
    const kashiMatch = html.match(/<div[^>]*id="kashi_area"[^>]*>([\s\S]*?)<\/div>/i);
    if (!kashiMatch) return null;

    let lyrics = kashiMatch[1]
      .replace(/<br\s*\/?>/gi, '\n')     // <br> → newline
      .replace(/<[^>]+>/g, '')            // strip remaining tags
      .replace(/\u3000/g, ' ')            // ideographic space → regular space
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#\d+;/g, '')             // numeric entities
      .trim();

    if (!lyrics) return null;
    return { synced: '', plain: lyrics };
  } catch { return null; }
}

// ─── ytmusicapi sidecar ──────────────────────────────────────────────────────

/**
 * ytmusicapi sidecar — calls Python service for YouTube Music lyrics.
 * Requires YT_MUSIC_SIDECAR_URL env var (e.g. http://localhost:8910).
 * Returns synced (LRC) or plain lyrics.
 */
async function fetchFromYtMusic(title: string, artist: string): Promise<LyricsResult | null> {
  const sidecarUrl = process.env.YT_MUSIC_SIDECAR_URL;
  if (!sidecarUrl) return null;

  try {
    const res = await fetchWithTimeout(
      `${sidecarUrl}/lyrics?q=${encodeURIComponent(`${title} ${artist}`)}`,
      {},
      20000,
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.plain && !data.lyrics) return null;
    return {
      synced: data.synced || '',
      plain: data.plain || data.lyrics || '',
    };
  } catch { return null; }
}

// ─── Spotify canonical name ──────────────────────────────────────────────────

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

// ─── Main handler ────────────────────────────────────────────────────────────

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const db = getDB();
  const { id } = await params;
  const user = await getAuthUser(request);

  const song = await db.get(sql`SELECT * FROM songs WHERE id = ${id}`) as Record<string, unknown> | undefined;
  if (!song) {
    return NextResponse.json({ error: '曲が見つかりません' }, { status: 404 });
  }

  const title = song.title as string;
  const artist = song.artist as string;

  let result: LyricsResult | null = null;
  let source = '';

  // ── LRCLIB ──
  result = await fetchFromLrclib(title, artist);
  if (result) source = 'lrclib';

  // Try with Spotify canonical name (fixes CJK variant issues)
  if (!result && user) {
    const canonical = await getSpotifyCanonicalName(user.email, title, artist);
    if (canonical) {
      result = await fetchFromLrclib(canonical.name, canonical.artist);
      if (result) source = 'lrclib';
      if (!result) {
        result = await searchLrclib(`${canonical.name} ${canonical.artist}`);
        if (result) source = 'lrclib-search';
      }
    }
  }

  // Broader fuzzy LRCLIB search
  if (!result) {
    result = await searchLrclib(`${title} ${artist}`);
    if (result) source = 'lrclib-search';
  }

  // ── PetitLyrics (JP synced) ──
  if (!result || !result.synced) {
    const pl = await fetchFromPetitLyrics(title, artist);
    if (pl) {
      if (!result) {
        result = pl;
        source = 'petitlyrics';
      } else if (!result.synced && pl.synced) {
        // LRCLIB gave plain only; PetitLyrics has synced → upgrade
        result = { synced: pl.synced, plain: result.plain || pl.plain };
        source = 'petitlyrics';
      }
    }
  }

  // ── Uta-Net (JP plain) ──
  if (!result) {
    const un = await fetchFromUtaNet(title, artist);
    if (un) {
      result = un;
      source = 'uta-net';
    }
  }

  // ── ytmusicapi sidecar (optional) ──
  if (!result) {
    const yt = await fetchFromYtMusic(title, artist);
    if (yt) {
      result = yt;
      source = 'ytmusic';
    }
  }

  if (!result) {
    return NextResponse.json({
      synced: false,
      error: '歌詞が見つかりません。手動でLRC歌詞を貼り付けてください。',
    });
  }

  // Store lyrics — furigana will be computed client-side via kuromoji-es
  await db.update(schema.songs).set({
    lyricsRaw: result.plain,
    lyricsFurigana: '[]',
    lyricsSynced: result.synced,
    updatedAt: sql`(datetime('now', 'localtime'))`,
  }).where(sql`id = ${id}`);

  const parsed = result.synced ? parseLrc(result.synced) : [];
  return NextResponse.json({ synced: parsed.length > 0, source, lines: parsed.length, lrc: result.synced });
}
