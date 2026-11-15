import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LYRICS_ENTITY_NOTICE_KIND,
  decodeLyricsHtmlEntities,
  decodeLyricsLine,
  findLyricsHtmlEntity,
  hasLyricsHtmlEntity,
  lyricsEntityNoticeKey,
  parseDeclinedFixes,
  repairLyricsHtmlEntities,
  serializeDeclinedFixes,
} from './lyrics-entity.ts';

/**
 * Issue #428: PetitLyrics shipped HTML-encoded lyrics, and rows written before
 * the extractor decoded them hold `&#039;` / `&quot;` verbatim — the detail page
 * renders the entity, the reading cache was tokenized on it, and copy / export
 * carry it forward. These tests pin the pure repair: what counts as an entity,
 * what decoding must preserve (line count!), and how the reading cache is
 * re-shaped instead of being left misaligned.
 */

const SONG = {
  raw: "痛くてfallin&#039; down\n未確定talkin&#039; box",
  synced: "[00:30.33]痛くてfallin&#039; down\n[00:35.10]未確定talkin&#039; box",
};

test('only real entities are detected — a literal & is not a broken payload', () => {
  assert.equal(findLyricsHtmlEntity('fallin&#039; down'), '&#039;');
  assert.equal(findLyricsHtmlEntity('&quot;SNAP!&quot;の合図'), '&quot;');
  assert.equal(findLyricsHtmlEntity('&#x266A; 歌'), '&#x266A;');
  assert.equal(findLyricsHtmlEntity('Tom & Jerry'), null);
  assert.equal(findLyricsHtmlEntity('R&B / AT&T'), null);
  assert.equal(findLyricsHtmlEntity(''), null);
  assert.equal(findLyricsHtmlEntity(null), null);
  assert.equal(hasLyricsHtmlEntity('clean line', 'Why don&#039;t we cuddle'), true);
  assert.equal(hasLyricsHtmlEntity('clean', ''), false);
});

test('decoding is line-preserving and a decoded line break never splits a row', () => {
  assert.equal(decodeLyricsLine('fallin&#039; down'), "fallin' down");
  // Doubly-encoded payloads decode all the way down.
  assert.equal(decodeLyricsLine('&amp;#039;'), "'");
  // A decoded newline becomes a space: the row model is one line per `\n`, so
  // letting it through would shift every index below it.
  assert.equal(decodeLyricsLine('one&#10;two'), 'one two');
  const decoded = decodeLyricsHtmlEntities(SONG.raw);
  assert.equal(decoded, "痛くてfallin' down\n未確定talkin' box");
  assert.equal(decoded.split('\n').length, SONG.raw.split('\n').length);
});

test('the repair decodes both text columns and leaves a clean row untouched', () => {
  const result = repairLyricsHtmlEntities({
    raw: SONG.raw,
    synced: SONG.synced,
    furigana: '[]',
  });
  assert.equal(result.changed, true);
  assert.equal(result.raw, "痛くてfallin' down\n未確定talkin' box");
  assert.equal(result.synced, "[00:30.33]痛くてfallin' down\n[00:35.10]未確定talkin' box");
  assert.equal(result.furiganaAction, 'unchanged');
  assert.equal(result.furigana, '[]');

  const clean = repairLyricsHtmlEntities({ raw: "fallin' down", synced: '', furigana: '[]' });
  assert.equal(clean.changed, false);
});

test('a reading cache split on the entity characters is dropped, not left misaligned', () => {
  // Exactly what the database held: the tokenizer cut "&#039;" into "&#"/"039"/";".
  const furigana = JSON.stringify([
    { segments: [
      { text: '痛く', reading: 'いた' },
      { text: 'て', reading: '' },
      { text: 'fallin', reading: '' },
      { text: '&#', reading: '' },
      { text: '039', reading: '' },
      { text: ';', reading: '' },
      { text: ' down', reading: '' },
    ] },
    { segments: [{ text: '未確定talkin&#039; box', reading: '' }] },
  ]);
  const result = repairLyricsHtmlEntities({ raw: SONG.raw, synced: '', furigana });
  assert.equal(result.furiganaAction, 'cleared');
  assert.equal(result.furigana, '[]');
});

test('a cache whose segments were carried through verbatim is decoded and kept', () => {
  // One segment holds the whole encoded row (the shape a plain-text write
  // produces); decoding its text makes it reconstruct the repaired line again,
  // so the owner's annotation does not have to be regenerated.
  const furigana = JSON.stringify([
    { segments: [{ text: "痛くてfallin&#039; down", reading: '' }] },
    { segments: [{ text: '未確定talkin&#039; box', reading: '' }] },
  ]);
  const result = repairLyricsHtmlEntities({ raw: SONG.raw, synced: '', furigana });
  assert.equal(result.furiganaAction, 'decoded');
  assert.deepEqual(JSON.parse(result.furigana), [
    { segments: [{ text: "痛くてfallin' down", reading: '' }] },
    { segments: [{ text: '未確定talkin\' box', reading: '' }] },
  ]);
});

test('already-clean lyrics and caches are never rewritten, and repairing twice is a no-op', () => {
  const once = repairLyricsHtmlEntities({ raw: SONG.raw, synced: SONG.synced, furigana: '[]' });
  const twice = repairLyricsHtmlEntities({ raw: once.raw, synced: once.synced, furigana: once.furigana });
  assert.equal(twice.changed, false);
});

test('a declined repair is remembered per song, per lyrics text and per kind', () => {
  const key = lyricsEntityNoticeKey('song-1', 'a\nb');
  assert.match(key, /^jplrc:song:song-1:declined-fix:[0-9a-f]+$/);
  // Stable across calls (the key names a stored value, it cannot drift).
  assert.equal(lyricsEntityNoticeKey('song-1', 'a\nb'), key);
  // Different lyrics are a different question.
  assert.notEqual(lyricsEntityNoticeKey('song-1', 'a\nc'), key);
  assert.deepEqual(parseDeclinedFixes(null), []);
  assert.deepEqual(parseDeclinedFixes(''), []);
  assert.deepEqual(parseDeclinedFixes(' , '), []);
  assert.equal(serializeDeclinedFixes([LYRICS_ENTITY_NOTICE_KIND, LYRICS_ENTITY_NOTICE_KIND]), 'html-entities');
  assert.deepEqual(parseDeclinedFixes('html-entities'), [LYRICS_ENTITY_NOTICE_KIND]);
});
