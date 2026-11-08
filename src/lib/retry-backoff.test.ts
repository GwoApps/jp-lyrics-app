import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decidePollFailure,
  backoffDelay,
  MAX_CONSECUTIVE_ERRORS,
  RETRY_MAX_DELAY_MS,
  RETRY_BASE_DELAY_MS,
} from './retry-backoff.ts';

test('exponential backoff: 2s → 4s → 6s, capped at 6s', () => {
  // Requirement: retry wait must never exceed 6s.
  assert.equal(backoffDelay(1), 2000);
  assert.equal(backoffDelay(2), 4000);
  assert.equal(backoffDelay(3), 6000);
  // Beyond the cap, the delay stays at 6s (never exceeds the cap).
  assert.equal(backoffDelay(4), 6000);
  assert.equal(backoffDelay(10), 6000);
  // Cap constant is 6s.
  assert.equal(RETRY_MAX_DELAY_MS, 6000);
});

/**
 * Issue #370 — a poll that never got an answer (timeout) must not be treated as
 * a failure streak. Counting it would walk the user into "sync stopped, resume
 * manually" after a few seconds of upstream jitter, and the pre-fix behaviour
 * was worse: a hanging request reached neither branch, so sync froze silently.
 */
test('a timeout keeps retrying with backoff and never accumulates errors', () => {
  // Even far past the threshold, a timeout must not stop sync.
  for (const consecutiveErrors of [1, 2, MAX_CONSECUTIVE_ERRORS, MAX_CONSECUTIVE_ERRORS + 5]) {
    const decision = decidePollFailure({ timedOut: true, consecutiveErrors });
    assert.equal(decision.state, 'retrying');
    assert.equal(decision.consecutiveErrors, 0, 'the timeout streak is not accumulated');
    assert.ok(decision.delayMs > 0 && decision.delayMs <= RETRY_MAX_DELAY_MS, 'retry stays within the 6s cap');
    assert.equal(decision.delayMs, RETRY_BASE_DELAY_MS);
  }
});

test('real errors still stop polling after the threshold', () => {
  const retrying = decidePollFailure({ timedOut: false, consecutiveErrors: MAX_CONSECUTIVE_ERRORS - 1 });
  assert.equal(retrying.state, 'retrying');
  assert.equal(retrying.consecutiveErrors, MAX_CONSECUTIVE_ERRORS - 1);

  const stopped = decidePollFailure({ timedOut: false, consecutiveErrors: MAX_CONSECUTIVE_ERRORS });
  assert.equal(stopped.state, 'stopped');
  assert.equal(stopped.delayMs, 0, 'a stopped poller schedules nothing');
});
