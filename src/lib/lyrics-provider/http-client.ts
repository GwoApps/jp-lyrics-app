/**
 * HTTP lyrics provider protocol client (ISSUE #148, "HTTP Provider Protocol v1").
 *
 *   GET  {normalized_base_url}/manifest.json
 *   POST {normalized_base_url}/v1/search
 *
 * All requests are server-initiated (never by the browser), use `redirect:
 * 'error'` (no redirects followed), stream-limit the response to 1 MiB, and
 * validate the protocol version + schema strictly. Provider-reported confidence
 * is NEVER trusted — the caller re-scores candidates.
 */
import type {
  LyricsProviderQuery,
  ProviderCandidate,
  ProviderOutcome,
  ProviderStatus,
} from './types.ts';
import { deriveEndpoints, validateProviderBaseUrl, getNetworkPolicy } from './policy.ts';
import { MAX_CANDIDATES_PER_PROVIDER, MAX_LYRICS_CHARS, MAX_RESPONSE_BYTES } from './normalize.ts';

export const PROTOCOL_NAME = 'jplrc-lyrics-provider';
export const PROTOCOL_VERSION = 1;

/** Parsed manifest after strict validation. */
export interface ProviderManifest {
  id: string;
  name: string;
  version: string;
  capabilities: string[];
  limits: { maxCandidates: number };
}

/** Structured search request body (mirrors the protocol contract). */
interface SearchRequestBody {
  protocol_version: number;
  request_id: string;
  track: {
    title: string;
    artists: string[];
    album?: string | null;
    duration_ms?: number | null;
    isrc?: string | null;
    spotify_track_id?: string | null;
    locale?: string | null;
  };
  accept: string[];
  max_candidates: number;
}

/** Config needed to run a single HTTP provider instance. */
export interface HttpProviderConfig {
  baseUrl: string;
  authType: 'none' | 'bearer';
  authSecret?: string | null; // decrypted bearer token
  timeoutMs?: number | null;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Validate a manifest response. Returns `{ ok: true, manifest }` or a
 * language-neutral failure code.
 */
export function parseManifest(raw: unknown): { ok: true; manifest: ProviderManifest } | { ok: false; code: string } {
  if (!isPlainObject(raw)) return { ok: false, code: 'invalid_response' };
  if (raw.protocol !== PROTOCOL_NAME) return { ok: false, code: 'protocol_mismatch' };
  if (raw.protocol_version !== PROTOCOL_VERSION) return { ok: false, code: 'protocol_version' };
  if (typeof raw.id !== 'string' || !raw.id) return { ok: false, code: 'invalid_response' };
  if (typeof raw.name !== 'string') return { ok: false, code: 'invalid_response' };
  if (typeof raw.version !== 'string') return { ok: false, code: 'invalid_response' };
  const capabilities = Array.isArray(raw.capabilities)
    ? raw.capabilities.filter((c): c is string => typeof c === 'string')
    : [];
  let maxCandidates = 10;
  if (isPlainObject(raw.limits) && typeof raw.limits.max_candidates === 'number') {
    maxCandidates = Math.max(1, Math.min(MAX_CANDIDATES_PER_PROVIDER, Math.floor(raw.limits.max_candidates)));
  }
  return {
    ok: true,
    manifest: {
      id: raw.id,
      name: raw.name,
      version: raw.version,
      capabilities,
      limits: { maxCandidates },
    },
  };
}

/**
 * Validate a single search candidate. Returns a safe candidate or null (dropped).
 * Every candidate must carry at least plain or synced lyrics.
 */
export function parseCandidate(raw: unknown): ProviderCandidate | null {
  if (!isPlainObject(raw)) return null;
  const title = typeof raw.title === 'string' ? raw.title : '';
  const artists = Array.isArray(raw.artists) ? raw.artists.filter((a): a is string => typeof a === 'string') : [];
  const plain = typeof raw.plain_lyrics === 'string' ? raw.plain_lyrics : '';
  const synced = typeof raw.synced_lyrics === 'string' ? raw.synced_lyrics : '';
  if (!plain && !synced) return null; // must carry at least one lyric form
  if (plain.length > MAX_LYRICS_CHARS || synced.length > MAX_LYRICS_CHARS) return null;
  let sourceUrl: string | undefined;
  if (typeof raw.source_url === 'string' && /^https:/.test(raw.source_url)) sourceUrl = raw.source_url;
  return {
    candidateId: typeof raw.candidate_id === 'string' ? raw.candidate_id : undefined,
    title,
    artists,
    album: typeof raw.album === 'string' ? raw.album : undefined,
    durationMs: typeof raw.duration_ms === 'number' ? raw.duration_ms : undefined,
    plainLyrics: plain || undefined,
    syncedLyrics: synced || undefined,
    sourceUrl,
  };
}

/** Stream a response body, aborting as soon as it exceeds `maxBytes`. */
async function readLimited(res: Response, maxBytes: number): Promise<string | null> {
  const reader = res.body?.getReader();
  if (!reader) {
    try {
      return await res.text();
    } catch {
      return null;
    }
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null; // too large → invalid_response
      }
      chunks.push(value);
    }
  }
  return chunks.length ? decoder.decode(Buffer.concat(chunks)) : '';
}

function mapHttpStatus(status: number): ProviderStatus {
  if (status === 200) return 'empty';
  if (status === 400 || status === 422) return 'invalid_request';
  if (status === 401 || status === 403) return 'auth_failed';
  if (status === 408) return 'timeout';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'temporary_unavailable';
  return 'error';
}

