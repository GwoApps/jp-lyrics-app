/**
 * Session token signing/verification.
 *
 * Token layout: `base64url(userId).timestamp.base64url(hmac-sha256)`
 *
 * The user id (usually the Spotify profile email) may contain `.`, `@` or any
 * Unicode characters, so it is base64url-encoded before being embedded. This
 * guarantees the `userId.ts.sig` field boundaries can never be corrupted by the
 * id itself — the historical bug that made `john.doe@example.com` sessions fail
 * to verify.
 *
 * Legacy tokens that signed the plain id (`userId.ts.sig`, only ever produced
 * for dot-free ids) are still accepted for backward compatibility.
 */

export const SESSION_MAX_AGE = 30 * 24 * 60 * 60; // 30 days

function resolveSecret(): string {
  return process.env.SESSION_SECRET || process.env.SPOTIFY_CLIENT_SECRET || 'jplrc-fallback';
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

/** base64url-encode a user id so it never contains `.` or other delimiters. */
function encodeUserId(userId: string): string {
  const bytes = new TextEncoder().encode(userId);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Decode a base64url-encoded user id. Returns null when not valid base64url. */
function decodeUserId(encoded: string): string | null {
  try {
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
      + '==='.slice((encoded.length + 3) % 4);
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Sign a user id into a cookie value: `base64url(userId).timestamp.signature`.
 * `secret` may be overridden for tests; production callers omit it.
 */
export async function signSession(userId: string, secret: string = resolveSecret()): Promise<string> {
  const ts = Math.floor(Date.now() / 1000);
  const payload = `${encodeUserId(userId)}.${ts}`;
  const key = await getSigningKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return `${payload}.${toBase64Url(new Uint8Array(sig))}`;
}

/**
 * Verify a session cookie value and return the user id if valid.
 * Returns null if tampered, expired, or malformed.
 *
 * Supports both current (`base64url(userId).ts.sig`) and legacy (`userId.ts.sig`)
 * tokens. Parsing walks from the right so dots inside a legacy plain id cannot
 * corrupt the timestamp/signature split.
 */
export async function verifySession(token: string, secret: string = resolveSecret()): Promise<string | null> {
  const parts = token.split('.');
  if (parts.length < 3) return null;

  const tsStr = parts[parts.length - 2];
  const sigB64 = parts[parts.length - 1];
  const userIdField = parts.slice(0, parts.length - 2).join('.');

  const ts = parseInt(tsStr, 10);
  if (!userIdField || isNaN(ts)) return null;

  // Check expiry
  const now = Math.floor(Date.now() / 1000);
  if (now - ts > SESSION_MAX_AGE) return null;

  // Current tokens carry a base64url-encoded id; legacy tokens carry the plain id.
  // Legacy ids always contain `:` (spotify:...) or `@` (email), neither of which is
  // in the base64url alphabet, so decoding is only attempted for pure-base64url fields.
  const userId = /^[A-Za-z0-9_-]+$/.test(userIdField)
    ? (decodeUserId(userIdField) ?? userIdField)
    : userIdField;

  // Reconstruct the exact signed payload. Newer tokens were signed over the
  // encoded id, legacy tokens over the plain id — in both cases that is the
  // raw userIdField text, so the payload string is `userIdField.ts`.
  const payload = `${userIdField}.${ts}`;
  const key = await getSigningKey(secret);

  let sigBytes: ArrayBuffer;
  try {
    const base64 = sigB64.replace(/-/g, '+').replace(/_/g, '/')
      + '==='.slice((sigB64.length + 3) % 4);
    sigBytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0)).buffer;
  } catch {
    return null;
  }

  const valid = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(payload));
  return valid ? userId : null;
}
