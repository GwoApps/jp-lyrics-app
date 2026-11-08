import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSsePayload } from './sse-protocol.ts';

test('full refresh SSE payload carries complete state in d', () => {
  const full = { connected: true, progress_ms: 123, track: { id: 'track' } };
  const payload = buildSsePayload(full, { seq: 7, c: 42, d: { progress_ms: 123 } }, true);
  assert.deepEqual(payload, { seq: 7, c: 42, d: full, v: 2, _full: true });
});

test('normal SSE payload keeps the diff and adds protocol version', () => {
  const diff = { seq: 8, c: 43, d: { progress_ms: 456 } };
  assert.deepEqual(buildSsePayload({ connected: true, progress_ms: 456 }, diff, false), { ...diff, v: 2 });
});

test('seek observation timestamp remains outside the checksum-protected data', () => {
  const full = { connected: true, progress_ms: 123 };
  const diff = { seq: 9, c: 42, d: { progress_ms: 123 }, _observedAt: 1000 };
  assert.deepEqual(buildSsePayload(full, diff, false), { ...diff, v: 2 });
  assert.deepEqual(buildSsePayload(full, diff, true), { ...diff, d: full, v: 2, _full: true });
});

test('a cleared field survives JSON serialisation as an explicit null (issue #370)', () => {
  // `undefined` is dropped by JSON.stringify, so a recovered upstream would look
  // like "still failing" on the client unless the cleared code is sent as null.
  const cleared = { seq: 10, c: 44, d: { error: null, progress_ms: 900 } };
  const roundTripped = JSON.parse(JSON.stringify(
    buildSsePayload<{ connected: boolean; error?: number; progress_ms?: number }>({ connected: true }, cleared, false),
  ));
  assert.deepEqual(roundTripped.d, { error: null, progress_ms: 900 });
  assert.equal('error' in roundTripped.d, true, 'the cleared error is still present');
});
