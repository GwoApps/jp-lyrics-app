/**
 * Exponential backoff shared by the client poller and the server-side poller.
 * Delay sequence: 2s → 4s → 6s, capped at 6s (requirement: retry wait must not exceed 6s).
 */
export const RETRY_BASE_DELAY_MS = 2000;
export const RETRY_MAX_DELAY_MS = 6000;

/** Consecutive failures before polling is permanently stopped (until the user resumes manually). */
export const MAX_CONSECUTIVE_ERRORS = 4;

/** Backoff delay for the Nth consecutive failure, capped at 6s. */
export function backoffDelay(consecutiveErrors: number): number {
  return Math.min(RETRY_BASE_DELAY_MS * Math.pow(2, consecutiveErrors - 1), RETRY_MAX_DELAY_MS);
}
