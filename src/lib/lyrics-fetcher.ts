/**
 * Shared lyrics fetcher — multi-source chain used by sync and import-playlist.
 *
 * Sources (in order):
 *  1. LRCLIB exact match
 *  2. LRCLIB fuzzy search
 *  3. PetitLyrics (JP synced)
 *  4. Uta-Net (JP plain)
 *  5. ytmusicapi sidecar (optional)
 */

export interface LyricsResult {
  synced: string;
  plain: string;
}

function stripTimestamps(lrc: string): string {
  return lrc.replace(/^\[\d{2}:\d{2}\.\d{2,3}\]\s*/gm, '').trim();
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

// ─── LRCLIB ──

export async function fetchFromLrclib(title: string, artist: string): Promise<LyricsResult | null> {
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

export async function searchLrclib(query: string): Promise<LyricsResult | null> {
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

// ─── PetitLyrics ──

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
      const dataMatch = xml.match(/<lyricsData>([\s\S]*?)<\/lyricsData>/);
      const typeMatch = xml.match(/<lyricsType>(\d+)<\/lyricsType>/);
      if (!dataMatch?.[1]) return null;
      const decoded = atob(dataMatch[1].trim());
      return { type: typeMatch ? parseInt(typeMatch[1]) : lyricsType, data: decoded };
    } catch { return null; }
  }

  const synced = await fetchType(3);
  if (synced) {
    if (synced.type === 3) {
      const lrc = xmlToLrc(synced.data);
      if (lrc) return { synced: lrc, plain: stripTimestamps(lrc) };
    } else if (synced.type === 1) {
      return { synced: '', plain: synced.data.trim() };
    }
  }

  const plain = await fetchType(1);
  if (plain?.data?.trim()) return { synced: '', plain: plain.data.trim() };
  return null;
}

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

// ─── Uta-Net ──

async function fetchFromUtaNet(title: string, artist: string): Promise<LyricsResult | null> {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept-Language': 'ja,en;q=0.9',
  };

  let songId: string | null = null;
  try {
    const q = encodeURIComponent(`${title} ${artist}`);
    const res = await fetchWithTimeout(`https://www.uta-net.com/search/?Keyword=${q}&x=0&y=0&Aselect=2&Bselect=3`, { headers });
    if (!res.ok) return null;
    const html = await res.text();
    const linkMatch = html.match(/\/song\/(\d+)\//);
    if (linkMatch) songId = linkMatch[1];
  } catch { return null; }
  if (!songId) return null;

  try {
    const res = await fetchWithTimeout(`https://www.uta-net.com/song/${songId}/`, { headers });
    if (!res.ok) return null;
    const html = await res.text();
    const kashiMatch = html.match(/<div[^>]*id="kashi_area"[^>]*>([\s\S]*?)<\/div>/i);
    if (!kashiMatch) return null;
    const lyrics = kashiMatch[1]
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\u3000/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#\d+;/g, '')
      .trim();
    if (!lyrics) return null;
    return { synced: '', plain: lyrics };
  } catch { return null; }
}

// ─── ytmusicapi sidecar ──

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
    return { synced: data.synced || '', plain: data.plain || data.lyrics || '' };
  } catch { return null; }
}

// ─── Full chain ──

export interface FetchLyricsOptions {
  /** Use Spotify canonical name for CJK variant matching */
  spotifyCanonical?: { name: string; artist: string } | null;
}

/**
 * Fetch lyrics from all sources in order.
 * Returns { result, source } or { result: null, source: '' } if all fail.
 */
export async function fetchLyrics(
  title: string,
  artist: string,
  opts?: FetchLyricsOptions,
): Promise<{ result: LyricsResult | null; source: string }> {
  // 1. LRCLIB exact
  let result = await fetchFromLrclib(title, artist);
  if (result) return { result, source: 'lrclib' };

  // 2. LRCLIB with Spotify canonical name
  if (opts?.spotifyCanonical) {
    result = await fetchFromLrclib(opts.spotifyCanonical.name, opts.spotifyCanonical.artist);
    if (result) return { result, source: 'lrclib' };
    result = await searchLrclib(`${opts.spotifyCanonical.name} ${opts.spotifyCanonical.artist}`);
    if (result) return { result, source: 'lrclib-search' };
  }

  // 3. LRCLIB fuzzy search
  result = await searchLrclib(`${title} ${artist}`);
  if (result) return { result, source: 'lrclib-search' };

  // 4. PetitLyrics
  const pl = await fetchFromPetitLyrics(title, artist);
  if (pl && (pl.synced || pl.plain)) {
    if (!result) return { result: pl, source: 'petitlyrics' };
    if (!result.synced && pl.synced) return { result: { synced: pl.synced, plain: result.plain || pl.plain }, source: 'petitlyrics' };
  }

  // 5. Uta-Net
  const un = await fetchFromUtaNet(title, artist);
  if (un) return { result: un, source: 'uta-net' };

  // 6. ytmusicapi
  const yt = await fetchFromYtMusic(title, artist);
  if (yt) return { result: yt, source: 'ytmusic' };

  return { result: null, source: '' };
}
