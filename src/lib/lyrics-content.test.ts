import test from 'node:test';
import assert from 'node:assert/strict';
import { hasDerivedLyricsCaches, hasLyricsContentChanged, normalizeLyricsEol, normalizeSyncContent } from './lyrics-content.ts';
import { furiganaLinesMatchSource } from './furigana-validation.ts';

/**
 * Content-change detection for the lyrics write paths (issue #304).
 *
 * The sync write keeps the derived caches (furigana / translation / glossary /
 * reading-scheme confirmation) only when the fetched candidate does not change
 * the stored lyrics. Those caches are indexed by `lyrics_raw` LINE NUMBER, so
 * the baseline must be the exact value written into `lyrics_raw`.
 *
 * The previous baseline went through `getLrcTextLines` (blank rows dropped,
 * timestamps stripped) while the candidate was written verbatim: a candidate
 * that only re-wrapped blank lines compared "equal", the caches were kept, and
 * the stored lyrics gained a row — shifting translation / furigana by one row
 * and making every later furigana save fail with `furigana_source_mismatch`.
 */

test('normalizeLyricsEol folds CRLF and CR to LF', () => {
  assert.equal(normalizeLyricsEol('a\r\nb\rc\nd'), 'a\nb\nc\nd');
  assert.equal(normalizeLyricsEol('a\nb'), 'a\nb');
});

test('hasLyricsContentChanged is false for the exact stored text (re-sync / LRC refresh)', () => {
  const stored = 'A\nB\nC';
  assert.equal(hasLyricsContentChanged(stored, 'A\nB\nC'), false);
  // An empty stored document re-synced to empty stays "unchanged" (nothing to
  // invalidate).
  assert.equal(hasLyricsContentChanged('', ''), false);
});

test('hasLyricsContentChanged ignores a CRLF candidate for LF-stored lyrics', () => {
  const stored = '夜に駆ける\n沈むように溶けてゆく';
  // The candidate is written as LF, i.e. byte-identical to what is stored: a
  // provider answering CRLF is a transport quirk, not a content change, so the
  // caches must be kept.
  assert.equal(hasLyricsContentChanged(stored, '夜に駆ける\r\n沈むように溶けてゆく'), false);
  assert.equal(hasLyricsContentChanged(stored, '夜に駆ける\r沈むように溶けてゆく'), false);
});

test('hasLyricsContentChanged reports CRLF-stored lyrics as changed (they get re-shaped)', () => {
  // Legacy rows may still carry CRLF while readers split on `\n` only, so the
  // stored rows end with `\r`. Writing the folded candidate really does change
  // the bytes, so the caches (derived from the CRLF rows) can no longer describe
  // the stored text — reset them once instead of leaving them misaligned.
  assert.equal(hasLyricsContentChanged('A\r\nB', 'A\r\nB'), true);
  assert.equal(hasLyricsContentChanged('A\r\nB', 'A\nB'), true);
});

test('a CRLF / CR candidate stays row-aligned with the stored lyrics after folding', () => {
  // Regression for the review point on #361: normalizing the COMPARISON side
  // only was not enough. The write path folds the candidate too, so the rows it
  // persists are the rows the caches were kept against.
  const stored = '夜に駆ける\n沈むように溶けてゆく';
  const furigana = [
    { segments: [{ text: '夜に駆ける', reading: 'よるにかける' }] },
    { segments: [{ text: '沈むように溶けてゆく', reading: 'しずむようにとけてゆく' }] },
  ];
  for (const candidate of ['夜に駆ける\r\n沈むように溶けてゆく', '夜に駆ける\r沈むように溶けてゆく']) {
    const written = normalizeLyricsEol(candidate);
    assert.deepEqual(written.split('\n'), stored.split('\n'));
    assert.equal(furiganaLinesMatchSource(furigana, written), true);
  }
});

test('hasLyricsContentChanged resets caches when a blank separator row is added (issue #304)', () => {
  // The reported repro: 3-row stored lyrics + aligned furigana/translation vs a
  // 4-row candidate that only inserts a blank separator. The old
  // `getLrcTextLines` comparison said "unchanged" and kept the caches, leaving
  // them off by one row against the newly written `lyrics_raw`.
  assert.equal(hasLyricsContentChanged('A\nB\nC', 'A\n\nB\nC'), true);
  assert.equal(hasLyricsContentChanged('A\nB\nC', 'A\nB\nC\n'), true);
});

test('hasLyricsContentChanged resets caches for full-width space separators', () => {
  // `trim()` treats the ideographic space U+3000 as blank, so "blank row" and
  // "full-width space row" used to compare equal while being different stored
  // values.
  assert.equal(hasLyricsContentChanged('A\u3000\nB', 'A\n\nB'), true);
  assert.equal(hasLyricsContentChanged('A\nB', 'A\u3000\nB'), true);
});

test('hasLyricsContentChanged resets caches when the lyric lines themselves change', () => {
  // Different line order / wording / line count — the caches no longer describe
  // the stored text and must be wiped.
  assert.equal(hasLyricsContentChanged('A\nB\nC', 'A\nC\nB'), true);
  assert.equal(hasLyricsContentChanged('A\nB\nC', 'A\nB\nD'), true);
  assert.equal(hasLyricsContentChanged('A\nB\nC', 'A\nB'), true);
  assert.equal(hasLyricsContentChanged('A\nB', ''), true);
  assert.equal(hasLyricsContentChanged('', 'A\nB'), true);
});

test('hasDerivedLyricsCaches reports only real cache content', () => {
  // Empty column values ('', '[]', null) mean "nothing to lose" — the client
  // must not claim a reset that destroyed nothing.
  assert.equal(hasDerivedLyricsCaches({ furigana: '[]', translation: '[]', glossary: null }), false);
  assert.equal(hasDerivedLyricsCaches({}), false);
  assert.equal(hasDerivedLyricsCaches({ furigana: '' }), false);
  assert.equal(hasDerivedLyricsCaches({ furigana: '[{"segments":[]}]' }), true);
  assert.equal(hasDerivedLyricsCaches({ translation: '["訳"]' }), true);
  assert.equal(hasDerivedLyricsCaches({ glossary: '{"夜":"night"}' }), true);
});

test('normalizeSyncContent folds both sides that get persisted', () => {
  assert.deepEqual(
    normalizeSyncContent({ plain: 'a\r\nb\rc', synced: '[00:01.00]a\r\n[00:02.00]b' }),
    { plain: 'a\nb\nc', synced: '[00:01.00]a\n[00:02.00]b' },
  );
});

test('normalizeCandidateLyrics folds provider CRLF payloads before they are compared or stored', async () => {
  // The same fold runs where provider payloads enter the app, so the value the
  // sync preview shows and the token carries is already LF.
  const { normalizeCandidateLyrics } = await import('./lyrics-provider/normalize.ts');
  const out = normalizeCandidateLyrics({
    plainLyrics: '夜に駆ける\r\n沈むように',
    syncedLyrics: '[00:01.00]夜に駆ける\r\n[00:02.00]沈むように',
  });
  assert.equal(out.plain, '夜に駆ける\n沈むように');
  assert.equal(out.synced, '[00:01.00]夜に駆ける\n[00:02.00]沈むように');
  // And the written value is byte-identical to the stored one on a re-sync.
  assert.equal(hasLyricsContentChanged('夜に駆ける\n沈むように', out.plain), false);
});
