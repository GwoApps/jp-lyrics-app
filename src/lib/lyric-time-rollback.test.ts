import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLLBACK_DURATION_MS, isContinuousPlaybackAdvance, rollbackTimeMs, shouldUpdateFocusedClock } from './lyric-time-rollback.ts';

test('departing line counts backwards through intermediate milliseconds before its lyric timestamp', () => {
  const start = 112_480;
  const lyricTime = 90_270;
  const samples = [0, 60, 120, 180, 240, ROLLBACK_DURATION_MS]
    .map((elapsed) => rollbackTimeMs(start, lyricTime, elapsed));
  assert.equal(samples[0], start);
  assert.equal(samples.at(-1), lyricTime);
  assert.ok(samples.slice(1, -1).every((value) => value > lyricTime && value < start));
  assert.ok(samples.every((value, i) => i === 0 || value < samples[i - 1]));
});

test('rollback clamps late and negative frames; never counts forward when seeking backwards', () => {
  assert.equal(rollbackTimeMs(12_000, 10_000, -100), 12_000);
  assert.equal(rollbackTimeMs(12_000, 10_000, ROLLBACK_DURATION_MS + 100), 10_000);
  assert.equal(rollbackTimeMs(9_000, 10_000, 120), 10_000);
});

test('a focused clock stops at its NEXT timestamp until React moves focus', () => {
  assert.equal(shouldUpdateFocusedClock(112_390, 112_391, 85_590), true);
  assert.equal(shouldUpdateFocusedClock(112_391, 112_391, 85_590), false);
  assert.equal(shouldUpdateFocusedClock(114_000, 112_391, 85_590), false);
  assert.equal(shouldUpdateFocusedClock(114_000, null, 112_391), true);
  assert.equal(shouldUpdateFocusedClock(114_000, 110_000, 112_391), true);
});

test('a seek or stale frame does not masquerade as natural playback advancing one row', () => {
  assert.equal(isContinuousPlaybackAdvance(88_000, 88_016), true);
  assert.equal(isContinuousPlaybackAdvance(88_000, 88_600), true);
  assert.equal(isContinuousPlaybackAdvance(88_000, 89_000), false);
  assert.equal(isContinuousPlaybackAdvance(88_000, 87_000), false);
  assert.equal(isContinuousPlaybackAdvance(null, 88_000), false);
  assert.equal(isContinuousPlaybackAdvance(88_000, null), false);
});
