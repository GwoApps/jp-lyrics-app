import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSharedSongUrl, parseSharedSourceLine, resolveSharedLyricLine } from './shared-line.ts';

test('parseSharedSourceLine ignores invalid and negative values', () => {
  assert.equal(parseSharedSourceLine('12'), 12);
  assert.equal(parseSharedSourceLine(' 3 '), 3);
  assert.equal(parseSharedSourceLine(null), null);
  assert.equal(parseSharedSourceLine(''), null);
  assert.equal(parseSharedSourceLine('-1'), null);
  assert.equal(parseSharedSourceLine('abc'), null);
  assert.equal(parseSharedSourceLine('1.5'), null);
});

test('buildSharedSongUrl appends a valid line for QR and copy-link', () => {
  assert.equal(buildSharedSongUrl('https://example.com', 's1', '12'), 'https://example.com/songs/s1?line=12');
  assert.equal(buildSharedSongUrl('https://example.com', 's1', null), 'https://example.com/songs/s1');
  assert.equal(buildSharedSongUrl('https://example.com', 's1', 'abc'), 'https://example.com/songs/s1');
});

test('resolveSharedLyricLine keeps blank source separators in place', () => {
  const lyrics = 'First\n\nSecond\n\n\nThird';
  assert.equal(resolveSharedLyricLine('0', lyrics), 0);
  assert.equal(resolveSharedLyricLine('2', lyrics), 2);
  assert.equal(resolveSharedLyricLine('5', lyrics), 5);
});

test('resolveSharedLyricLine ignores blank, out-of-range and invalid lines', () => {
  const lyrics = 'First\n\nSecond';
  assert.equal(resolveSharedLyricLine('1', lyrics), null);
  assert.equal(resolveSharedLyricLine('3', lyrics), null);
  assert.equal(resolveSharedLyricLine('99', lyrics), null);
  assert.equal(resolveSharedLyricLine('abc', lyrics), null);
  assert.equal(resolveSharedLyricLine('2', null), null);
});
