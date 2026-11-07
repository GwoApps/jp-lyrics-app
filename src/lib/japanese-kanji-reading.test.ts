import assert from 'node:assert/strict';
import test from 'node:test';
import { splitJapaneseKanjiReading, normalizeJapaneseFuriganaLines } from './japanese-kanji-reading.ts';
import { renderFuriganaLineToHtml, buildTextExport } from './lyrics-export.ts';
import { validateFuriganaPayload } from './furigana-validation.ts';
import { renderPipLyricsHtml } from './pip-render.ts';
import {
  __setTokenizerLoaderForTest,
  convertToFuriganaClient,
  resetTokenizer,
} from './kuroshiro-client.ts';

const seg = (text: string, reading: string, pos?: string) =>
  pos ? { text, reading, pos } : { text, reading };

test('reading belongs only to the kanji run, not okurigana or kana prefixes', () => {
  assert.deepEqual(splitJapaneseKanjiReading(seg('食べる', 'たべる', '動詞')), [
    seg('食', 'た', '動詞'), { text: 'べる', reading: '', joinPrev: true },
  ]);
  assert.deepEqual(splitJapaneseKanjiReading(seg('お茶', 'おちゃ')), [
    seg('お', ''), { text: '茶', reading: 'ちゃ', joinPrev: true },
  ]);
  assert.deepEqual(splitJapaneseKanjiReading(seg('取り扱い', 'とりあつかい')), [
    seg('取', 'と'), { text: 'り', reading: '', joinPrev: true },
    { text: '扱', reading: 'あつか', joinPrev: true }, { text: 'い', reading: '', joinPrev: true },
  ]);
  assert.deepEqual(splitJapaneseKanjiReading(seg('食べる', 'タベル')), [
    seg('食', 'タ'), { text: 'べる', reading: '', joinPrev: true },
  ]);
  assert.deepEqual(splitJapaneseKanjiReading(seg('一人', 'ひとり')), [seg('一人', 'ひとり')]);
  assert.deepEqual(splitJapaneseKanjiReading(seg('時々に', 'ときどきに')), [
    seg('時々', 'ときどき'), { text: 'に', reading: '', joinPrev: true },
  ]);
  assert.deepEqual(splitJapaneseKanjiReading(seg('しかし', '')), [seg('しかし', '')]);
});

test('keep raw lyrics and uncertain manual readings lossless; never render uncertain whole-word ruby', () => {
  assert.deepEqual(splitJapaneseKanjiReading(seg('お茶', 'ちゃ')), [seg('お茶', 'ちゃ')]);
  assert.doesNotMatch(renderFuriganaLineToHtml({ segments: [seg('お茶', 'ちゃ')] }, 'furigana', 'ja-kana'), /<ruby>/);
  assert.deepEqual(splitJapaneseKanjiReading(seg('食べる', '')), [seg('食べる', '')]);
  const lines = [
    { segments: [seg('食べる', 'たべる')] },
    { segments: [] },
    { segments: [seg('お茶', 'おちゃ')] },
  ];
  const normalized = normalizeJapaneseFuriganaLines(lines);
  assert.equal(normalized.map((line) => line.segments.map((s) => s.text).join('')).join('\n'), '食べる\n\nお茶');
  assert.deepEqual(normalizeJapaneseFuriganaLines(normalized), normalized);
});

test('existing stored annotations render kanji-only ruby in HTML and PiP, Cantonese unchanged', () => {
  const legacy = { segments: [seg('食べる', 'たべる'), seg('と', ''), seg('お茶', 'おちゃ')] };
  const html = renderFuriganaLineToHtml(legacy, 'furigana', 'ja-kana');
  assert.match(html, /<ruby>食<rp>\(<\/rp><rt>た<\/rt><rp>\)<\/rp><\/ruby>べる/);
  assert.match(html, /お<ruby>茶<rp>\(<\/rp><rt>ちゃ<\/rt><rp>\)<\/rp><\/ruby>/);
  assert.doesNotMatch(html, /<ruby>(?:べる|と|お)/);
  const pip = renderPipLyricsHtml([legacy], 'ja-kana', 'furigana', false);
  assert.match(pip, /<ruby>食<rp>\(<\/rp><rt>た<\/rt><rp>\)<\/rp><\/ruby>べる/);
  const cantonese = { segments: [seg('香港', 'hoeng1 gong2')] };
  assert.match(renderFuriganaLineToHtml(cantonese, 'furigana', 'yue-jyutping'),
    /<ruby>香港<rp>\(<\/rp><rt lang="yue-Latn">hoeng1 gong2<\/rt>/);
});

test('persisted split-token boundary survives validation and romaji text export', () => {
  const annotation = [{ segments: [
    seg('食', 'た', '動詞'), { text: 'べる', reading: '', joinPrev: true },
    seg('と', ''), seg('お', ''), { text: '茶', reading: 'ちゃ', joinPrev: true },
  ] }];
  const validated = validateFuriganaPayload(annotation, '食べるとお茶');
  assert.equal(validated.ok, true);
  if (!validated.ok) return;
  assert.deepEqual(validated.lines, annotation);
  assert.equal(buildTextExport({
    title: '', artist: '', lyrics_raw: '食べるとお茶', lyrics_synced: '',
    lyrics_furigana: JSON.stringify(validated.lines), lyrics_translation: '[]',
    reading_scheme: 'ja-kana',
  }, false, 'romaji'), 'taberu to ocha');
  assert.deepEqual(validateFuriganaPayload([{ segments: [
    { text: '食', reading: 'た', joinPrev: 'yes' },
  ] }], '食'), { ok: false, error: 'invalid_furigana' });
});

test('new browser tokenizer results persist only kanji readings', async () => {
  __setTokenizerLoaderForTest(async () => ({
    tokenize: () => [
      { surface_form: '食べる', reading: 'タベル', pos: '動詞' },
      { surface_form: 'そして', reading: 'ソシテ', pos: '接続詞' },
      { surface_form: 'お茶', reading: 'オチャ', pos: '名詞' },
    ],
  }));
  resetTokenizer();
  try {
    const lines = await convertToFuriganaClient('食べるそしてお茶\n');
    assert.deepEqual(lines, [
      { segments: [seg('食', 'た', '動詞'), { text: 'べる', reading: '', joinPrev: true }, seg('そして', '', '接続詞'),
        seg('お', ''), { text: '茶', reading: 'ちゃ', pos: '名詞', joinPrev: true }] },
      { segments: [] },
    ]);
  } finally {
    resetTokenizer();
  }
});
