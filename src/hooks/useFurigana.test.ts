import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldConvertFurigana } from './useFurigana.ts';

const base = {
  lyricsRaw: '春はあけぼの',
  hasServerFurigana: false,
  hasHanCharacters: true,
  hasCantoneseSuggestion: false,
  readingMode: 'original' as const,
  canEdit: false,
};

test('a visitor in original mode never converts on page open', () => {
  assert.equal(shouldConvertFurigana(base), false);
});

test('switching to furigana mode triggers conversion for readers and editors', () => {
  assert.equal(shouldConvertFurigana({ ...base, readingMode: 'furigana' }), true);
  assert.equal(shouldConvertFurigana({ ...base, readingMode: 'furigana', canEdit: true }), true);
});

test('an editor converts on page open even in original mode, so results can persist', () => {
  assert.equal(shouldConvertFurigana({ ...base, canEdit: true }), true);
});

test('inputs with nothing to convert stay quiet in every mode', () => {
  assert.equal(shouldConvertFurigana({ ...base, readingMode: 'furigana', lyricsRaw: '   ' }), false);
  assert.equal(shouldConvertFurigana({ ...base, readingMode: 'furigana', hasHanCharacters: false }), false);
  assert.equal(shouldConvertFurigana({ ...base, readingMode: 'furigana', hasServerFurigana: true }), false);
  assert.equal(shouldConvertFurigana({ ...base, readingMode: 'furigana', hasCantoneseSuggestion: true }), false);
});
