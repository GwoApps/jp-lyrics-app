import test from 'node:test';
import assert from 'node:assert/strict';
import {
  convertCantoneseLyrics,
  detectCantoneseLyrics,
  getCantoneseReadingCandidates,
  normalizeReadingScheme,
} from './lyrics-reading.ts';

test('detectCantoneseLyrics gives a high-confidence suggestion for colloquial Cantonese', () => {
  const result = detectCantoneseLyrics('我哋一齊返嚟，唔好再講啲咁嘅嘢。');
  assert.equal(result.suggested, true);
  assert.equal(result.confidence, 'high');
  assert.ok(result.reasons.includes('哋'));
  assert.ok(result.reasons.includes('唔'));
});

test('detectCantoneseLyrics ignores Japanese and Han-only standard written Chinese', () => {
  assert.equal(detectCantoneseLyrics('君と東京へ行く').suggested, false);
  assert.equal(detectCantoneseLyrics('今天我寒夜裡看雪飄過').suggested, false);
});

test('detectCantoneseLyrics deduplicates repeated chorus lines', () => {
  const repeated = Array.from({ length: 8 }, () => '我係你朋友').join('\n');
  assert.notEqual(detectCantoneseLyrics(repeated).confidence, 'high');
});

test('normalizeReadingScheme keeps existing songs on Japanese readings by default', () => {
  assert.equal(normalizeReadingScheme(undefined), 'ja-kana');
  assert.equal(normalizeReadingScheme('yue-jyutping'), 'yue-jyutping');
  assert.equal(normalizeReadingScheme('invalid'), 'ja-kana');
});

test('convertCantoneseLyrics preserves every source character and blank line', async () => {
  const source = '香港人講廣東話\n\nHello 香港，今晚見';
  const lines = await convertCantoneseLyrics(source);
  assert.equal(lines.length, 3);
  assert.equal(lines[0].segments.map((segment) => segment.text).join(''), '香港人講廣東話');
  assert.deepEqual(lines[1], { segments: [] });
  assert.equal(lines[2].segments.map((segment) => segment.text).join(''), 'Hello 香港，今晚見');
  assert.deepEqual(lines[0].segments.slice(0, 2), [
    { text: '香', reading: 'hoeng1' },
    { text: '港', reading: 'gong2' },
  ]);
  assert.equal(lines[2].segments.find((segment) => segment.text === 'H')?.reading, '');
});

test('getCantoneseReadingCandidates returns the contextual reading and alternatives', async () => {
  const candidates = await getCantoneseReadingCandidates('行');
  assert.ok(candidates.includes('hang4') || candidates.includes('hong4'));
  assert.equal(candidates.length, new Set(candidates).size);
});
