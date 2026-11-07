import assert from 'node:assert/strict';
import test from 'node:test';
import { getJapaneseReadingContext } from './japanese-reading-context.ts';
import { getJapaneseReadingCandidates } from './japanese-reading-candidates.ts';

test('candidate context follows saved tokenizer boundaries, not the whole lyric line', () => {
  const segments = [
    { text: '君', reading: 'きみ' }, { text: 'と', reading: '' },
    { text: '食', reading: 'た' }, { text: 'べる', reading: '', joinPrev: true },
    { text: 'お', reading: '' }, { text: '茶', reading: 'ちゃ', joinPrev: true },
  ];
  assert.deepEqual(getJapaneseReadingContext(segments, 2), { word: '食べる', start: 0 });
  assert.deepEqual(getJapaneseReadingContext(segments, 5), { word: 'お茶', start: 1 });
  assert.deepEqual(getJapaneseReadingContext(segments, 0), { word: '君', start: 0 });
});

test('single kanji has local on/kun candidates with okurigana excluded', () => {
  assert.ok(getJapaneseReadingCandidates('食').includes('た'));
  assert.ok(getJapaneseReadingCandidates('思').includes('おも'));
  const life = getJapaneseReadingCandidates('生');
  assert.ok(life.includes('せい'));
  assert.ok(life.includes('しょう'));
  assert.ok(life.includes('い'));
  assert.ok(!life.includes('いきる'));
  for (const text of ['煌', '響', '見', '想']) assert.ok(getJapaneseReadingCandidates(text).length > 1, text);
});

test('whole-word readings remain whole; compounds are never character concatenations', () => {
  assert.ok(getJapaneseReadingCandidates('明日').includes('あした'));
  assert.ok(getJapaneseReadingCandidates('明日').includes('あす'));
  assert.ok(getJapaneseReadingCandidates('一人').includes('ひとり'));
  assert.deepEqual(getJapaneseReadingCandidates('煌響煌響'), []);
});

test('word readings map only onto the selected kanji part', () => {
  const eating = getJapaneseReadingCandidates('食', { word: '食べる', start: 0 });
  assert.equal(eating[0], 'た');
  assert.ok(!eating.includes('たべる'));
  assert.ok(getJapaneseReadingCandidates('茶', { word: 'お茶', start: 1 }).includes('ちゃ'));
  assert.equal(getJapaneseReadingCandidates('扱', { word: '取り扱い', start: 2 })[0], 'あつか');
});

test('dictionary-checked inflections align kana before suggesting a kanji reading', () => {
  assert.equal(getJapaneseReadingCandidates('食', { word: '食べた', start: 0 })[0], 'た');
  assert.equal(getJapaneseReadingCandidates('思', { word: '思い', start: 0 })[0], 'おも');
  assert.equal(getJapaneseReadingCandidates('行', { word: '行った', start: 0 })[0], 'い');
  assert.equal(getJapaneseReadingCandidates('書', { word: '書きました', start: 0 })[0], 'か');
});

test('irregular verbs never use mechanical ru-conjugation readings', () => {
  for (const [word, expected] of [['来て', 'き'], ['来た', 'き'], ['来ます', 'き'], ['来ない', 'こ'], ['来なかった', 'こ'], ['為て', 'し']]) {
    const candidates = getJapaneseReadingCandidates(word[0], { word, start: 0 });
    assert.equal(candidates[0], expected, word);
    assert.ok(!candidates.includes(word.startsWith('来') ? 'く' : 'す'), word);
  }
});

test('contextual candidates never duplicate an existing okurigana suffix', () => {
  for (const [text, word, forbidden] of [['御祝', '御祝い', 'おいわい'], ['大', '大きい', 'おおき'], ['生', '生まれる', 'うま'], ['生', '生まれる', 'うまれ']]) {
    assert.ok(!getJapaneseReadingCandidates(text, { word, start: 0 }).includes(forbidden), word + ': ' + forbidden);
  }
  assert.equal(getJapaneseReadingCandidates('生', { word: '生まれる', start: 0 })[0], 'う');
  assert.equal(getJapaneseReadingCandidates('大', { word: '大きい', start: 0 })[0], 'おお');
});

test('replaced annotation arrays safely invalidate old editor selections', () => {
  assert.deepEqual(getJapaneseReadingContext([{ text: '世界', reading: 'せかい' }], 1), { word: '', start: 0 });
  assert.deepEqual(getJapaneseReadingContext([], 0), { word: '', start: 0 });
});

test('invalid/mismatched context and non-kanji requests never produce guesses', () => {
  assert.deepEqual(getJapaneseReadingCandidates('食', { word: 'お茶', start: 0 }), []);
  assert.deepEqual(getJapaneseReadingCandidates('茶', { word: 'お茶', start: -1 }), []);
  assert.deepEqual(getJapaneseReadingCandidates('茶', { word: 'お茶', start: 0.5 }), []);
  assert.deepEqual(getJapaneseReadingCandidates('かな'), []);
  assert.deepEqual(getJapaneseReadingCandidates('食'.repeat(33)), []);
});
