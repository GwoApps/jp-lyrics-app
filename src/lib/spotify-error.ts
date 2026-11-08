/**
 * Spotify playback status error classification.
 *
 * The playback-status chain folds every non-2xx Spotify API response into a
 * single `error` status code. This module tells callers whether that code
 * represents an **auth** problem (which the user can fix by reconnecting) or a
 * **transient** problem (rate limit / server outage / timeout — auto-retry, do
 * NOT ask the user to re-login).
 *
 * - Auth: 401 (token expired/invalid) or 403 (forbidden / missing scope).
 * - Transient: 429 (rate limited), any 5xx, or {@link SPOTIFY_TIMEOUT_STATUS}.
 * - Anything else is treated as transient too: it is safer to auto-retry than
 *   to mislead the user into reconnecting.
 */

/**
 * Synthetic code for "our own deadline fired before Spotify answered".
 *
 * The play-status field carries an HTTP status, so a hang needs a number: 504
 * is the honest one (gateway did not get an upstream response) and is distinct
 * from the auth codes — a timeout must never be reported as "reconnect your
 * account" the way an expired token is (issue #117, #370).
 */
export const SPOTIFY_TIMEOUT_STATUS = 504;

/** True when the error can only be resolved by re-authorizing with Spotify. */
export function isSpotifyAuthError(status: number | undefined): boolean {
  return status === 401 || status === 403;
}

/** True when the code means the request was abandoned by our own deadline. */
export function isSpotifyTimeoutError(status: number | undefined): boolean {
  return status === SPOTIFY_TIMEOUT_STATUS;
}

/**
 * True when the error is a temporary fault (rate limit / 5xx / timeout) that
 * should be auto-retried instead of asking the user to reconnect.
 */
export function isSpotifyTransientError(status: number | undefined): boolean {
  if (status === undefined || status === null) return false;
  if (status === 429 || status === SPOTIFY_TIMEOUT_STATUS) return true;
  return status >= 500;
}
