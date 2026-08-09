import * as heModule from 'he';
import { artistScore, normalize, titleScore } from './match.ts';

const decodeHtmlEntity = (heModule as unknown as { default?: typeof heModule }).default?.decode ?? heModule.decode;

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

/** Decode named and numeric HTML entities returned by third-party lyrics providers. */
export function unescapeLyrics(value: string): string {
  return decodeHtmlEntity(value);
}

function unescapeLyricsResult(result: LyricsResult): LyricsResult {
  return {
    synced: unescapeLyrics(result.synced),
    plain: unescapeLyrics(result.plain),
  };
}

export interface LyricsFetchResult {
  result: LyricsResult | null;
  source: string;
  /** Heuristic 0–100 confidence based on source and match strategy. */
  confidence: number;
  /** True when the candidate's recorded duration clearly conflicts with the requested Spotify duration. */
  durationMismatch?: boolean;
}

function fetchedResult(
  result: LyricsResult,
  source: string,
  confidence: number,
  durationMismatch?: boolean,
): LyricsFetchResult {
  return { result: unescapeLyricsResult(result), source, confidence, ...(durationMismatch ? { durationMismatch } : {}) };
}

/**
 * Compute the final confidence for an LRCLIB hit.
 *
 * Confidence is now evidence-based instead of hard-coded: an exact hit that
 * disagrees with the Spotify duration drops below the review threshold (it is
 * likely a TV-size / live / remaster of the same title + artist), while a
 * duration + album match keeps the top score.
 */
export function lrclibConfidence(
  hit: LrclibHit | null | undefined,
  base: number,
  exact: boolean,
): number {
  if (!hit) return 0;
  const duration = hit.duration;
  if (exact) {
    if (duration === 'conflict') return base - 20; // e.g. 98 → 78 → needs_review
    if (duration === 'match') return Math.min(99, base + 1);
    if (duration === 'close') return base - 3;
    return base; // unknown duration → old score
  }
  // Fuzzy search: already nudged during candidate scoring.
  if (duration === 'match' || hit.album === 'match') return Math.min(86, base + 4);
  return base;
}

function stripTimestamps(lrc: string): string {
  return lrc
    // Drop standard metadata tags ([ar:], [ti:], [al:], [by:], [offset:], …)
    // so they never leak into plain lyrics.
    .replace(/^\[[a-z]+:[^\]]*\]\s*$/gim, '')
    // Drop timestamp tags, keeping any lyric text after them.
    .replace(/^\[\d{2}:\d{2}\.\d{2,3}\]\s*/gm, '')
    .trim();
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

/**
 * Spotify-side evidence (album + duration) used to disambiguate recordings
 * that share the same title + artist (original vs live / TV size / remaster).
 */
export interface LrclibEvidence {
  /** Spotify track duration in milliseconds. */
  durationMs?: number;
  /** Spotify album name — treated as soft evidence, never a hard filter. */
  album?: string;
}

interface LrclibTrack {
  id: number;
  trackName: string;
  artistName: string;
  albumName?: string | null;
  duration?: number | null;
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
}

/** Duration evidence states derived from an LRCLIB candidate vs the Spotify duration. */
export type DurationStatus = 'match' | 'close' | 'conflict' | 'unknown';
/** Album evidence states — soft evidence, never a hard filter (region variants). */
export type AlbumStatus = 'match' | 'partial' | 'none' | 'unknown';

/** Within this window (ms) a candidate duration is treated as the same recording. */
export const LYRICS_DURATION_TOLERANCE_MS = 8_000;
/** Beyond this window (ms) a candidate is treated as a clearly different recording. */
export const LYRICS_DURATION_CONFLICT_MS = 20_000;

/**
 * Compare an LRCLIB candidate duration (seconds) against the Spotify duration (ms).
 * Returns `unknown` when either side is missing so callers keep the old fallback.
 */
export function durationStatus(
  candidateSeconds: number | null | undefined,
  spotifyDurationMs: number | undefined,
): DurationStatus {
  if (!candidateSeconds || candidateSeconds <= 0 || !spotifyDurationMs || spotifyDurationMs <= 0) {
    return 'unknown';
  }
  const diffMs = Math.abs(candidateSeconds * 1000 - spotifyDurationMs);
  if (diffMs <= LYRICS_DURATION_TOLERANCE_MS) return 'match';
  if (diffMs >= LYRICS_DURATION_CONFLICT_MS) return 'conflict';
  return 'close';
}

/**
 * Compare an LRCLIB album name against the Spotify album (normalized).
 * Album is auxiliary evidence: region variants and catalog differences must not
 * disqualify a candidate, but an exact match adds confidence.
 */
