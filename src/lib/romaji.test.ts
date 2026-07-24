import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveFuriganaReading, romanizeJapanese } from './romaji.ts';

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

test('resolveFuriganaReading keeps romanized ruby off by default', () => {
  assert.equal(resolveFuriganaReading('写真', 'しゃしん', false), 'しゃしん');
  assert.equal(resolveFuriganaReading('きょう', '', false), '');
});

test('resolveFuriganaReading romanizes kanji readings plus hiragana and katakana text', () => {
  assert.equal(resolveFuriganaReading('写真', 'しゃしん', true), 'shashin');
  assert.equal(resolveFuriganaReading('きょう', '', true), 'kyou');
  assert.equal(resolveFuriganaReading('スーパー', '', true), 'suupaa');
});
