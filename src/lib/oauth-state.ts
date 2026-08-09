/**
 * OAuth `state` parameter helpers for the Spotify authorization-code flow.
 *
 * The `state` value binds an authorization request to the browser session that
 * initiated it, mitigating Login CSRF / session-swapping: an attacker cannot
 * replay a callback URL produced by *their* Spotify grant onto a victim's
 * browser, because the `state` in the query string would not match the one in
 * the victim's cookie.
 *
 * Cookie layout: `jplrc_oauth_state`, HttpOnly + SameSite=Lax, short-lived
 * (5 minutes), path-scoped to the callback so it is only sent when the
 * callback actually fires and is never exposed to any other endpoint.
 */

export const OAUTH_STATE_COOKIE = 'jplrc_oauth_state';
export const OAUTH_STATE_MAX_AGE = 5 * 60; // seconds
export const OAUTH_STATE_PATH = '/api/auth/callback';

/** Generate a fresh high-entropy state value for a new authorization request. */
export async function generateOAuthState(): Promise<string> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let value = '';
  for (const byte of bytes) {
    value += byte.toString(16).padStart(2, '0');
  }
  return value;
}

/**
 * Constant-time comparison of two state strings. Prevents timing side channels
 * from leaking the expected state value byte-by-byte.
 */
export function safeStateEqual(actual: string | null | undefined, expected: string | null | undefined): boolean {
  if (typeof actual !== 'string' || typeof expected !== 'string') return false;
  const left = new TextEncoder().encode(actual);
  const right = new TextEncoder().encode(expected);
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}
