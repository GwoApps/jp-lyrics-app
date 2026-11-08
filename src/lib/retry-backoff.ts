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

export interface PollFailureDecision {
  /** Degraded state the UI should show. */
  state: 'retrying' | 'stopped';
  /** Delay before the next attempt (0 when polling stops). */
  delayMs: number;
  /** Failure counter to keep for the next attempt. */
  consecutiveErrors: number;
}

/**
 * Decide what a failed poll does next.
 *
 * A **timeout is not a failure streak**: the request never got an answer, which
 * says nothing about whether sync can work. Counting it toward
 * `MAX_CONSECUTIVE_ERRORS` would walk the user into "sync stopped, resume
 * manually" after a few seconds of upstream jitter — and before issue #370 a
 * hanging request reached neither branch at all, so sync froze with no signal.
 * Timeouts therefore keep backing off (capped, like every other retry) and never
 * accumulate. Only real errors count toward the permanent stop.
 */
export function decidePollFailure(input: {
  timedOut: boolean;
  consecutiveErrors: number;
  maxConsecutiveErrors?: number;
}): PollFailureDecision {
  const maxErrors = input.maxConsecutiveErrors ?? MAX_CONSECUTIVE_ERRORS;
  if (input.timedOut) {
    return { state: 'retrying', delayMs: backoffDelay(1), consecutiveErrors: 0 };
  }
  if (input.consecutiveErrors >= maxErrors) {
    return { state: 'stopped', delayMs: 0, consecutiveErrors: input.consecutiveErrors };
  }
  return {
    state: 'retrying',
    delayMs: backoffDelay(input.consecutiveErrors),
    consecutiveErrors: input.consecutiveErrors,
  };
}