export function albumStatus(
  candidateAlbum: string | null | undefined,
  spotifyAlbum: string | undefined,
): AlbumStatus {
  if (!candidateAlbum || !spotifyAlbum) return 'unknown';
  const a = normalize(candidateAlbum);
  const b = normalize(spotifyAlbum);
  if (!a || !b) return 'unknown';
  if (a === b) return 'match';
  if (a.includes(b) || b.includes(a)) return 'partial';
  return 'none';
}

/** A validated LRCLIB hit plus the evidence status used for confidence scoring. */
export interface LrclibHit {
  result: LyricsResult;
  duration: DurationStatus;
  album: AlbumStatus;
}

function toLrclibHit(track: LrclibTrack, evidence?: LrclibEvidence): LrclibHit | null {
  if (!track.syncedLyrics) return null;
  return {
    result: {
      synced: track.syncedLyrics || '',
      plain: track.plainLyrics || stripTimestamps(track.syncedLyrics || ''),
    },
    duration: durationStatus(track.duration, evidence?.durationMs),
    album: albumStatus(track.albumName, evidence?.album),
  };
}

async function lrclibGet(params: URLSearchParams): Promise<LrclibTrack | null> {
  const headers = { 'User-Agent': 'jp-lyrics-app/1.0' };
  try {
    const res = await fetchWithTimeout(`https://lrclib.net/api/get?${params}`, { headers });
    if (res.ok) {
      const data = await res.json();
      if (data && typeof data === 'object' && data.syncedLyrics) {
        return data as LrclibTrack;
      }
    }
  } catch { /* */ }
  return null;
}

/**
 * LRCLIB exact match, optionally disambiguated by Spotify evidence.
 *
 * `album_name` / `duration` on `/api/get` are *exact* filters — a slightly
 * different album string (region variant) or a stale duration returns 404, so
 * they must not be sent unconditionally. Instead:
 *  1. Run the bare track+artist query first (stable baseline).
 *  2. When the hit's recorded duration clearly conflicts with Spotify's, retry
 *     scoped to the album — the bare query can have picked a TV-size / live
 *     version of the same title + artist.
 *  3. When the bare query found nothing (multi-version ambiguity 404s), try the
 *     album-scoped query as a last resort.
 */
export async function fetchFromLrclib(
  title: string,
  artist: string,
  evidence?: LrclibEvidence,
): Promise<LrclibHit | null> {
  const albumScoped = (): Promise<LrclibTrack | null> => {
    if (!evidence?.album) return Promise.resolve(null);
    return lrclibGet(new URLSearchParams({
      track_name: title,
      artist_name: artist,
      album_name: evidence.album,
    }));
  };

  // Pass 1 — bare exact match.
  const plain = await lrclibGet(new URLSearchParams({ track_name: title, artist_name: artist }));
  if (plain) {
    if (
      evidence?.album
      && durationStatus(plain.duration, evidence.durationMs) === 'conflict'
    ) {
      // Duration conflict is strong evidence the bare query returned a different
      // recording — the album-scoped hit is much more likely to be the right one.
      const scoped = await albumScoped();
      if (scoped) return toLrclibHit(scoped, evidence);
    }
    return toLrclibHit(plain, evidence);
  }

  // Pass 2 — album-scoped exact when the bare query 404'd.
  const scoped = await albumScoped();
  return scoped ? toLrclibHit(scoped, evidence) : null;
}

/**
 * LRCLIB fuzzy search with candidate validation.
 *
 * Fuzzy search returns same-name-different-artist / cover / medley hits, so
 * blindly taking the first synced entry can write another song's lyrics over
 * the current one. Every candidate must clear a real title AND artist match
 * (same thresholds as `isTitleMatch` / artist overlap in `match.ts`); the
 * highest-scoring candidate wins instead of the first one. When nothing
 * qualifies, null falls through to the next source in the chain.
 *
 * When Spotify duration is available, candidates whose recorded duration
 * clearly conflicts are dropped outright (different recording), and the
 * remaining score is nudged by duration / album evidence.
 */
