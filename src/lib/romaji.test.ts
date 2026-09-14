import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isKatakanaReadingSegment,
  isKoreanReadingSegment,
  normalizeFuriganaSegments,
  resolveFuriganaReading,
  romanizeJapanese,
  romanizeKorean,
  romanizeLyricsReading,
  splitLongKatakanaForRuby,
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

test('resolveFuriganaReading keeps Cantonese Jyutping unchanged', () => {
  assert.equal(resolveFuriganaReading('香', 'hoeng1', true, 'yue-jyutping'), 'hoeng1');
  assert.equal(resolveFuriganaReading('香', 'hoeng1', false, 'yue-jyutping'), 'hoeng1');
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

test('resolveFuriganaReading reads は/へ as particles only when the part of speech says so', () => {
  const particle = { text: 'は', reading: '', pos: '助詞' };
  const noun = { text: 'は', reading: '' };

  // 助詞: は → wa, へ → e (katakana lyric text included)
  assert.equal(resolveFuriganaReading('は', '', true, 'ja-kana', particle), 'wa');
  assert.equal(resolveFuriganaReading('へ', '', true, 'ja-kana', { text: 'へ', reading: '', pos: '助詞' }), 'e');
  assert.equal(resolveFuriganaReading('ハ', '', true, 'ja-kana', { text: 'ハ', reading: '', pos: '助詞' }), 'wa');
  assert.equal(resolveFuriganaReading('ヘ', '', true, 'ja-kana', { text: 'ヘ', reading: '', pos: '助詞' }), 'e');

  // Non-particles and legacy segments (no pos) keep the literal reading.
  assert.equal(resolveFuriganaReading('は', '', true, 'ja-kana', noun), 'ha');
  assert.equal(resolveFuriganaReading('は', '', true), 'ha');
  assert.equal(resolveFuriganaReading('へ', '', true, 'ja-kana', { text: 'へ', reading: '', pos: '名詞' }), 'he');
  assert.equal(resolveFuriganaReading('はな', '', true, 'ja-kana', { text: 'はな', reading: '', pos: '名詞' }), 'hana');
  assert.equal(resolveFuriganaReading('を', '', true, 'ja-kana', { text: 'を', reading: '', pos: '助詞' }), 'o');

  // A kanji-backed segment is never rewritten by the particle rule.
  assert.equal(resolveFuriganaReading('葉', 'は', true, 'ja-kana', { text: '葉', reading: 'は', pos: '名詞' }), 'ha');
});

test('resolveFuriganaReading leaves the non-romanized ruby untouched by the particle rule', () => {
  // Without romanization the ruby keeps the stored reading: a kana particle
  // whose reading equals its text stays a no-op (unchanged behaviour).
  assert.equal(resolveFuriganaReading('は', '', false, 'ja-kana', { text: 'は', reading: '', pos: '助詞' }), '');
  assert.equal(resolveFuriganaReading('は', 'は', false, 'ja-kana', { text: 'は', reading: 'は', pos: '助詞' }), '');
  assert.equal(resolveFuriganaReading('はな', 'はな', false, 'ja-kana', { text: 'はな', reading: 'はな', pos: '名詞' }), '');
  assert.equal(resolveFuriganaReading('葉', 'は', false, 'ja-kana', { text: '葉', reading: 'は', pos: '名詞' }), 'は');
  // The particle rule is never applied to the jyutping scheme.
  assert.equal(resolveFuriganaReading('は', 'ha', true, 'yue-jyutping', { text: 'は', reading: 'ha', pos: '助詞' }), 'ha');
});

test('resolveFuriganaReading keeps merged kanji compounds and other readings literal', () => {
  // きょう/は is a noun + particle, but the へ particle in きょうへ reads え.
  const kyou = { text: 'きょう', reading: 'きょう', pos: '名詞' };
  assert.equal(resolveFuriganaReading('きょう', 'きょう', true, 'ja-kana', kyou), 'kyou');
  // Compound merges keep the tokenizer's pos (名詞) rather than turning into a particle.
  assert.equal(resolveFuriganaReading('一人', 'ひとり', true, 'ja-kana', { text: '一人', reading: 'ひとり', pos: '名詞' }), 'hitori');
  // A segment carrying a reading never falls through to the kana particle rule.
  assert.equal(resolveFuriganaReading('歯', 'は', true, 'ja-kana', { text: '歯', reading: 'は', pos: '名詞' }), 'ha');
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

test('splitLongKatakanaForRuby creates balanced break opportunities without changing source text', () => {
  assert.deepEqual(splitLongKatakanaForRuby('スーパー'), ['スーパー']);

  const source = 'コンピューターサイエンス';
  const chunks = splitLongKatakanaForRuby(source);
  assert.deepEqual(chunks, ['コンピューター', 'サイエンス']);
  assert.equal(chunks.join(''), source);
  assert.equal(chunks.every((chunk) => !chunk.endsWith('ッ')), true);
  assert.equal(isKatakanaReadingSegment(chunks[0]), true);

  const sokuon = splitLongKatakanaForRuby('マッチョッチョッチョッチョ');
  assert.equal(sokuon.join(''), 'マッチョッチョッチョッチョ');
  assert.equal(sokuon.every((chunk) => !chunk.endsWith('ッ')), true);

  const ambiguousN = splitLongKatakanaForRuby('シンアイシンアイシンアイ');
  assert.equal(ambiguousN.some((chunk, index) => (
    chunk.endsWith('ン') && /^[アイウエオヤユヨ]/.test(ambiguousN[index + 1] ?? '')
  )), false);

  const normalized = normalizeFuriganaSegments([{ text: source, reading: '' }]);
  assert.equal(normalized.length, 2);
  assert.equal(normalized.map((segment) => segment.text).join(''), source);
});

test('resolveFuriganaReading adds Latin readings above Korean source text', () => {
  assert.equal(resolveFuriganaReading('안녕', '', false), '');
  assert.equal(resolveFuriganaReading('안녕', '', true), 'annyeong');
  assert.equal(resolveFuriganaReading('사랑해', '', true), 'saranghae');
});
