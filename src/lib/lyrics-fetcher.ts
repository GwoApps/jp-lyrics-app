import * as heModule from 'he';
import { artistScore, normalize, titleScore } from './match.ts';
import type { ProviderStage } from './lyrics-provider/types.ts';

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
  /**
   * Metadata of the actual matched song (currently Uta-Net). Surfaced in the
   * low-confidence review UI so users can judge a same-name / cover hit instead
   * of guessing from the lyric preview alone.
   */
  match?: {
    title: string;
    artist: string;
    link: string;
    /** True when the top candidates were too close to be confident. */
    ambiguous?: boolean;
  };
  /**
   * True when the preferred lrclib source was rate-limited (HTTP 429 even
   * after a retry). Set regardless of whether a later fallback source produced
   * a result, so callers can tell "the exact-lyrics source is throttled, retry
   * later" apart from "this song genuinely has no lyrics".
   */
  rateLimited?: boolean;
}

function fetchedResult(
  result: LyricsResult,
  source: string,
  confidence: number,
  durationMismatch?: boolean,
  match?: LyricsFetchResult['match'],
): LyricsFetchResult {
  return {
    result: unescapeLyricsResult(result),
    source,
    confidence,
    ...(durationMismatch ? { durationMismatch } : {}),
    ...(match ? { match } : {}),
  };
}

/**
 * Map a Uta-Net candidate's composite match score (0–1) to a confidence value.
 * A perfect title+artist match lands at 90 (accepted); weaker matches stay
 * below the 80 review threshold so they are always reviewed instead of being
 * given a flat 76 regardless of how well (or poorly) the metadata matched.
 */
