import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isKoreanReadingSegment,
  normalizeFuriganaSegments,
  resolveFuriganaReading,
  romanizeJapanese,
  romanizeKorean,
  romanizeLyricsReading,
  splitLyricScriptRuns,
} from './romaji.ts';

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

test('romanizeKorean converts common Hangul lyrics to Revised Romanization', () => {
  assert.equal(romanizeKorean('안녕하세요'), 'annyeonghaseyo');
  assert.equal(romanizeKorean('사랑해'), 'saranghae');
  assert.equal(romanizeKorean('서울'), 'seoul');
  assert.equal(romanizeKorean('안녕'.normalize('NFD')), 'annyeong');
});

test('romanizeKorean handles liaison and common pronunciation changes', () => {
  assert.equal(romanizeKorean('한국어'), 'hangugeo');
  assert.equal(romanizeKorean('좋아'), 'joa');
  assert.equal(romanizeKorean('같이'), 'gachi');
  assert.equal(romanizeKorean('먹는'), 'meongneun');
  assert.equal(romanizeKorean('신라'), 'silla');
  assert.equal(romanizeKorean('음악'), 'eumak');
  assert.equal(romanizeKorean('있어요'), 'isseoyo');
  assert.equal(romanizeKorean('읽어'), 'ilgeo');
  assert.equal(romanizeKorean('많아'), 'mana');
  assert.equal(romanizeKorean('독립'), 'dongnip');
});

test('romanizeLyricsReading supports Japanese and Korean in the same fragment', () => {
  assert.equal(romanizeLyricsReading('きょう 안녕 スーパー'), 'kyou annyeong suupaa');
  assert.equal(romanizeKorean('한국 어'), 'hanguk eo');
  assert.equal(romanizeKorean('한국, 어'), 'hanguk, eo');
  assert.deepEqual(splitLyricScriptRuns('君と 안녕 スーパー'), ['君', 'と', ' ', '안녕', ' ', 'スーパー']);
});

test('normalizeFuriganaSegments joins split Korean syllables but preserves real word spaces', () => {
  assert.deepEqual(normalizeFuriganaSegments([
    { text: '안', reading: '' },
    { text: '녕', reading: '' },
    { text: ' ', reading: '' },
    { text: '하세', reading: '' },
    { text: '요', reading: '' },
  ]), [
    { text: '안녕', reading: '' },
    { text: ' ', reading: '' },
    { text: '하세요', reading: '' },
  ]);
  assert.deepEqual(normalizeFuriganaSegments([{ text: '안녕 세상!', reading: '' }]), [
    { text: '안녕', reading: '' },
    { text: ' ', reading: '' },
    { text: '세상', reading: '' },
    { text: '!', reading: '' },
  ]);
  assert.equal(isKoreanReadingSegment('안녕'), true);
  assert.equal(isKoreanReadingSegment('안녕!'), false);
});

test('resolveFuriganaReading adds Latin readings above Korean source text', () => {
  assert.equal(resolveFuriganaReading('안녕', '', false), '');
  assert.equal(resolveFuriganaReading('안녕', '', true), 'annyeong');
  assert.equal(resolveFuriganaReading('사랑해', '', true), 'saranghae');
});
