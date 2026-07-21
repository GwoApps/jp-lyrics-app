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
