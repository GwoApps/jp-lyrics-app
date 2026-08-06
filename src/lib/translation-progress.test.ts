import assert from 'node:assert/strict';
import test from 'node:test';
import {
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
