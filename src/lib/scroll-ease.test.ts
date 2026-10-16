import assert from 'node:assert/strict';
import { test } from 'node:test';
import { animateSmoothScroll, cancelSmoothScroll, earliestTimedLyricMs, shouldScrollLyricsToStart } from './scroll-ease.ts';

test('first timed lyric is the earliest timestamp, not necessarily the first row', () => {
  assert.equal(earliestTimedLyricMs([null, 90_000, null, 45_000]), 45_000);
  assert.equal(earliestTimedLyricMs([null, null]), null);
  assert.equal(shouldScrollLyricsToStart(95_000, 60_000, earliestTimedLyricMs([90_000, 45_000])), false);
});

test('only a meaningful backward jump ending before the first timed lyric resets the scroller', () => {
  const first = 45_160;
  assert.equal(shouldScrollLyricsToStart(95_000, 40_000, first), true);
  assert.equal(shouldScrollLyricsToStart(43_000, 20_000, first), true);
  assert.equal(shouldScrollLyricsToStart(95_000, 60_000, first), false);
  assert.equal(shouldScrollLyricsToStart(40_000, 42_000, first), false);
  assert.equal(shouldScrollLyricsToStart(40_000, 39_800, first), false);
  assert.equal(shouldScrollLyricsToStart(null, 40_000, first), false);
  assert.equal(shouldScrollLyricsToStart(95_000, 40_000, null), false);
});

test('a rewind cancels an in-flight follow even when scrollTop is already zero', () => {
  const scheduled = new Map<number, FrameRequestCallback>();
  let nextId = 0;
  const priorRequest = globalThis.requestAnimationFrame;
  const priorCancel = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = (callback) => { scheduled.set(++nextId, callback); return nextId; };
  globalThis.cancelAnimationFrame = (id) => { scheduled.delete(id); };
  try {
    const container = { scrollTop: 0 } as HTMLElement;
    animateSmoothScroll(container, 500);
    assert.equal(scheduled.size, 1);
    animateSmoothScroll(container, 0);
    assert.equal(scheduled.size, 0, 'the stale follow has been cancelled');
    assert.equal(container.scrollTop, 0);
  } finally {
    globalThis.requestAnimationFrame = priorRequest;
    globalThis.cancelAnimationFrame = priorCancel;
  }
});

test('manual browsing cancels an in-flight lyric follow before its next frame', () => {
  const frames = new Map<number, FrameRequestCallback>();
  const priorRequest = globalThis.requestAnimationFrame;
  const priorCancel = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = (callback) => { frames.set(1, callback); return 1; };
  globalThis.cancelAnimationFrame = (id) => { frames.delete(id); };
  try {
    const container = { scrollTop: 90 } as HTMLElement;
    animateSmoothScroll(container, 400);
    assert.equal(frames.size, 1);
    cancelSmoothScroll(container);
    assert.equal(frames.size, 0);
    assert.equal(container.scrollTop, 90);
  } finally {
    globalThis.requestAnimationFrame = priorRequest;
    globalThis.cancelAnimationFrame = priorCancel;
  }
});

test('reduced motion completes a lyric follow without scheduling animation', () => {
  const priorWindow = globalThis.window;
  const priorRequest = globalThis.requestAnimationFrame;
  let requested = false;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { matchMedia: () => ({ matches: true }) },
  });
  globalThis.requestAnimationFrame = () => { requested = true; return 1; };
  try {
    const container = { scrollTop: 0 } as HTMLElement;
    animateSmoothScroll(container, 400);
    assert.equal(container.scrollTop, 400);
    assert.equal(requested, false);
  } finally {
    if (priorWindow === undefined) Reflect.deleteProperty(globalThis, 'window');
    else Object.defineProperty(globalThis, 'window', { configurable: true, value: priorWindow });
    globalThis.requestAnimationFrame = priorRequest;
  }
});
