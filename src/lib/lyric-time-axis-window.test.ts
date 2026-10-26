import test from 'node:test';
import assert from 'node:assert/strict';
import { timedRowDistances } from './lyric-time-axis-window.ts';

test('time-axis ±2 window skips blank rows on both sides of the active lyric', () => {
  const distances = timedRowDistances([100, 200, null, 300, null, 400, 500, 600], 3);
  assert.deepEqual(distances, [2, 1, null, 0, null, 1, 2, 3]);
  assert.deepEqual(distances.flatMap((d, i) => d != null && d <= 2 ? [i] : []), [0, 1, 3, 5, 6]);
});

test('time-axis window respects the start/end and does not invent missing labels', () => {
  assert.deepEqual(timedRowDistances([null, 100, null, 200, 300], 1), [null, 0, null, 1, 2]);
  assert.deepEqual(timedRowDistances([null, 100, null, 200, 300], 4), [null, 2, null, 1, 0]);
});

test('time-axis window has no focus when the active row is blank or missing', () => {
  assert.deepEqual(timedRowDistances([100, null, 200], 1), [null, null, null]);
  assert.deepEqual(timedRowDistances([100, null, 200], -1), [null, null, null]);
  assert.deepEqual(timedRowDistances([], 0), []);
});