export async function searchLrclib(
  query: string,
  title: string,
  artist: string,
  evidence?: LrclibEvidence,
): Promise<LrclibHit | null> {
  const headers = { 'User-Agent': 'jp-lyrics-app/1.0' };
  try {
    const res = await fetchWithTimeout(`https://lrclib.net/api/search?q=${encodeURIComponent(query)}`, { headers });
    if (res.ok) {
      const results = await res.json();
      let best: LrclibHit | null = null;
      let bestScore = -1;
      const hasRequestedArtist = artist.trim().length > 0;
      for (const item of results) {
        if (!item.syncedLyrics) continue;
        const itemTitle = String(item.trackName ?? '');
        const itemArtist = String(item.artistName ?? '');
        const tScore = titleScore(title, itemTitle);
        // Artist must exist and partially match when we have artist info to
        // check against; without it, fall back to title-only matching.
        const aScore = hasRequestedArtist ? artistScore(artist, itemArtist) : 0.5;
        if (tScore < 0.55) continue;
        if (hasRequestedArtist && (!itemArtist || aScore < 0.55)) continue;

        // A clearly different recording duration is strong evidence of another
        // version (TV size / live / remaster) — drop it outright.
        const duration = durationStatus(item.duration, evidence?.durationMs);
        if (duration === 'conflict') continue;

        let score = tScore * 0.7 + aScore * 0.3;
        if (duration === 'match') score += 0.05;
        else if (duration === 'close') score -= 0.04;
        const album = albumStatus(item.albumName, evidence?.album);
        if (album === 'match') score += 0.03;
        else if (album === 'partial') score += 0.01;

        if (score > bestScore) {
          bestScore = score;
          best = {
            result: {
              synced: item.syncedLyrics || '',
              plain: item.plainLyrics || stripTimestamps(item.syncedLyrics || ''),
            },
            duration,
            album,
          };
        }
      }
      return best;
    }
  } catch { /* */ }
  return null;
}

// ─── PetitLyrics ──

export function decodeBase64Bytes(encoded: string): Uint8Array {
  const binary = atob(encoded.trim());
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/** PetitLyrics wraps UTF-8 lyric bytes in Base64; atob alone only returns a binary string. */
export function decodeBase64Utf8(encoded: string): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(decodeBase64Bytes(encoded));
}

interface PetitLyricsCandidate {
  type: number;
  data: string | Uint8Array;
  title: string;
  artist: string;
}

const PETITLYRICS_SYNC_CANDIDATE_LIMIT = 4;

function normalizePetitLyricsMetadata(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('ja-JP').replace(/[\s\p{P}\p{S}]+/gu, '');
}

function isPetitLyricsMatch(candidate: PetitLyricsCandidate, title: string, artist: string): boolean {
  const candidateTitle = normalizePetitLyricsMetadata(candidate.title);
  const requestedTitle = normalizePetitLyricsMetadata(title);
  const candidateArtist = normalizePetitLyricsMetadata(candidate.artist);
  const requestedArtist = normalizePetitLyricsMetadata(artist);
  return candidateTitle === requestedTitle
    && (!requestedArtist || candidateArtist === requestedArtist || candidateArtist.includes(requestedArtist) || requestedArtist.includes(candidateArtist));
}

export function parsePetitLyricsResponse(xml: string, requestedType: number): PetitLyricsCandidate | null {
  const dataMatch = xml.match(/<lyricsData>([\s\S]*?)<\/lyricsData>/);
  if (!dataMatch?.[1]) return null;
  const typeMatch = xml.match(/<lyricsType>(\d+)<\/lyricsType>/);
  const lyricsType = typeMatch ? parseInt(typeMatch[1], 10) : requestedType;
  const titleMatch = xml.match(/<title>([\s\S]*?)<\/title>/);
  const artistMatch = xml.match(/<artist>([\s\S]*?)<\/artist>/);
  try {
    return {
      type: lyricsType,
      data: lyricsType === 2 ? decodeBase64Bytes(dataMatch[1]) : decodeBase64Utf8(dataMatch[1]),
      title: unescapeLyrics(titleMatch?.[1] ?? ''),
      artist: unescapeLyrics(artistMatch?.[1] ?? ''),
    };
  } catch {
    return null;
  }
}

export function decodePetitLyricsLsyToLrc(payload: Uint8Array, plainLyrics: string): string | null {
  const timeArrayOffset = 0xcc;
  if (payload.length < timeArrayOffset || !plainLyrics) return null;

  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const lineCount = view.getUint32(0x38, true);
  if (lineCount === 0 || lineCount > 2_000 || payload.length < timeArrayOffset + lineCount * 2) return null;

  let key = view.getUint16(0x1a, true);
  if (view.getUint8(0x19) === 1) {
    key = (key & 0x0003)
      | ((key & 0x000c) << 2)
      | ((key & 0x0030) >> 2)
      | ((key & 0x00c0) << 2)
      | ((key & 0x0300) >> 2)
      | ((key & 0x0c00) << 2)
      | ((key & 0x3000) >> 2)
      | (key & 0xc000);
  }

  const lyricLines = plainLyrics.replace(/\r\n?/g, '\n').split('\n');
  while (lyricLines.length > lineCount && lyricLines.at(-1) === '') lyricLines.pop();
  if (lyricLines.length !== lineCount) return null;

  let previousTimeCs = -1;
  const lrcLines = lyricLines.map((line, index) => {
    let timeCs = view.getUint16(timeArrayOffset + index * 2, true) ^ key;
    while (timeCs < previousTimeCs) timeCs += 0x1_0000;
    previousTimeCs = timeCs;
    return `[${msToLrcTime(timeCs * 10)}]${line}`;
  });
  while (lrcLines.length > 0 && lyricLines[lrcLines.length - 1] === '') lrcLines.pop();
  return lrcLines.join('\n');
}

