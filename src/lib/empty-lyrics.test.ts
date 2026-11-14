import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyLyricsReason, hasLyricsContent } from './empty-lyrics.ts';
import { createPlainFuriganaLines } from './furigana-plain.ts';

test('hasLyricsContent judges lyrics by text, not by line count', () => {
  // The regression behind issue #420: an empty lyric string is still 1 line.
  assert.equal(createPlainFuriganaLines('').length, 1);
  assert.equal(hasLyricsContent(''), false);
  assert.equal(hasLyricsContent(null), false);
  assert.equal(hasLyricsContent(undefined), false);
  assert.equal(hasLyricsContent('  \n\t\r\n'), false);
  assert.equal(hasLyricsContent('\u3000\u00a0'), false);
  assert.equal(hasLyricsContent('間奏\n'), true);
});

test('emptyLyricsReason distinguishes an unfetched song from a miss', () => {
  // Default row: nobody ever asked a provider.
  assert.equal(emptyLyricsReason({ lyrics_source: 'manual', lyrics_fetched_at: null }), 'never-fetched');
  assert.equal(emptyLyricsReason({ lyrics_source: '', lyrics_fetched_at: null }), 'never-fetched');
  assert.equal(emptyLyricsReason(null), 'never-fetched');
  // Playlist-import leftovers persist `lyrics_source = 'none'` after a failed lookup.
  assert.equal(emptyLyricsReason({ lyrics_source: 'none', lyrics_fetched_at: '2026-08-02T00:00:00.000Z' }), 'not-found');
  // A provider that answered but returned nothing still records `fetched_at`.
  assert.equal(emptyLyricsReason({ lyrics_source: 'manual', lyrics_fetched_at: '2026-08-02T00:00:00.000Z' }), 'not-found');
});
