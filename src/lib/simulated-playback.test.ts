import test from 'node:test';
import assert from 'node:assert/strict';
import { clockPosition, previewTimeline } from './simulated-playback.ts';

const line = (text: string) => ({ segments: [{ text, reading: '' }] });
test('silent clock advances, pauses, clamps and ignores negative elapsed time', () => {
  assert.equal(clockPosition({ positionMs: 1000, startedAt: 100, playing: true }, 600, 5000), 1500);
  assert.equal(clockPosition({ positionMs: 1000, startedAt: 100, playing: false }, 600, 5000), 1000);
  assert.equal(clockPosition({ positionMs: 4900, startedAt: 100, playing: true }, 600, 5000), 5000);
  assert.equal(clockPosition({ positionMs: 1000, startedAt: 100, playing: true }, 0, 5000), 1000);
});
test('real lyric timing remains authoritative, with an ending beyond the last lyric', () => {
  const timestamps = [12000, null, 40000];
  const result = previewTimeline(timestamps, [line('A'), line(''), line('B')], 60000);
  assert.equal(result.timestamps, timestamps);
  assert.equal(result.durationMs, 60000);
  assert.equal(result.estimated, false);
  assert.equal(previewTimeline(timestamps, [], null).durationMs, 41000);
});
test('untimed preview estimates only nonempty lines and never mutates source timing', () => {
  const timestamps = [null, null, null, null];
  const result = previewTimeline(timestamps, [line('A'), line(' '), line('B'), line('C')], 12000);
  assert.deepEqual(result.timestamps, [0, null, 4000, 8000]);
  assert.deepEqual(timestamps, [null, null, null, null]);
  assert.equal(result.estimated, true);
  assert.equal(previewTimeline([], [line('A'), line('B')]).durationMs, 8000);
});
test('empty preview stays bounded and invalid metadata is not used', () => {
  assert.deepEqual(previewTimeline([], [], NaN), { timestamps: [], durationMs: 4000, estimated: true });
  assert.equal(previewTimeline([], [line('A')], -1).durationMs, 4000);
});