async function fetchFromPetitLyrics(title: string, artist: string): Promise<LyricsResult | null> {
  const url = 'https://p0.petitlyrics.com/api/GetPetitLyricsData.php';
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
    'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 14; Pixel 8 Build/AP1A.240305.019.A1)',
  };

  async function fetchType(lyricsType: number, index: number): Promise<PetitLyricsCandidate | null> {
    const body = new URLSearchParams({
      clientAppId: 'p1110417',
      lyricsType: String(lyricsType),
      terminalType: '10',
      key_artist: artist,
      key_title: title,
      key_album: '',
      maxcount: '1',
      index: String(index),
      logFlag: '0',
    });
    try {
      const res = await fetchWithTimeout(url, { method: 'POST', headers, body }, 8_000);
      if (!res.ok) return null;
      return parsePetitLyricsResponse(await res.text(), lyricsType);
    } catch { return null; }
  }

  // The API only returns one result per request, even when maxcount is higher. Search a small
  // set of indexed WYSIWYG/LSY candidates first, otherwise a plain-text first result drops timing.
  for (let index = 0; index < PETITLYRICS_SYNC_CANDIDATE_LIMIT; index += 1) {
    const synced = await fetchType(3, index);
    if (!synced) break;
    if (!isPetitLyricsMatch(synced, title, artist)) continue;

    if (synced.type === 3 && typeof synced.data === 'string') {
      const lrc = petitLyricsXmlToLrc(synced.data);
      if (lrc) return { synced: lrc, plain: stripTimestamps(lrc) };
    }

    if (synced.type === 2 && synced.data instanceof Uint8Array) {
      const plain = await fetchType(1, index);
      if (plain?.type === 1 && typeof plain.data === 'string' && isPetitLyricsMatch(plain, title, artist)) {
        const lrc = decodePetitLyricsLsyToLrc(synced.data, plain.data);
        if (lrc) return { synced: lrc, plain: plain.data.trim() };
      }
    }
  }

  // Keep PetitLyrics as a useful plain-text fallback only after all checked sync candidates fail.
  const plain = await fetchType(1, 0);
  if (plain?.data && typeof plain.data === 'string' && isPetitLyricsMatch(plain, title, artist)) {
    return { synced: '', plain: plain.data.trim() };
  }
  return null;
}

export function petitLyricsXmlToLrc(xml: string): string | null {
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
    const lyrics = unescapeLyrics(kashiMatch[1]
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\u3000/g, ' '))
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
  /** Spotify-side evidence (album + durationMs) used to disambiguate recordings. */
  spotify?: LrclibEvidence;
}

/**
 * Fetch lyrics from all sources in order.
 * Returns { result, source } or { result: null, source: '' } if all fail.
 */
export async function fetchLyrics(
  title: string,
  artist: string,
  opts?: FetchLyricsOptions,
): Promise<LyricsFetchResult> {
  const evidence = opts?.spotify;

  // 1. LRCLIB exact
  let hit = await fetchFromLrclib(title, artist, evidence);
  if (hit) return fetchedResult(hit.result, 'lrclib', lrclibConfidence(hit, 98, true), hit.duration === 'conflict');

  // 2. LRCLIB with Spotify canonical name
  if (opts?.spotifyCanonical) {
    hit = await fetchFromLrclib(opts.spotifyCanonical.name, opts.spotifyCanonical.artist, evidence);
    if (hit) return fetchedResult(hit.result, 'lrclib', lrclibConfidence(hit, 96, true), hit.duration === 'conflict');
    hit = await searchLrclib(`${opts.spotifyCanonical.name} ${opts.spotifyCanonical.artist}`, opts.spotifyCanonical.name, opts.spotifyCanonical.artist, evidence);
    if (hit) return fetchedResult(hit.result, 'lrclib-search', lrclibConfidence(hit, 82, false));
  }

  // 3. LRCLIB fuzzy search
  hit = await searchLrclib(`${title} ${artist}`, title, artist, evidence);
  if (hit) return fetchedResult(hit.result, 'lrclib-search', lrclibConfidence(hit, 78, false));

  // 4. PetitLyrics
  const pl = await fetchFromPetitLyrics(title, artist);
  if (pl && (pl.synced || pl.plain)) {
    return fetchedResult(pl, 'petitlyrics', pl.synced ? 90 : 82);
  }

  // 5. Uta-Net
  const un = await fetchFromUtaNet(title, artist);
  if (un) return fetchedResult(un, 'uta-net', 76);

  // 6. ytmusicapi
  const yt = await fetchFromYtMusic(title, artist);
  if (yt) return fetchedResult(yt, 'ytmusic', yt.synced ? 74 : 68);

  return { result: null, source: '', confidence: 0 };
}
