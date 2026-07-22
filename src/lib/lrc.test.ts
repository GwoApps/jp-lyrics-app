import assert from 'node:assert/strict';
import test from 'node:test';
import { createTimelineDraft, hasSameLrcText, offsetLrcLines, parseLrc, resolveLrcTextUpdate, serializeLrc, serializeTimelineDraft, updateLrcLineTime } from './lrc.ts';

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
