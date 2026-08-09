import assert from 'node:assert/strict';
import test from 'node:test';
import { createTimelineDraft, findLrcConflicts, findTimelineConflicts, hasSameLrcText, mapTimelineTimestamps, offsetLrcLines, parseLrc, resolveLrcTextUpdate, serializeLrc, serializeTimelineDraft, updateLrcLineTime } from './lrc.ts';

test('offsetLrcLines shifts timestamps and clamps at zero', () => {
  const lines = parseLrc('[00:00.250]first\n[01:02.345]second');
  assert.deepEqual(offsetLrcLines(lines, -500), [
    { timeMs: 0, text: 'first' },
    { timeMs: 61845, text: 'second' },
  ]);
});

test('updateLrcLineTime keeps lines sorted by timestamp', () => {
  const lines = parseLrc('[00:01.000]one\n[00:02.000]two');
  assert.deepEqual(updateLrcLineTime(lines, 1, 500), [
    { timeMs: 500, text: 'two' },
    { timeMs: 1000, text: 'one' },
  ]);
});

test('serializeLrc emits stable millisecond timestamps', () => {
  assert.equal(
    serializeLrc([{ timeMs: 62345, text: 'hello' }]),
    '[01:02.345]hello',
  );
});

test('parseLrcTimestamp accepts editor timestamps and rejects invalid values', async () => {
  const { parseLrcTimestamp } = await import('./lrc.ts');
  assert.equal(parseLrcTimestamp('01:02.345'), 62345);
  assert.equal(parseLrcTimestamp('1:02.3'), 62300);
  assert.equal(parseLrcTimestamp('bad'), null);
});

test('hasSameLrcText ignores timestamps but detects lyric edits and line order changes', () => {
  assert.equal(hasSameLrcText('[00:01.000]a\n[00:02.000]b', '[00:03.000]a\n[00:04.000]b'), true);
  assert.equal(hasSameLrcText('[00:01.000]a\n[00:02.000]b', '[00:01.000]a\n[00:02.000]c'), false);
  assert.equal(hasSameLrcText('[00:01.000]a\n[00:02.000]b', '[00:01.000]b\n[00:02.000]a'), false);
});

test('resolveLrcTextUpdate preserves original formatting for timestamp-only edits', () => {
  const existingRaw = 'a\n\nb';
  assert.deepEqual(
    resolveLrcTextUpdate(existingRaw, '[00:01.000]a\n[00:02.000]b', '[00:03.000]a\n[00:04.000]b'),
    { lyricsRaw: existingRaw, contentChanged: false },
  );
  assert.deepEqual(
    resolveLrcTextUpdate(existingRaw, '[00:01.000]a\n[00:02.000]b', '[00:03.000]a\n[00:04.000]c'),
    { lyricsRaw: 'a\nc', contentChanged: true },
  );
});

test('timeline draft keeps unmarked plain lyric lines while preserving marked progress', () => {
  const draft = createTimelineDraft('first\nsecond\nthird', '[00:01.000]first\nsecond\n[00:05.250]third');
  assert.deepEqual(draft, [
    { text: 'first', timeMs: 1000 },
    { text: 'second', timeMs: null },
    { text: 'third', timeMs: 5250 },
  ]);
  assert.equal(serializeTimelineDraft(draft), '[00:01.000]first\nsecond\n[00:05.250]third');
  assert.equal(hasSameLrcText('[00:01.000]first\n[00:02.000]second\n[00:05.250]third', serializeTimelineDraft(draft)), true);
});

test('timeline draft maps existing timestamps back to plain lyrics by text', () => {
  assert.deepEqual(
    createTimelineDraft('intro\nchorus\noutro', '[00:10.000]chorus'),
    [
      { text: 'intro', timeMs: null },
      { text: 'chorus', timeMs: 10000 },
      { text: 'outro', timeMs: null },
    ],
  );
});

test('first partial annotation preserves the original plain lyric formatting', () => {
  assert.deepEqual(
    resolveLrcTextUpdate('first\n\nsecond\nthird', '', '[00:01.000]first\nsecond\nthird'),
    { lyricsRaw: 'first\n\nsecond\nthird', contentChanged: false },
  );
});

test('findTimelineConflicts reports every non-increasing timestamp', () => {
  const draft = [
    { text: 'a', timeMs: 3000 },
    { text: 'b', timeMs: 2500 },
    { text: 'c', timeMs: 2500 },
    { text: 'd', timeMs: null },
    { text: 'e', timeMs: 2400 },
    { text: 'f', timeMs: 9000 },
  ];
  assert.deepEqual(findTimelineConflicts(draft), [
    { index: 1, line: 2, previousIndex: 0, previousLine: 1, timeMs: 2500, previousTimeMs: 3000 },
    { index: 2, line: 3, previousIndex: 1, previousLine: 2, timeMs: 2500, previousTimeMs: 2500 },
    { index: 4, line: 5, previousIndex: 2, previousLine: 3, timeMs: 2400, previousTimeMs: 2500 },
  ]);
});

test('findTimelineConflicts skips untimed rows and accepts a monotonic draft', () => {
  const draft = [
    { text: 'a', timeMs: null },
    { text: 'b', timeMs: 1000 },
    { text: 'c', timeMs: null },
    { text: 'd', timeMs: 2000 },
  ];
  assert.deepEqual(findTimelineConflicts(draft), []);
  assert.deepEqual(findTimelineConflicts([{ text: 'x', timeMs: null }]), []);
  assert.deepEqual(findTimelineConflicts([]), []);
});

test('findTimelineConflicts can ignore equal timestamps (offset/clamp noise)', () => {
  const draft = [
    { text: 'a', timeMs: 0 },
    { text: 'b', timeMs: 0 },
    { text: 'c', timeMs: 1000 },
  ];
  assert.deepEqual(findTimelineConflicts(draft), [
    { index: 1, line: 2, previousIndex: 0, previousLine: 1, timeMs: 0, previousTimeMs: 0 },
  ]);
  assert.deepEqual(findTimelineConflicts(draft, true), []);
});

test('findLrcConflicts validates a serialized LRC string like the highlight engine', () => {
  const lrc = '[00:03.000]a\n[00:02.500]b\n[00:02.500]c\n[00:09.000]d';
  assert.deepEqual(findLrcConflicts(lrc), [
    { index: 1, line: 2, previousIndex: 0, previousLine: 1, timeMs: 2500, previousTimeMs: 3000 },
    { index: 2, line: 3, previousIndex: 1, previousLine: 2, timeMs: 2500, previousTimeMs: 2500 },
  ]);
  assert.deepEqual(findLrcConflicts('[00:01.000]a\n[00:02.000]b'), []);
  // Untimed rows and metadata tags are tolerated and ignored.
  assert.deepEqual(findLrcConflicts('[00:02.000]b\nplain line\n[00:01.000]a'), [
    { index: 2, line: 3, previousIndex: 0, previousLine: 1, timeMs: 1000, previousTimeMs: 2000 },
  ]);
});

test('timeline timestamps stay aligned when rendered lyrics preserve blank separator rows', () => {
  const plain = 'first\r\nsecond\r\n\r\nthird\r\n\r\nfourth';
  const synced = '[00:01.000]first\n[00:02.000]second\n[00:03.000]third\n[00:04.000]fourth';
  const rendered = ['first\r', 'second\r', '', 'third\r', '', 'fourth'];

  assert.deepEqual(mapTimelineTimestamps(rendered, plain, synced), [1000, 2000, null, 3000, null, 4000]);
});
