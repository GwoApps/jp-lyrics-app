import assert from 'node:assert/strict';
import test from 'node:test';
import { getInflectedJapaneseReadings, type JapaneseLexemes } from './japanese-inflection.ts';

const lexemes: JapaneseLexemes = {
  '届く': { v5k: ['とどく'] }, '溜まる': { v5r: ['たまる'] },
  '黒い': { 'adj-i': ['くろい'] }, '濁る': { v5r: ['にごる'] },
  '攫う': { v5u: ['さらう'] }, '意外': { 'adv-to': ['いがい'] },
  '来る': { vk: ['くる'] }, '為る': { 'vs-i': ['する'] },
  '食べる': { v1: ['たべる'] }, '行く': { 'v5k-s': ['いく', 'ゆく'] },
  '勉強': { vs: ['べんきょう'] }, '過去る': { v5r: ['すぎさる'] },
};

test('inflection handles the unfinished stems actually emitted by the tokenizer', () => {
  for (const [word, reading] of [['届か', 'とどか'], ['溜まっ', 'たまっ'], ['黒く', 'くろく'], ['濁っ', 'にごっ'], ['攫わ', 'さらわ'], ['意外と', 'いがいと']]) {
    assert.ok(getInflectedJapaneseReadings(word, lexemes).includes(reading), word);
  }
});

test('morphology is gated by dictionary part-of-speech rather than any matching suffix', () => {
  assert.deepEqual(getInflectedJapaneseReadings('過去', lexemes), []);
  assert.deepEqual(getInflectedJapaneseReadings('食べった', lexemes), []);
  assert.deepEqual(getInflectedJapaneseReadings('行いた', lexemes), []);
  assert.ok(getInflectedJapaneseReadings('行っ', lexemes).includes('いっ'));
});

test('irregular and suru-noun readings use their proper allomorphs', () => {
  assert.ok(getInflectedJapaneseReadings('来て', lexemes).includes('きて'));
  assert.ok(getInflectedJapaneseReadings('来ない', lexemes).includes('こない'));
  assert.ok(getInflectedJapaneseReadings('為て', lexemes).includes('して'));
  assert.ok(getInflectedJapaneseReadings('勉強し', lexemes).includes('べんきょうし'));
});
