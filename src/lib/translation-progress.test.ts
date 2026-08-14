import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeCoverage,
  countCompletedArrayItems,
  extractCompletedArrayItems,
} from './translation-progress.ts';

test('counts completed items in a fully-closed array', () => {
  assert.equal(countCompletedArrayItems('["你好","世界",""]'), 3);
  assert.deepEqual(extractCompletedArrayItems('["你好","世界",""]'), ['你好', '世界', '']);
});

test('counts zero for an empty array', () => {
  assert.equal(countCompletedArrayItems('[]'), 0);
  assert.deepEqual(extractCompletedArrayItems('[]'), []);
});

test('counts nothing before the array opens', () => {
  assert.equal(countCompletedArrayItems('Here is the translation: '), 0);
  assert.deepEqual(extractCompletedArrayItems('no array here'), []);
});

test('counts only complete items in an unterminated stream', () => {
  const streamed = '["one","two","thr';
  assert.equal(countCompletedArrayItems(streamed), 2);
  assert.deepEqual(extractCompletedArrayItems(streamed), ['one', 'two']);
});

test('handles escaped quotes inside strings', () => {
  const streamed = '["say \\"hi\\"","next","part';
  assert.equal(countCompletedArrayItems(streamed), 2);
  assert.deepEqual(extractCompletedArrayItems(streamed), ['say "hi"', 'next']);
});

test('handles trailing incomplete string without closing quote', () => {
  const streamed = '["a","b';
  // "a" is complete; "b never received its closing quote → not counted.
  assert.equal(countCompletedArrayItems(streamed), 1);
  assert.deepEqual(extractCompletedArrayItems(streamed), ['a']);
});

test('counts a completed trailing string before the array closes', () => {
  const streamed = '["a","b"';
  // Both elements are complete (closing quotes arrived) even though the array is still open.
  assert.equal(countCompletedArrayItems(streamed), 2);
  assert.deepEqual(extractCompletedArrayItems(streamed), ['a', 'b']);
});

test('handles an element with a comma inside a quoted string', () => {
  const streamed = '["hello, world","done"]';
  assert.equal(countCompletedArrayItems(streamed), 2);
  assert.deepEqual(extractCompletedArrayItems(streamed), ['hello, world', 'done']);
});

test('ignores nested arrays/objects noise and whitespace', () => {
  const streamed = '[\n  "a",\n  "b"\n';
  assert.equal(countCompletedArrayItems(streamed), 2);
  assert.deepEqual(extractCompletedArrayItems(streamed), ['a', 'b']);
});

test('extract ignores non-string primitives for progress purposes', () => {
  const streamed = '[1, "a", "b"';
  assert.deepEqual(extractCompletedArrayItems(streamed), ['a', 'b']);
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
