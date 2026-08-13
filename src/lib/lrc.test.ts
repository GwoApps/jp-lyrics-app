import assert from 'node:assert/strict';
import test from 'node:test';
import { createTimelineDraft, buildTimelineDraft, extractLrcMetadata, findLrcConflicts, findTimelineConflicts, getLrcTextLines, hasSameLrcText, isLrcMetadataLine, mapTimelineTimestamps, offsetLrcLines, parseLrc, resolveLrcTextUpdate, resolveTimelineSave, serializeLrc, serializeTimelineDraft, updateLrcLineTime } from './lrc.ts';

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

test('metadata tags are recognised case-insensitively', () => {
  assert.equal(isLrcMetadataLine('[ar:YOASOBI]'), true);
  assert.equal(isLrcMetadataLine('[ti:アイドル]'), true);
  assert.equal(isLrcMetadataLine('[al:THE BOOK 3]'), true);
  assert.equal(isLrcMetadataLine('[by:editor]'), true);
  assert.equal(isLrcMetadataLine('[offset:120]'), true);
  assert.equal(isLrcMetadataLine('[re:lrc generator]'), true);
  assert.equal(isLrcMetadataLine('[ve:2.0]'), true);
  assert.equal(isLrcMetadataLine('[length:03:24]'), true);
  // Case-insensitive tag names.
  assert.equal(isLrcMetadataLine('[AR:YOASOBI]'), true);
  assert.equal(isLrcMetadataLine('[Ti:アイドル]'), true);
  // Unknown / extension tags and real lyric lines are NOT metadata.
  assert.equal(isLrcMetadataLine('[xx:custom]'), false);
  assert.equal(isLrcMetadataLine('普通歌词行'), false);
  assert.equal(isLrcMetadataLine('[00:12.34]普通歌词'), false);
});

test('extractLrcMetadata parses standard tags and the offset value', () => {
  const metadata = extractLrcMetadata(
    '[ar:YOASOBI]\n[ti:アイドル]\n[al:THE BOOK 3]\n[by:editor]\n[offset:120]\n[00:01.000]line',
  );
  assert.deepEqual(metadata, {
    offsetMs: 120,
    tags: { ar: 'YOASOBI', ti: 'アイドル', al: 'THE BOOK 3', by: 'editor', offset: '120' },
  });
  // Case-insensitive tag names and negative offset values.
  assert.deepEqual(extractLrcMetadata('[Ar:YOASOBI]\n[OFFSET:-50]'), {
    offsetMs: -50,
    tags: { ar: 'YOASOBI', offset: '-50' },
  });
  // Missing metadata → empty result.
  assert.deepEqual(extractLrcMetadata('[00:01.000]a'), { offsetMs: null, tags: {} });
});

test('getLrcTextLines excludes standard metadata tags', () => {
  const lrc = '[ar:YOASOBI]\n[ti:アイドル]\n[al:THE BOOK 3]\n[by:editor]\n[offset:120]\n[00:01.000]first\n[00:02.000]second';
  assert.deepEqual(getLrcTextLines(lrc), ['first', 'second']);
  // Only a metadata change must not count as lyric content.
  assert.equal(
    hasSameLrcText('[ar:A]\n[00:01.000]a', '[ar:B]\n[offset:120]\n[00:01.000]a'),
    true,
  );
});

test('parseLrc ignores metadata-only lines', () => {
  const lines = parseLrc('[ar:YOASOBI]\n[offset:120]\n[00:01.000]first\n[00:02.000]second');
  assert.deepEqual(lines, [
    { timeMs: 1000, text: 'first' },
    { timeMs: 2000, text: 'second' },
  ]);
});

test('multi-timestamp rows expand without leaking timestamps into lyric text', () => {
  const lrc = '[offset:120]\n[00:10.00][00:50.000]chorus line';
  assert.deepEqual(parseLrc(lrc), [
    { timeMs: 10000, text: 'chorus line' },
    { timeMs: 50000, text: 'chorus line' },
  ]);
  assert.deepEqual(getLrcTextLines(lrc), ['chorus line']);
});

test('timeline draft queues every timestamp expanded from repeated lyric rows', () => {
  assert.deepEqual(
    createTimelineDraft('chorus line\nchorus line', '[00:10.00][00:50.000]chorus line'),
    [
      { timeMs: 10000, text: 'chorus line' },
      { timeMs: 50000, text: 'chorus line' },
    ],
  );
});

test('resolveLrcTextUpdate ignores metadata-only changes', () => {
  const existingRaw = 'a\nb';
  assert.deepEqual(
    resolveLrcTextUpdate(existingRaw, '', '[ar:YOASOBI]\n[offset:120]\n[00:01.000]a\n[00:02.000]b'),
    { lyricsRaw: existingRaw, contentChanged: false },
  );
  // Changing only the offset metadata must not clear derived data.
  assert.deepEqual(
    resolveLrcTextUpdate(existingRaw, '[00:01.000]a\n[00:02.000]b', '[offset:-80]\n[00:01.000]a\n[00:02.000]b'),
    { lyricsRaw: existingRaw, contentChanged: false },
  );
});

