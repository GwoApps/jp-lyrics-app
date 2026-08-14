/**
 * Candidate token signing/verification for the lyrics sync confirmation flow.
 *
 * The sync route returns a low-confidence or plain-text candidate for review.
 * Previously, confirming re-ran the whole fetch chain, so the second request
 * could return a *different* candidate than the one the user reviewed (TOCTOU).
 *
 * To fix that, when a candidate is offered for review the server issues a
 * short-lived signed token that carries the candidate's exact content. The
 * client only echoes the token back on confirmation; the server validates it
 * and atomically writes exactly the reviewed candidate — no re-fetch.
 *
 * Token layout:
 *   `base64url(payloadJson).timestamp.base64url(hmac-sha256)`
 *
 * The signature makes the token unforgeable; the embedded `updatedAt` of the
 * song lets us detect a concurrent edit; the timestamp bounds its lifetime so
 * a stale token can never silently overwrite newer lyrics.
 */

export const CANDIDATE_MAX_AGE = 10 * 60; // seconds — candidate preview must be confirmed quickly

function resolveSecret(): string {
  return process.env.CANDIDATE_SECRET || process.env.SESSION_SECRET || process.env.SPOTIFY_CLIENT_SECRET || 'jplrc-fallback';
}

async function getSigningKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
    + '==='.slice((value.length + 3) % 4);
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

/**
 * Content that must match exactly what was offered to the user. Everything
 * that influences the persisted row or the review experience is included so a
 * tampered token cannot silently swap in different lyrics.
 */
export interface CandidateTokenPayload {
  /** Song id this token is bound to. */
  song: string;
  /** Lyrics source key (e.g. `lrclib-search`, `ytmusic`). */
  source: string;
  /** Heuristic 0–100 confidence shown in the review UI. */
  confidence: number;
  /** The exact plain-lyrics text to persist as `lyricsRaw`. */
  plain: string;
  /** The exact synced LRC text to persist as `lyricsSynced` ('' for plain hits). */
  synced: string;
  /** `updatedAt` of the song when the token was issued — used to detect a concurrent edit. */
  updatedAt: string;
}

/** Compute a stable hex hash of a string (SHA-256, first 16 hex chars). */
export async function contentHash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (const byte of bytes.slice(0, 8)) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

/** Sign a candidate payload into a short-lived, unforgeable token. */
export async function signCandidate(
  payload: CandidateTokenPayload,
  secret: string = resolveSecret(),
): Promise<string> {
  const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
  const ts = Math.floor(Date.now() / 1000);
  const body = `${encoded}.${ts}`;
  const key = await getSigningKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return `${body}.${toBase64Url(new Uint8Array(sig))}`;
}

export type CandidateTokenResult =
  | { ok: true; payload: CandidateTokenPayload }
  | { ok: false; reason: 'malformed' | 'expired' | 'tampered' };

/**
 * Verify a candidate token and return its payload when valid.
 * Returns `malformed` for structurally broken tokens, `expired` when the
 * token is older than `CANDIDATE_MAX_AGE`, `tampered` when the signature,
 * the embedded payload, or the timestamp does not match the signer.
 */
export async function verifyCandidate(
  token: string,
  secret: string = resolveSecret(),
): Promise<CandidateTokenResult> {
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };

  const [encoded, tsStr, sigB64] = parts;
  const ts = parseInt(tsStr, 10);
  if (!encoded || isNaN(ts)) return { ok: false, reason: 'malformed' };

  const now = Math.floor(Date.now() / 1000);
  if (now - ts > CANDIDATE_MAX_AGE || ts > now + 60) return { ok: false, reason: 'expired' };

  const body = `${encoded}.${ts}`;
  const key = await getSigningKey(secret);

  let sigBytes: ArrayBuffer;
  try {
    const uint = fromBase64Url(sigB64);
    sigBytes = new Uint8Array(uint).buffer;
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  const valid = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(body));
  if (!valid) return { ok: false, reason: 'tampered' };

  let payload: CandidateTokenPayload;
  try {
    payload = JSON.parse(decodeURIComponent(escape(atob(encoded))));
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  if (!payload || typeof payload !== 'object'
    || typeof payload.song !== 'string'
    || typeof payload.source !== 'string'
    || typeof payload.confidence !== 'number'
    || typeof payload.plain !== 'string'
    || typeof payload.synced !== 'string'
    || typeof payload.updatedAt !== 'string') {
    return { ok: false, reason: 'tampered' };
  }

  return { ok: true, payload };
}
