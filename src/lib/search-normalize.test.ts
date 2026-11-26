import assert from 'node:assert/strict';
import test from 'node:test';
import {
  matchesSearchTerms,
  normalizeSearchText,
  searchTerms,
  songSearchText,
  buildLyricSearchText,
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

test('ISSUE #475: romaji readings and translations are searchable through the derived lyric text', () => {
  const song = {
    title: '落花',
    artist: 'Unknown',
    search_text: buildLyricSearchText({
      lyrics_furigana: JSON.stringify([
        { segments: [{ text: '落花', reading: 'らくか' }] },
        { segments: [{ text: '流', reading: 'りゅう' }] },
      ]),
      lyrics_translation: JSON.stringify(['落下する花', 'Falling blossoms']),
    }),
  };
  // A reader who types romaji finds a song whose title is only Japanese.
  assert.ok(matchesSearchTerms(songSearchText(song), searchTerms('rakuka')));
  assert.ok(matchesSearchTerms(songSearchText(song), searchTerms('ryu')));
  // Chinese/English translation words land in the same haystack.
  assert.ok(matchesSearchTerms(songSearchText(song), searchTerms('落下')));
  assert.ok(matchesSearchTerms(songSearchText(song), searchTerms('falling')));
  // The canonical example in the issue: romaji query for a kana/kanji lyric.
  const kanaSong = {
    title: 'サヨナラ',
    search_text: buildLyricSearchText({
      lyrics_furigana: JSON.stringify([{ segments: [{ text: 'サヨナラ', reading: 'サヨナラ' }] }]),
    }),
  };
  assert.ok(matchesSearchTerms(songSearchText(kanaSong), searchTerms('sayonara')));
});

test('ISSUE #475: malformed lyric caches never shift lines or leak JSON fragments', () => {
  assert.equal(buildLyricSearchText({ lyrics_furigana: '{broken', lyrics_translation: '["truncated' }), '');
  assert.equal(buildLyricSearchText({ lyrics_furigana: '[]', lyrics_translation: JSON.stringify([null, 'Second', 42]) }), 'second');
  assert.equal(buildLyricSearchText({}), '');
  // No derived text: the original title/artist/album haystack is unchanged.
  const base = { title: 'seaglass', artist: 'Aimer', spotify_album: 'Dive iN' };
  assert.equal(songSearchText(base), 'seaglass aimer dive in');
});
