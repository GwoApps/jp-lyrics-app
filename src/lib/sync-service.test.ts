import test from 'node:test';
import assert from 'node:assert/strict';
import { hasSyncContentChanged, normalizeLrcEol } from './sync-service.ts';

/**
 * Content-change detection for the sync write path (issue #304).
 *
 * `persistCandidate` keeps the derived caches (furigana / translation /
 * glossary / reading-scheme confirmation) only when the fetched candidate does
 * not change the stored lyrics. Those caches are indexed by `lyrics_raw` LINE
 * NUMBER, so the "changed?" baseline MUST be the exact value written into
 * `lyrics_raw` — the candidate plain text. The previous baseline went through
 * `getLrcTextLines`, which drops blank rows and strips timestamps: a candidate
 * that only re-wrapped blank lines compared "equal" and kept the caches while
 * the stored lyrics gained a row, shifting translation / furigana by one line
 * and making every later furigana save fail with `furigana_source_mismatch`.
 */

test('normalizeLrcEol folds CRLF and CR to LF', () => {
  assert.equal(normalizeLrcEol('a\r\nb\rc\nd'), 'a\nb\nc\nd');
  assert.equal(normalizeLrcEol('a\nb'), 'a\nb');
});

test('hasSyncContentChanged treats only line-ending differences as unchanged', () => {
  const stored = '夜に駆ける\n沈むように溶けてゆく';
  // Byte-identical document, different line terminator — a provider quirk, not
  // a content change: caches must be kept.
  assert.equal(hasSyncContentChanged(stored, '夜に駆ける\r\n沈むように溶けてゆく'), false);
  assert.equal(hasSyncContentChanged(stored, '夜に駆ける\r沈むように溶けてゆく'), false);
});

test('hasSyncContentChanged is false for the exact stored text (re-sync / LRC refresh)', () => {
  const stored = 'A\nB\nC';
  assert.equal(hasSyncContentChanged(stored, 'A\nB\nC'), false);
  // An empty stored document re-synced to empty stays "unchanged" (nothing to
  // invalidate).
  assert.equal(hasSyncContentChanged('', ''), false);
});

test('hasSyncContentChanged resets caches when a blank separator row is added (issue #304)', () => {
  // The reported repro: 3-row stored lyrics + aligned furigana/translation vs a
  // 4-row candidate that only inserts a blank separator. The old
  // `getLrcTextLines` comparison said "unchanged" and kept the caches, leaving
  // them off by one row against the newly written `lyrics_raw`.
  assert.equal(hasSyncContentChanged('A\nB\nC', 'A\n\nB\nC'), true);
  assert.equal(hasSyncContentChanged('A\nB\nC', 'A\nB\nC\n'), true);
});

test('hasSyncContentChanged resets caches for full-width space separators', () => {
  // `trim()` treats the ideographic space U+3000 as blank, so "blank row" and
  // "full-width space row" used to compare equal while being different stored
  // values.
  assert.equal(hasSyncContentChanged('A\u3000\nB', 'A\n\nB'), true);
  assert.equal(hasSyncContentChanged('A\nB', 'A\u3000\nB'), true);
});

test('hasSyncContentChanged resets caches when the lyric lines themselves change', () => {
  // Different line order / wording / line count — the caches no longer describe
  // the stored text and must be wiped.
  assert.equal(hasSyncContentChanged('A\nB\nC', 'A\nC\nB'), true);
  assert.equal(hasSyncContentChanged('A\nB\nC', 'A\nB\nD'), true);
  assert.equal(hasSyncContentChanged('A\nB\nC', 'A\nB'), true);
  assert.equal(hasSyncContentChanged('A\nB', ''), true);
  assert.equal(hasSyncContentChanged('', 'A\nB'), true);
});