/** Parse the optional error body (controlled/truncated diagnostic only). */
function parseErrorBody(body: string | null): { retryAfterMs?: number; diagnostic?: string } {
  if (!body) return {};
  try {
    const data = JSON.parse(body) as { error?: { code?: string; message?: string; retry_after_ms?: number } };
    const retryAfterMs = typeof data.error?.retry_after_ms === 'number' ? data.error.retry_after_ms : undefined;
    const message = typeof data.error?.message === 'string' ? data.error.message.slice(0, 200) : undefined;
    return { ...(retryAfterMs ? { retryAfterMs } : {}), ...(message ? { diagnostic: message } : {}) };
  } catch {
    return {};
  }
}

/**
 * Fetch the manifest for a provider and validate it. Returns the validated
 * manifest, or a language-neutral error code (null when the policy rejected
 * the base URL first).
 */
export async function fetchManifest(config: HttpProviderConfig, timeoutMs: number): Promise<
  { ok: true; manifest: ProviderManifest; latencyMs: number; insecure: boolean }
  | { ok: false; code: string; latencyMs: number; insecure: boolean }
> {
  const start = Date.now();
  const policyError = await validateProviderBaseUrl(config.baseUrl, getNetworkPolicy());
  if (policyError) {
    return { ok: false, code: policyError, latencyMs: Date.now() - start, insecure: false };
  }
  const insecure = config.baseUrl.startsWith('http:');
  const { manifestUrl } = deriveEndpoints(config.baseUrl);
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (config.authType === 'bearer' && config.authSecret) {
    headers.Authorization = `Bearer ${config.authSecret}`;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(manifestUrl, {
      headers,
      redirect: 'error',
      signal: controller.signal,
    });
    const body = await readLimited(res, MAX_RESPONSE_BYTES);
    const latencyMs = Date.now() - start;
    if (!res.ok) {
      return { ok: false, code: mapHttpStatus(res.status), latencyMs, insecure };
    }
    if (body === null) return { ok: false, code: 'invalid_response', latencyMs, insecure };
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return { ok: false, code: 'invalid_response', latencyMs, insecure };
    }
    const result = parseManifest(parsed);
    if (!result.ok) return { ok: false, code: result.code, latencyMs, insecure };
    return { ok: true, manifest: result.manifest, latencyMs, insecure };
  } catch (err) {
    const latencyMs = Date.now() - start;
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, code: 'timeout', latencyMs, insecure };
    }
    return { ok: false, code: 'error', latencyMs, insecure };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run a search against an HTTP provider. Returns a structured outcome with
 * validated candidates (already HTML-decoded and size-limited by the caller's
 * scoring pipeline downstream).
 */
export async function searchHttpProvider(
  config: HttpProviderConfig,
  query: LyricsProviderQuery,
  timeoutMs: number,
  requestId: string,
): Promise<ProviderOutcome> {
  const policyError = await validateProviderBaseUrl(config.baseUrl, getNetworkPolicy());
  if (policyError) {
    return { status: 'error', candidates: [], diagnostic: policyError };
  }
  const { searchUrl } = deriveEndpoints(config.baseUrl);
  const body: SearchRequestBody = {
    protocol_version: PROTOCOL_VERSION,
    request_id: requestId,
    track: {
      title: query.title,
      artists: query.artists,
      album: query.album ?? null,
      duration_ms: query.durationMs ?? null,
      isrc: query.isrc ?? null,
      spotify_track_id: query.spotifyTrackId ?? null,
      locale: query.locale ?? null,
    },
    accept: ['synced', 'plain'],
    max_candidates: MAX_CANDIDATES_PER_PROVIDER,
  };
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'User-Agent': 'jp-lyrics-app/1.0',
  };
  if (config.authType === 'bearer' && config.authSecret) {
    headers.Authorization = `Bearer ${config.authSecret}`;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(searchUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      redirect: 'error',
      signal: controller.signal,
    });
    const rawBody = await readLimited(res, MAX_RESPONSE_BYTES);
    if (rawBody === null) return { status: 'invalid_response', candidates: [] };
    if (!res.ok) {
      const { retryAfterMs, diagnostic } = parseErrorBody(rawBody);
      const status = mapHttpStatus(res.status);
      if (status === 'rate_limited' && retryAfterMs) {
        return { status, candidates: [], retryAfterMs: Math.min(retryAfterMs, 30_000), diagnostic };
      }
      return { status, candidates: [], ...(diagnostic ? { diagnostic } : {}) };
    }
    let data: unknown;
    try {
      data = JSON.parse(rawBody);
    } catch {
      return { status: 'invalid_response', candidates: [] };
    }
    if (!isPlainObject(data) || data.protocol_version !== PROTOCOL_VERSION) {
      return { status: 'invalid_response', candidates: [] };
    }
    if (!Array.isArray(data.candidates)) {
      return { status: 'invalid_response', candidates: [] };
    }
    const candidates: ProviderCandidate[] = [];
    for (const raw of data.candidates.slice(0, MAX_CANDIDATES_PER_PROVIDER)) {
      const c = parseCandidate(raw);
      if (c) candidates.push(c);
    }
    return { status: 'hit', candidates };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { status: 'timeout', candidates: [] };
    }
    return { status: 'error', candidates: [] };
  } finally {
    clearTimeout(timer);
  }
}