export function utaNetConfidence(score: number): number {
  return Math.round(40 + score * 50);
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

export function stripTimestamps(lrc: string): string {
  return lrc
    // Drop standard metadata tags ([ar:], [ti:], [al:], [by:], [offset:], …)
    // so they never leak into plain lyrics.
    .replace(/^\[[a-z]+:[^\]]*\]\s*$/gim, '')
    // Drop every leading timestamp tag (one or more per row), keeping any lyric
    // text after them. Accepts the same non-standard forms the LRC parser does:
    // 1-2 digit minutes, fixed 2-digit seconds, optional 1-3 digit fraction.
    .replace(/^(?:\[(?:\d{1,2}:\d{2}(?:\.\d{1,3})?)\]\s*)+/gm, '')
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
  const outer = init.signal;
  if (outer) {
    const onAbort = () => controller.abort();
    if (outer.aborted) controller.abort();
    else outer.addEventListener('abort', onAbort, { once: true });
  }
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ─── LRCLIB ──

/**
 * Lightweight in-process rate limiter for the LRCLIB public API.
 *
 * LRCLIB enforces ~50 requests/min per IP and answers excess with HTTP 429 +
 * `Retry-After`. Playlist chunked imports can fire several LRCLIB requests in
 * quick succession (each track may trigger an exact + album-scoped + fuzzy
 * query), which would otherwise blow the quota instantly and silently degrade
 * every later track to the plain-text sources. We enforce a small minimum
 * spacing between requests so bursts are smoothed out while staying far below
 * the per-IP ceiling.
 */
const LRCLIB_MIN_INTERVAL_MS = 1200;
/** Extra safety margin between the app's self-imposed interval and LRCLIB's cap. */
const LRCLIB_MIN_INTERVAL_FUZZ_MS = 300;
/** Default LRCLIB API base URL. */
export const LRCLIB_DEFAULT_API_BASE = 'https://lrclib.net/api';

let lrclibLastRequestAt = 0;

/**
 * Per-request LRCLIB adapter options (ISSUE #196). Fields are optional — when
 * absent, the module-level defaults (legacy hardcoded constants) apply.
 */
export interface LrclibOptions {
  /** Minimum spacing between LRCLIB requests, in ms. 0 disables throttling. */
  rateLimitMs?: number;
  /** LRCLIB API base URL override (proxy / self-hosted instance). */
  apiBase?: string;
  /** Whether to run the fuzzy-search fallback stage after exact misses. */
  fuzzyEnabled?: boolean;
  /** Single-request timeout in ms. */
  timeoutMs?: number;
}

/** Effective per-call LRCLIB config merged from module defaults + row config. */
interface LrclibSettings {
  rateLimitMs: number;
  apiBase: string;
  fuzzyEnabled: boolean;
  timeoutMs: number;
}

const LRCLIB_DEFAULT_SETTINGS: LrclibSettings = {
  rateLimitMs: LRCLIB_MIN_INTERVAL_MS + LRCLIB_MIN_INTERVAL_FUZZ_MS,
  apiBase: LRCLIB_DEFAULT_API_BASE,
  fuzzyEnabled: true,
  timeoutMs: 15000,
};

function resolveLrclibSettings(opts?: LrclibOptions): LrclibSettings {
  return {
    rateLimitMs: opts?.rateLimitMs ?? LRCLIB_DEFAULT_SETTINGS.rateLimitMs,
    apiBase: opts?.apiBase?.trim() || LRCLIB_DEFAULT_SETTINGS.apiBase,
    fuzzyEnabled: opts?.fuzzyEnabled ?? LRCLIB_DEFAULT_SETTINGS.fuzzyEnabled,
    timeoutMs: opts?.timeoutMs ?? LRCLIB_DEFAULT_SETTINGS.timeoutMs,
  };
}

/** Wait until `minIntervalMs` has elapsed since the previous LRCLIB request. */
function throttleLrclib(minIntervalMs = LRCLIB_MIN_INTERVAL_MS + LRCLIB_MIN_INTERVAL_FUZZ_MS): Promise<void> {
  const now = Date.now();
  const elapsed = now - lrclibLastRequestAt;
  if (elapsed >= minIntervalMs) {
    lrclibLastRequestAt = now;
    return Promise.resolve();
  }
  const wait = minIntervalMs - elapsed;
  lrclibLastRequestAt = now + wait;
  return new Promise((resolve) => setTimeout(resolve, wait));
}

/** Outcome of a single (possibly retried) LRCLIB request. */
type LrclibRequestResult<T> =
  | { ok: true; data: T }
  | { ok: false; rateLimited: boolean };

/**
 * Fetch a LRCLIB endpoint with HTTP 429 handling.
 *
 * On 429 it honours `Retry-After` (falling back to a short fixed backoff) and
 * retries once; a second 429 marks the call as rate-limited instead of silently
 * returning a "no lyrics" miss, so callers can surface a distinct error.
 */
async function lrclibFetch<T>(
  url: string,
  headers: Record<string, string>,
  parse: (res: Response) => Promise<T>,
  settings: LrclibSettings,
  opts?: { notFoundMeansEmpty?: boolean },
  signal?: AbortSignal,
): Promise<LrclibRequestResult<T>> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await throttleLrclib(settings.rateLimitMs);
    let res: Response;
    try {
      res = await fetchWithTimeout(url, { headers, signal }, settings.timeoutMs);
    } catch {
      if (signal?.aborted) throw signal.reason;
      return { ok: false, rateLimited: false };
    }

    if (res.status === 429) {
      const retryAfterRaw = res.headers.get('retry-after');
      const retryAfter = retryAfterRaw ? Number(retryAfterRaw) : NaN;
      // Honour a positive Retry-After (LRCLIB returns seconds); otherwise fall
      // back to a fixed short backoff. Never wait longer than the caller will.
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 5000)
        : Math.max(settings.rateLimitMs, 1200); // never retry instantly on 429
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, waitMs));
        continue; // single retry
      }
      return { ok: false, rateLimited: true };
    }

    if (!res.ok) {
      // For exact-match `/api/get`, a 404 is a legitimate "no lyrics for this
      // track" and must NOT be treated as a failure — it just means the bare
      // query found nothing and the caller should try the album-scoped query.
      if (opts?.notFoundMeansEmpty && res.status === 404) {
        try {
          return { ok: true, data: await parse(res) };
        } catch {
          return { ok: true, data: null as unknown as T };
        }
      }
      return { ok: false, rateLimited: false };
    }
    try {
      return { ok: true, data: await parse(res) };
    } catch {
      return { ok: false, rateLimited: false };
    }
  }
  return { ok: false, rateLimited: false };
}

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

