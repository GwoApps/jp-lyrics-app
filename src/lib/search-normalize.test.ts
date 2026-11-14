import assert from 'node:assert/strict';
import test from 'node:test';
import {
  matchesSearchTerms,
  normalizeSearchText,
  searchTerms,
  songSearchText,
} from './search-normalize.ts';

test('katakana queries fold onto the hiragana spelling of the same reading', () => {
  // ISSUE #426: 「サヨナラ」 in katakana used to return 0 of 25 songs.
  assert.equal(normalizeSearchText('サヨナラ'), normalizeSearchText('さよなら'));
  assert.equal(normalizeSearchText('さよならのキス'), 'さよならのきす');
  // Halfwidth katakana is NFKC's job, and it must land on the same value.
  assert.equal(normalizeSearchText('ｻﾖﾅﾗ'), 'さよなら');
  // The long vowel mark is a length marker, not a letter — both scripts keep it.
  assert.equal(normalizeSearchText('コーヒー'), 'こーひー');
});

test('full-width latin from a Japanese IME matches the ascii spelling', () => {
  assert.equal(normalizeSearchText('ｓｅａｇｌａｓｓ'), 'seaglass');
  assert.equal(normalizeSearchText('SEAGLASS'), 'seaglass');
  assert.equal(normalizeSearchText('Dive iN'), 'dive in');
});

test('whitespace collapses but survives, so multi-word queries can AND', () => {
  assert.deepEqual(searchTerms('  さよなら   frequency '), ['さよなら', 'frequency']);
  assert.deepEqual(searchTerms('　'), []);
  assert.deepEqual(searchTerms(''), []);
});

test('title, artist and album all feed the same haystack', () => {
  const song = { title: 'さよならのキス', artist: 'あいみょん', spotify_album: 'Dive iN' };
  assert.equal(songSearchText(song), 'さよならのきす あいみょん dive in');
  // Missing album / artist never leaks an `undefined` or `null` into the haystack.
  assert.equal(songSearchText({ title: 'seaglass', artist: null }), 'seaglass');
  assert.equal(songSearchText({ title: 'seaglass', spotify_album: undefined }), 'seaglass');
});

test('every term must appear, and the album is searchable from the song list too', () => {
  const song = { title: 'seaglass', artist: 'Aimer', spotify_album: 'Dive iN' };
  const haystack = songSearchText(song);
  assert.ok(matchesSearchTerms(haystack, searchTerms('ｄｉｖｅ')));
  assert.ok(matchesSearchTerms(haystack, searchTerms('SEAGLASS dive')));
  assert.equal(matchesSearchTerms(haystack, searchTerms('seaglass missing')), false);
  // No terms means "not filtering", which the callers check for explicitly.
  assert.ok(matchesSearchTerms(haystack, []));
});
