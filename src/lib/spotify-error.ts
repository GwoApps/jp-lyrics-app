/**
 * Spotify playback status error classification.
 *
 * The playback-status chain folds every non-2xx Spotify API response into a
 * single `error` status code. This module tells callers whether that code
 * represents an **auth** problem (which the user can fix by reconnecting) or a
 * **transient** problem (rate limit / server outage — auto-retry, do NOT ask
 * the user to re-login).
 *
 * - Auth: 401 (token expired/invalid) or 403 (forbidden / missing scope).
 * - Transient: 429 (rate limited) or any 5xx (Spotify service fault).
 * - Anything else is treated as transient too: it is safer to auto-retry than
 *   to mislead the user into reconnecting.
 */

/** True when the error can only be resolved by re-authorizing with Spotify. */
export function isSpotifyAuthError(status: number | undefined): boolean {
  return status === 401 || status === 403;
}

/**
 * True when the error is a temporary Spotify-side fault (rate limit / 5xx)
 * that should be auto-retried instead of asking the user to reconnect.
 */
export function isSpotifyTransientError(status: number | undefined): boolean {
  if (status === undefined || status === null) return false;
  if (status === 429) return true;
  return status >= 500;
}