test('createTimelineDraft drops metadata from both plain and synced input', () => {
  const draft = createTimelineDraft(
    '[ar:YOASOBI]\nfirst\nsecond',
    '[ti:アイドル]\n[00:01.000]first\n[offset:120]\nsecond',
  );
  assert.deepEqual(draft, [
    { text: 'first', timeMs: 1000 },
    { text: 'second', timeMs: null },
  ]);
  assert.equal(serializeTimelineDraft(draft), '[00:01.000]first\nsecond');
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

test('resolveTimelineSave accepts a timeline save matching the current plain lyrics', () => {
  const result = resolveTimelineSave(
    'first\nsecond',
    '[00:01.000]first\n[00:02.000]second',
    '[00:03.000]first\n[00:04.000]second',
    'first\nsecond',
  );
  assert.deepEqual(result, { ok: true, lyricsRaw: 'first\nsecond', contentChanged: false });
});

test('resolveTimelineSave refuses when plain lyrics were rewritten in another tab', () => {
  // Tab A loaded `first\nsecond` and marks a timeline; tab B saved a new
  // lyric text `first\nnew second` in the meantime. A's stale snapshot must
  // never be reverse-written back into lyrics_raw.
  const result = resolveTimelineSave(
    'first\nnew second',
    '[00:05.000]first\n[00:06.000]new second',
    '[00:01.000]first\n[00:02.000]second',
    'first\nsecond',
  );
  assert.deepEqual(result, { ok: false, error: 'stale_timeline_source' });
});

test('resolveTimelineSave refuses submissions that omit the source snapshot', () => {
  const result = resolveTimelineSave('first', '[00:01.000]first', '[00:02.000]first', undefined as unknown as string);
  assert.deepEqual(result, { ok: false, error: 'missing_source_lyrics' });
});

test('buildTimelineDraft fuzzy-matches half-width punctuation differences', () => {
  // plain uses full-width ； while synced uses half-width ; → tiny diff, must still attach.
  const result = buildTimelineDraft(
    '空の青さ；春の風',
    '[00:12.000]空の青さ;春の風',
  );
  assert.equal(result.fuzzyMatched, 1);
  assert.equal(result.unmatched, 0);
  assert.deepEqual(result.lines, [{ text: '空の青さ；春の風', timeMs: 12000 }]);
});

test('buildTimelineDraft fuzzy-matches punctuation and bracket differences', () => {
  // plain drops the full-width parentheses that the synced LRC keeps.
  const result = buildTimelineDraft(
    'さよなら、それだけで十分',
    '[00:20.000]さよなら（それだけで十分）',
  );
  assert.equal(result.fuzzyMatched, 1);
  assert.equal(result.unmatched, 0);
  assert.deepEqual(result.lines, [{ text: 'さよなら、それだけで十分', timeMs: 20000 }]);
});

test('buildTimelineDraft exact matches never fall back to fuzzy for repeated chorus lines', () => {
  // Repeated identical chorus text must consume its own timestamp queue in order,
  // even when a nearby line is fuzzy-similar, so fuzzy fallback never steals it.
  const result = buildTimelineDraft(
    'chorus\nverse one\nchorus\nverse two',
    '[00:10.000]chorus\n[00:30.000]verse one\n[00:50.000]chorus\n[01:10.000]verse two',
  );
  assert.equal(result.fuzzyMatched, 0);
  assert.equal(result.unmatched, 0);
  assert.deepEqual(result.lines, [
    { text: 'chorus', timeMs: 10000 },
    { text: 'verse one', timeMs: 30000 },
    { text: 'chorus', timeMs: 50000 },
    { text: 'verse two', timeMs: 70000 },
  ]);
});

test('buildTimelineDraft reports unmatched synced rows it cannot align', () => {
  const result = buildTimelineDraft(
    'one\ntwo\nthree',
    '[00:01.000]one\n[00:02.000]totally different lyric\n[00:03.000]three',
  );
  // one and three align exactly; 'totally different lyric' has no fuzzy counterpart.
  assert.equal(result.fuzzyMatched, 0);
  assert.equal(result.unmatched, 1);
  assert.deepEqual(result.lines, [
    { text: 'one', timeMs: 1000 },
    { text: 'two', timeMs: null },
    { text: 'three', timeMs: 3000 },
  ]);
});

test('buildTimelineDraft fuzzy fallback is position-aware and keeps local ordering', () => {
  // A far-away repeated text must not steal a timestamp from a closer fuzzy match.
  const result = buildTimelineDraft(
    'verse one\nrefrain\nverse two',
    '[00:10.000]verse one\n[00:20.000]verse two (fuzzy twin)\n[00:40.000]refrain',
  );
  // 'verse two' and 'verse two (fuzzy twin)' normalize; 'verse one' exact at 0;
  // 'refrain' exact at index 2 → 00:40. 'verse two' fuzzy-matches the nearest 00:20.
  assert.equal(result.fuzzyMatched, 1);
  assert.equal(result.unmatched, 0);
  assert.equal(result.lines[1].timeMs, 40000);
  assert.equal(result.lines[2].timeMs, 20000);
});

test('buildTimelineDraft leaves exact full-table equality untouched', () => {
  const result = buildTimelineDraft('a\nb', '[00:01.000]a\n[00:02.000]b');
  assert.equal(result.fuzzyMatched, 0);
  assert.equal(result.unmatched, 0);
  assert.deepEqual(result.lines, [
    { text: 'a', timeMs: 1000 },
    { text: 'b', timeMs: 2000 },
  ]);
});