async function lrclibGet(params: URLSearchParams, settings: LrclibSettings, signal?: AbortSignal): Promise<LrclibRequestResult<LrclibTrack | null>> {
  const headers = { 'User-Agent': 'jp-lyrics-app/1.0' };
  return lrclibFetch(`${settings.apiBase}/get?${params}`, headers, async (res) => {
    const data = await res.json();
    if (data && typeof data === 'object' && data.syncedLyrics) {
      return data as LrclibTrack;
    }
    return null;
  }, settings, { notFoundMeansEmpty: true }, signal);
}

/** A lrclib lookup: the matched hit (or null) plus whether the source was rate-limited. */
interface LrclibFetchOutcome {
  hit: LrclibHit | null;
  /** True when lrclib answered HTTP 429 even after a single retry. */
  rateLimited: boolean;
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
  signal?: AbortSignal,
  opts?: LrclibOptions,
): Promise<LrclibFetchOutcome> {
  const settings = resolveLrclibSettings(opts);
  const albumScoped = (): Promise<LrclibRequestResult<LrclibTrack | null>> => {
    if (!evidence?.album) return Promise.resolve({ ok: true, data: null });
    return lrclibGet(new URLSearchParams({
      track_name: title,
      artist_name: artist,
      album_name: evidence.album,
    }), settings, signal);
  };

  // Pass 1 — bare exact match.
  const plainRes = await lrclibGet(new URLSearchParams({ track_name: title, artist_name: artist }), settings, signal);
  if (!plainRes.ok) return { hit: null, rateLimited: plainRes.rateLimited };
  const plain = plainRes.data;
  if (plain) {
    if (
      evidence?.album
      && durationStatus(plain.duration, evidence.durationMs) === 'conflict'
    ) {
      // Duration conflict is strong evidence the bare query returned a different
      // recording — the album-scoped hit is much more likely to be the right one.
      const scoped = await albumScoped();
      if (scoped.ok && scoped.data) return { hit: toLrclibHit(scoped.data, evidence), rateLimited: false };
      if (!scoped.ok) return { hit: null, rateLimited: scoped.rateLimited };
    }
    return { hit: toLrclibHit(plain, evidence), rateLimited: false };
  }

  // Pass 2 — album-scoped exact when the bare query 404'd.
  const scoped = await albumScoped();
  if (!scoped.ok) return { hit: null, rateLimited: scoped.rateLimited };
  return { hit: scoped.data ? toLrclibHit(scoped.data, evidence) : null, rateLimited: false };
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
  signal?: AbortSignal,
  opts?: LrclibOptions,
): Promise<LrclibFetchOutcome> {
  const settings = resolveLrclibSettings(opts);
  const headers = { 'User-Agent': 'jp-lyrics-app/1.0' };
  const res = await lrclibFetch(
    `${settings.apiBase}/search?q=${encodeURIComponent(query)}`,
    headers,
    async (res) => res.json(),
    settings,
    undefined,
    signal,
  );
  if (!res.ok) return { hit: null, rateLimited: res.rateLimited };

  const results = res.data as LrclibTrack[];
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
  return { hit: best, rateLimited: false };
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

/**
 * Per-request PetitLyrics adapter options (ISSUE #196).
 */
export interface PetitLyricsOptions {
  /** Number of indexed WYSIWYG/LSY candidates scanned before plain-text fallback. */
  syncCandidateLimit?: number;
  /** Single-request timeout in ms. */
  timeoutMs?: number;
}

function resolvePetitLyricsSettings(opts?: PetitLyricsOptions): { syncCandidateLimit: number; timeoutMs: number } {
  return {
    syncCandidateLimit: opts?.syncCandidateLimit ?? PETITLYRICS_SYNC_CANDIDATE_LIMIT,
    timeoutMs: opts?.timeoutMs ?? 8000,
  };
}

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

export async function fetchFromPetitLyrics(
  title: string,
  artist: string,
  signal?: AbortSignal,
  opts?: PetitLyricsOptions,
): Promise<LyricsResult | null> {
  const settings = resolvePetitLyricsSettings(opts);
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
      const res = await fetchWithTimeout(url, { method: 'POST', headers, body, signal }, settings.timeoutMs);
      if (!res.ok) return null;
      return parsePetitLyricsResponse(await res.text(), lyricsType);
    } catch {
      if (signal?.aborted) throw signal.reason;
      return null;
    }
  }

  // The API only returns one result per request, even when maxcount is higher. Search a small
  // set of indexed WYSIWYG/LSY candidates first, otherwise a plain-text first result drops timing.
  for (let index = 0; index < settings.syncCandidateLimit; index += 1) {
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

/**
 * A parsed Uta-Net search-result candidate before scoring.
 */
interface UtaNetCandidate {
  songId: string;
  title: string;
  artist: string;
}

/**
 * A validated Uta-Net hit with the metadata that backed the match, so the
 * low-confidence review UI can show which actual song was found instead of
 * making the user guess from the first five lyric lines.
 */
export interface UtaNetHit {
  result: LyricsResult;
  /** Title as listed on the matched Uta-Net song page. */
  matchedTitle: string;
  /** Artist as listed on the matched Uta-Net song page. */
  matchedArtist: string;
  /** URL of the matched Uta-Net song page, for human verification. */
  link: string;
  /** Composite title*0.7 + artist*0.3 score of the winning candidate (0–1). */
  score: number;
  /** True when the top two candidates scored within `UTA_NET_AMBIGUOUS_GAP` — the match is ambiguous. */
  ambiguous: boolean;
}

/**
 * Parse the Uta-Net search results page into individual candidates.
 *
 * Uta-Net lists hits in a table where each row is:
 *   <td class="td1"><a href="/song/{id}/">{song title}</a></td>
 *   <td class="td2"><a href="/artist/{id}/">{artist name}</a></td>
 *
 * Returns every parsed row (song ID + title + artist). The caller is expected
 * to rank them rather than trusting the first row, which may be an approximate
 * keyword match, a same-name cover, or a medley.
 */
export function parseUtaNetCandidates(html: string): UtaNetCandidate[] {
  const candidates: UtaNetCandidate[] = [];
  // Split the table body into rows so song/artist pairs stay together.
  const rowMatches = html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
  for (const row of rowMatches) {
    const song = row[1].match(/href="\/song\/(\d+)\/"[^>]*>([\s\S]*?)<\/a>/i);
    if (!song) continue;
    const songId = song[1];
    const songTitle = unescapeLyrics(song[2].replace(/<[^>]+>/g, '').trim());
    if (!songId || !songTitle) continue;
    const artist = row[1].match(/href="\/artist\/[^"']*\/"[^>]*>([\s\S]*?)<\/a>/i);
    candidates.push({
      songId,
      title: songTitle,
      artist: artist ? unescapeLyrics(artist[1].replace(/<[^>]+>/g, '').trim()) : '',
    });
  }
  return candidates;
}

/**
 * Fetch the plain-text lyrics for a given Uta-Net song ID.
 */
async function fetchUtaNetLyrics(songId: string, headers: Record<string, string>, timeoutMs = 15000): Promise<LyricsResult | null> {
  try {
    const res = await fetchWithTimeout(`https://www.uta-net.com/song/${songId}/`, { headers }, timeoutMs);
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

/** Minimum combined match score for a Uta-Net candidate to be accepted. */
const UTA_NET_MIN_SCORE = 0.55;
/** Combined-score gap below which the top two candidates are considered ambiguous. */
const UTA_NET_AMBIGUOUS_GAP = 0.10;

/**
 * Fetch and validate Uta-Net lyrics.
 *
 * Unlike the old behaviour (blindly take the first `/song/{id}/` link), this
 * parses every search result, ranks them with the same `titleScore`/
 * `artistScore` used by the LRCLIB fuzzy search, and only accepts a candidate
 * that clears real title AND artist thresholds. When no candidate qualifies
 * the function returns null so the source chain falls through instead of
 * importing another song's lyrics. The winning candidate's metadata is exposed
 * for the low-confidence review flow.
 */
export async function fetchFromUtaNet(
  title: string,
  artist: string,
  signal?: AbortSignal,
  opts?: { timeoutMs?: number },
): Promise<UtaNetHit | null> {
  const timeoutMs = opts?.timeoutMs ?? 15000;
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept-Language': 'ja,en;q=0.9',
  };

  let candidates: UtaNetCandidate[] = [];
  try {
    const q = encodeURIComponent(`${title} ${artist}`);
    const res = await fetchWithTimeout(`https://www.uta-net.com/search/?Keyword=${q}&x=0&y=0&Aselect=2&Bselect=3`, { headers, signal }, timeoutMs);
    if (!res.ok) return null;
    candidates = parseUtaNetCandidates(await res.text());
  } catch {
    if (signal?.aborted) throw signal.reason;
    return null;
  }
  if (candidates.length === 0) return null;

  // Score every candidate. Artist is required to partially match when we have
  // artist info to check against — same policy as the LRCLIB fuzzy search.
  const hasRequestedArtist = artist.trim().length > 0;
  const scored = candidates
    .map((c) => {
      const tScore = titleScore(title, c.title);
      const aScore = hasRequestedArtist ? artistScore(artist, c.artist) : 0.5;
      return {
        candidate: c,
        tScore,
        aScore,
        score: tScore * 0.7 + aScore * 0.3,
      };
    })
    .filter((s) => s.tScore >= UTA_NET_MIN_SCORE)
    .filter((s) => !hasRequestedArtist || (s.candidate.artist && s.aScore >= UTA_NET_MIN_SCORE))
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return null;
  const best = scored[0];

  // Ambiguous when the runner-up is close enough that we can't be confident the
  // top candidate is the intended recording (e.g. same-name different artist or
  // a cover that ranks just behind the original).
  const ambiguous = scored.length > 1
    && best.score - scored[1].score < UTA_NET_AMBIGUOUS_GAP;

  const lyrics = await fetchUtaNetLyrics(best.candidate.songId, headers, timeoutMs);
  if (!lyrics) return null;

  return {
    result: lyrics,
    matchedTitle: best.candidate.title,
    matchedArtist: best.candidate.artist,
    link: `https://www.uta-net.com/song/${best.candidate.songId}/`,
    score: best.score,
    ambiguous,
  };
}

// ─── ytmusicapi sidecar ──

export async function fetchFromYtMusic(
  title: string,
  artist: string,
  signal?: AbortSignal,
  opts?: { sidecarUrl?: string; timeoutMs?: number },
): Promise<LyricsResult | null> {
  // Row-configured sidecar URL takes precedence; env var is the legacy fallback.
  const sidecarUrl = opts?.sidecarUrl?.trim() || process.env.YT_MUSIC_SIDECAR_URL;
  if (!sidecarUrl) return null;
  try {
    const res = await fetchWithTimeout(
      `${sidecarUrl}/lyrics?q=${encodeURIComponent(`${title} ${artist}`)}`,
      { signal },
      opts?.timeoutMs ?? 20000,
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.plain && !data.lyrics) return null;
    return { synced: data.synced || '', plain: data.plain || data.lyrics || '' };
  } catch {
    if (signal?.aborted) throw signal.reason;
    return null;
  }
}

// ─── Full chain ──

/**
 * Which lyrics source the fetch chain is currently querying. Emitted through
 * {@link FetchLyricsOptions.onStage} so long syncs can surface real-time
 * progress ("正在查询 LRCLIB…" etc.) and a cancel affordance instead of a
 * frozen spinner.
 */
export type SyncStage =
  | 'lrclib'        // LRCLIB exact + Spotify canonical name
  | 'lrclib-search' // LRCLIB fuzzy search
  | 'petitlyrics'
  | 'uta-net'
  | 'ytmusic';

/**
 * Dynamic provider stage used by the SSE UI. Keeps the legacy `SyncStage`
 * string keys for backward compatibility while also carrying a display name
 * and kind so third-party HTTP providers can surface their own name without
 * hardcoding third-party strings into i18n (ISSUE #148).
 */
export type DynamicStage = ProviderStage;

/** Map a legacy SyncStage to a display name used by the SSE stage events. */
export function syncStageToProviderStage(stage: SyncStage): ProviderStage {
  const names: Record<SyncStage, string> = {
    'lrclib': 'LRCLIB',
    'lrclib-search': 'LRCLIB',
    'petitlyrics': 'PetitLyrics',
    'uta-net': 'Uta-Net',
    'ytmusic': 'YouTube Music',
  };
  return { id: stage, displayName: names[stage] ?? 'Lyrics', kind: 'builtin' };
}

/** Same as {@link syncStageToProviderStage} but accepts any string (unknown keys fall back). */
export function syncStageToDynamicProviderStage(stage: string): ProviderStage {
  return syncStageToProviderStage(stage as SyncStage);
}

export interface FetchLyricsOptions {
  /** Use Spotify canonical name for CJK variant matching */
  spotifyCanonical?: { name: string; artist: string } | null;
  /** Spotify-side evidence (album + durationMs) used to disambiguate recordings. */
  spotify?: LrclibEvidence;
  /**
   * Invoked right before each source is queried, letting a streaming caller
   * surface which provider is being contacted. No-op when omitted (import /
   * playlist-import keep the existing behaviour). Receives either a legacy
   * string stage (backward compatible) or a dynamic provider stage.
   */
  onStage?: (stage: SyncStage | ProviderStage) => void;
  /**
   * Caller-provided abort signal propagated to every builtin + HTTP provider.
   * A cancelled sync must actually stop subsequent network requests (issue #129
   * hardening).
   */
  signal?: AbortSignal;
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

  // Tracks whether lrclib (the preferred timed-lyrics source) was throttled.
  // When every source fails AND lrclib was rate-limited we want to report a
  // distinct "retry later" outcome instead of a misleading "no lyrics found".
  let rateLimited = false;
  const signal = opts?.signal;
  const stage = opts?.onStage;
  // A stage callback may accept either a legacy string or a dynamic provider
  // stage; pass the legacy string for the builtin chain (backward compatible).
  const emit = (s: SyncStage) => stage?.(s);

  // 1. LRCLIB exact
  emit('lrclib');
  let outcome = await fetchFromLrclib(title, artist, evidence, signal);
  rateLimited = rateLimited || outcome.rateLimited;
  if (outcome.hit) return fetchedResult(outcome.hit.result, 'lrclib', lrclibConfidence(outcome.hit, 98, true), outcome.hit.duration === 'conflict');

  // 2. LRCLIB with Spotify canonical name
  if (opts?.spotifyCanonical) {
    emit('lrclib');
    outcome = await fetchFromLrclib(opts.spotifyCanonical.name, opts.spotifyCanonical.artist, evidence, signal);
    rateLimited = rateLimited || outcome.rateLimited;
    if (outcome.hit) return fetchedResult(outcome.hit.result, 'lrclib', lrclibConfidence(outcome.hit, 96, true), outcome.hit.duration === 'conflict');
    emit('lrclib-search');
    outcome = await searchLrclib(`${opts.spotifyCanonical.name} ${opts.spotifyCanonical.artist}`, opts.spotifyCanonical.name, opts.spotifyCanonical.artist, evidence, signal);
    rateLimited = rateLimited || outcome.rateLimited;
    if (outcome.hit) return fetchedResult(outcome.hit.result, 'lrclib-search', lrclibConfidence(outcome.hit, 82, false));
  }

  // 3. LRCLIB fuzzy search
  emit('lrclib-search');
  outcome = await searchLrclib(`${title} ${artist}`, title, artist, evidence, signal);
  rateLimited = rateLimited || outcome.rateLimited;
  if (outcome.hit) return fetchedResult(outcome.hit.result, 'lrclib-search', lrclibConfidence(outcome.hit, 78, false));

  // 4. PetitLyrics
  emit('petitlyrics');
  const pl = await fetchFromPetitLyrics(title, artist, signal);
  if (pl && (pl.synced || pl.plain)) {
    return { ...fetchedResult(pl, 'petitlyrics', pl.synced ? 90 : 82), rateLimited };
  }

  // 5. Uta-Net
  emit('uta-net');
  const un = await fetchFromUtaNet(title, artist, signal);
  if (un) {
    return {
      ...fetchedResult(
        un.result,
        'uta-net',
        utaNetConfidence(un.score),
        false,
        { title: un.matchedTitle, artist: un.matchedArtist, link: un.link, ambiguous: un.ambiguous },
      ),
      rateLimited,
    };
  }

  // 6. ytmusicapi
  emit('ytmusic');
  const yt = await fetchFromYtMusic(title, artist, signal);
  if (yt) return { ...fetchedResult(yt, 'ytmusic', yt.synced ? 74 : 68), rateLimited };

  return { result: null, source: '', confidence: 0, rateLimited };
}
