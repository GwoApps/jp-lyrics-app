import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeCoverage,
  countCompletedArrayItems,
  extractCompletedArrayItems,
} from './translation-progress.ts';

const streamCases: { name: string; input: string; items: string[]; count?: number; countInput?: string }[] = [
  { name: 'counts completed items in a fully-closed array', input: '["你好","世界",""]', items: ['你好', '世界', ''], count: 3 },
  { name: 'counts zero for an empty array', input: '[]', items: [], count: 0 },
  { name: 'counts nothing before the array opens', input: 'no array here', countInput: 'Here is the translation: ', items: [], count: 0 },
  { name: 'counts only complete items in an unterminated stream', input: '["one","two","thr', items: ['one', 'two'], count: 2 },
  { name: 'handles escaped quotes inside strings', input: '["say \\"hi\\"","next","part', items: ['say "hi"', 'next'], count: 2 },
  { name: 'handles trailing incomplete string without closing quote', input: '["a","b', items: ['a'], count: 1 },
  { name: 'counts a completed trailing string before the array closes', input: '["a","b"', items: ['a', 'b'], count: 2 },
  { name: 'handles an element with a comma inside a quoted string', input: '["hello, world","done"]', items: ['hello, world', 'done'], count: 2 },
  { name: 'ignores nested arrays/objects noise and whitespace', input: '[\n  "a",\n  "b"\n', items: ['a', 'b'], count: 2 },
  { name: 'extract ignores non-string primitives for progress purposes', input: '[1, "a", "b"', items: ['a', 'b'] },
];

for (const { name, input, items, count, countInput } of streamCases) {
  test(name, () => {
    if (count !== undefined) assert.equal(countCompletedArrayItems(countInput ?? input), count);
    assert.deepEqual(extractCompletedArrayItems(input), items);
  });
}

// --- issue #278: index-aligned extraction (persistence contract) ------------
// The default extraction COMPRESSES the array (non-string items are skipped),
// which is fine for counting but wrong for writing partial translations back
// to request lines. `indexAligned: true` keeps every slot at its line index,
// exactly like parseTranslationCache does for stored caches.

test('index-aligned extraction keeps null items at their original index', () => {
  const streamed = '["第一行译文", null, "第三行译文", "第四行译文"]';
  assert.deepEqual(extractCompletedArrayItems(streamed, { indexAligned: true }), [
    '第一行译文', '', '第三行译文', '第四行译文',
  ]);
  // The progress-counting default keeps compressing (existing contract).
  assert.deepEqual(extractCompletedArrayItems(streamed), ['第一行译文', '第三行译文', '第四行译文']);
});

test('index-aligned extraction reserves a slot for numbers', () => {
  const streamed = '["a", 0, 42, "d"]';
  assert.deepEqual(extractCompletedArrayItems(streamed, { indexAligned: true }), ['a', '', '', 'd']);
  assert.equal(countCompletedArrayItems('["a", 0, 42, "d"]'), 4);
  // No array opening bracket -> nothing to align to.
  assert.deepEqual(extractCompletedArrayItems('no array here', { indexAligned: true }), []);
});

test('index-aligned extraction reserves a slot for nested arrays and objects', () => {
  const streamed = '["a", ["nested", "array"], {"translation": "b"}, "d"]';
  assert.deepEqual(extractCompletedArrayItems(streamed, { indexAligned: true }), ['a', '', '', 'd']);
  // The comma inside the nested array must not split the element.
  assert.deepEqual(extractCompletedArrayItems(streamed), ['a', 'd']);
});

test('index-aligned extraction holds slots for a still-streaming non-string item', () => {
  const streamed = '["a", {"translation": "b"}, "c';
  // "a" is complete; the object before the comma is complete (slot reserved);
  // "c never closed → not yielded in either mode.
  assert.deepEqual(extractCompletedArrayItems(streamed, { indexAligned: true }), ['a', '']);
  assert.deepEqual(extractCompletedArrayItems(streamed), ['a']);
});

test('index-aligned extraction is the source of truth for the persisted count', () => {
  const streamed = '["a", null, 7, ["x"], "b"]';
  const aligned = extractCompletedArrayItems(streamed, { indexAligned: true });
  // The persisted lines ARE this array — its length is what the route reports
  // as requestDone, so no separate (compressing) count can disagree with it.
  assert.deepEqual(aligned, ['a', '', '', '', 'b']);
  // Default (progress) counting is unchanged: only string items count, and the
  // array it returns is still compressed.
  assert.deepEqual(extractCompletedArrayItems(streamed), ['a', 'b']);
  assert.equal(countCompletedArrayItems('["a", "b", "c"]'), 3);
  // A still-open trailing element is counted by neither mode.
  const streaming = '["a", null, "b';
  assert.deepEqual(extractCompletedArrayItems(streaming, { indexAligned: true }), ['a', '']);
  assert.equal(countCompletedArrayItems(streaming), 2);
});

test('index-aligned extraction matches parseTranslationCache for a damaged cache', async () => {
  const { parseTranslationCache } = await import('./translation/parse.ts');
  const raw = '["第一行", null, 3, ["嵌套"], "第五行"]';
  assert.deepEqual(
    extractCompletedArrayItems(raw, { indexAligned: true }),
    parseTranslationCache(raw, 5),
  );
});

test('computeCoverage counts non-empty source lines with a non-empty translation', () => {
  const lines = ['one', 'two', 'three'];
  const cache = ['一', '', '三'];
  assert.deepEqual(computeCoverage(lines, cache), { covered: 2, coverable: 3 });
});

test('computeCoverage counts duplicate choruses and skips blank lines', () => {
  // 5 lyric rows: 2 blank + 3 non-empty rows where 'la la' repeats at index 3.
  // Each rendered line counts toward coverage (its duplicate is expanded).
  const lines = ['', 'la la', 'na na', 'la la', ''];
  // Index-aligned cache: the duplicate (index 3) is filled too.
  const cache = ['', '啦', '呐', '啦', ''];
  assert.deepEqual(computeCoverage(lines, cache), { covered: 3, coverable: 3 });
});

test('computeCoverage stays monotonic as a partial cache fills in', () => {
  const lines = ['a', 'a', '', 'b', 'c'];
  // coverable counts all non-empty rows (a,a,b,c) → 4; the empty line is skipped.
  const step1 = computeCoverage(lines, ['A', '', '', '', '']);
  assert.deepEqual(step1, { covered: 1, coverable: 4 });
  // After the duplicate of 'a' and 'b' are saved, coverage grows without
  // changing the denominator — no apparent regression.
  const step2 = computeCoverage(lines, ['A', 'A', '', 'B', '']);
  assert.deepEqual(step2, { covered: 3, coverable: 4 });
  assert.ok(step2.covered >= step1.covered);
});

test('computeCoverage treats a damaged cache slot as untranslated', () => {
  const lines = ['a', 'b'];
  const cache = ['A', ''];
  assert.deepEqual(computeCoverage(lines, cache), { covered: 1, coverable: 2 });
});
