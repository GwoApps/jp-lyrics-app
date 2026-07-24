import assert from 'node:assert/strict';
import test from 'node:test';
import { kanaToHangul, resolveFuriganaReadings, romanizeJapanese } from './romaji.ts';

test('romanizeJapanese converts basic hiragana and digraphs', () => {
  assert.equal(romanizeJapanese('きょう'), 'kyou');
  assert.equal(romanizeJapanese('しゃしん'), 'shashin');
});

test('romanizeJapanese handles sokuon, katakana and long vowel marks', () => {
  assert.equal(romanizeJapanese('がっこう'), 'gakkou');
  assert.equal(romanizeJapanese('スーパー'), 'suupaa');
  assert.equal(romanizeJapanese('ｶﾀｶﾅ'), 'katakana');
});

test('romanizeJapanese preserves punctuation and separates n before vowels', () => {
  assert.equal(romanizeJapanese('しんよう！'), "shin'you！");
});

test('romanizeJapanese handles extended modern combinations and Hepburn chi gemination', () => {
  assert.equal(romanizeJapanese('つぁ くぁ ぐぁ すぃ ずぃ てゅ でゅ いぇ'), 'tsa kwa gwa si zi tyu dyu ye');
  assert.equal(romanizeJapanese('まっちゃ'), 'matcha');
});

test('kanaToHangul converts hiragana, katakana, combinations, sokuon and long vowels', () => {
  assert.equal(kanaToHangul('しゃしん'), '샤신');
  assert.equal(kanaToHangul('がっこう'), '갓코우');
  assert.equal(kanaToHangul('スーパー'), '스우파아');
  assert.equal(kanaToHangul('ｶﾀｶﾅ'), '카타카나');
});

test('resolveFuriganaReadings keeps Japanese ruby only by default', () => {
  assert.deepEqual(resolveFuriganaReadings('写真', 'しゃしん', false, false), [
    { value: 'しゃしん', lang: 'ja' },
  ]);
  assert.deepEqual(resolveFuriganaReadings('きょう', '', false, false), []);
});

test('resolveFuriganaReadings stacks Japanese, Roman and Hangul rows together', () => {
  assert.deepEqual(resolveFuriganaReadings('写真', 'しゃしん', true, true), [
    { value: 'しゃしん', lang: 'ja' },
    { value: 'shashin', lang: 'en' },
    { value: '샤신', lang: 'ko' },
  ]);
  assert.deepEqual(resolveFuriganaReadings('スーパー', '', true, true), [
    { value: 'suupaa', lang: 'en' },
    { value: '스우파아', lang: 'ko' },
  ]);
});
