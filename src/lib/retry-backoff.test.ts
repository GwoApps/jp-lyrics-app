import test from 'node:test';
import assert from 'node:assert/strict';
import { backoffDelay, RETRY_MAX_DELAY_MS } from './retry-backoff.ts';

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
