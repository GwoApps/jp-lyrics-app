import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  clampLineIndex, isLineCopyShortcut, isLineNavigationShortcut,
  NATIVE_SCROLL_KEYS, readingViewOwnsKey,
} from './lyrics-keyboard-nav.ts';

const page = readFileSync(new URL('../app/songs/[id]/page.tsx', import.meta.url), 'utf8');

test('j/k navigation covers both cases', () => {
  assert.equal(isLineNavigationShortcut('j'), true);
  assert.equal(isLineNavigationShortcut('J'), true);
  assert.equal(isLineNavigationShortcut('k'), true);
  assert.equal(isLineNavigationShortcut('K'), true);
  assert.equal(isLineNavigationShortcut('ArrowDown'), false);
});

test('Enter copies but Space keeps its native scroll', () => {
  assert.equal(isLineCopyShortcut('Enter'), true);
  assert.equal(isLineCopyShortcut(' '), false);
  assert.ok(NATIVE_SCROLL_KEYS.has(' '));
});

test('index clamps to the lyric rows', () => {
  assert.equal(clampLineIndex(5, 0), -1);
  assert.equal(clampLineIndex(-3, 4), 0);
  assert.equal(clampLineIndex(9, 4), 3);
});

test('the page guards composition and advertises the shortcuts', () => {
  assert.equal(readingViewOwnsKey(null), false);
  assert.ok(page.includes('readingViewOwnsKey(event.target)'));
  assert.ok(page.includes('event.nativeEvent.isComposing'));
  assert.ok(page.includes('aria-keyshortcuts="j k Enter"'));
  assert.ok(page.includes('data-keyboard-focused'));
});
