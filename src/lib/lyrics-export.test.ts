import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildExport,
  buildHtmlExport,
  buildTextExport,
  parseFuriganaLines,
  parseTranslations,
  renderFuriganaLineToHtml,
} from './lyrics-export.ts';

const SONG = {
  title: '桜',
  artist: 'Example',
  lyrics_raw: '桜が舞う\n\n明日へ',
  lyrics_synced: '[00:01.000]桜が舞う\n[00:05.000]明日へ',
  lyrics_furigana: JSON.stringify([
    { segments: [{ text: '桜', reading: 'さくら' }, { text: 'が', reading: '' }, { text: '舞う', reading: 'まう' }] },
    { segments: [] },
    { segments: [{ text: '明日', reading: 'あした' }, { text: 'へ', reading: '' }] },
  ]),
  lyrics_translation: JSON.stringify(['Cherry blossoms dance', '', 'Toward tomorrow']),
  reading_scheme: 'ja-kana' as const,
};

test('parseFuriganaLines handles empty and malformed JSON', () => {
  assert.deepEqual(parseFuriganaLines(''), []);
  assert.deepEqual(parseFuriganaLines('not-json'), []);
  assert.deepEqual(parseFuriganaLines('{"a":1}'), []);
  assert.deepEqual(parseFuriganaLines('[1,2]'), []);
  assert.equal(parseFuriganaLines(SONG.lyrics_furigana).length, 3);
});

test('parseTranslations filters non-string entries', () => {
  assert.deepEqual(parseTranslations(''), []);
  assert.deepEqual(parseTranslations('["a", 1, null]'), ['a']);
  assert.deepEqual(parseTranslations('bad'), []);
});

test('buildTextExport emits original text by default and pairs translations', () => {
  const plain = buildTextExport(SONG, false, 'none');
  assert.equal(plain, '桜が舞う\n\n明日へ');

  const withTranslation = buildTextExport(SONG, true, 'none');
  assert.equal(withTranslation, '桜が舞う\nCherry blossoms dance\n\n明日へ\nToward tomorrow');
});

test('buildTextExport substitutes furigana and romanized readings', () => {
  const furigana = buildTextExport(SONG, false, 'furigana');
  assert.equal(furigana, 'さくらがまう\n\nあしたへ');

  const romaji = buildTextExport(SONG, false, 'romaji');
  assert.equal(romaji, 'sakura ga mau\n\nashita he');
});

test('buildTextExport falls back to raw text when no furigana line exists', () => {
  const song = { ...SONG, lyrics_furigana: '[]' };
  assert.equal(buildTextExport(song, false, 'furigana'), SONG.lyrics_raw);
  assert.equal(buildTextExport(song, false, 'romaji'), SONG.lyrics_raw);
});

test('renderFuriganaLineToHtml honours reading mode', () => {
  const line = { segments: [{ text: '桜', reading: 'さくら' }, { text: 'が', reading: '' }] };
  assert.equal(
    renderFuriganaLineToHtml(line, 'none', 'ja-kana'),
    '<p>桜が</p>',
  );
  assert.match(renderFuriganaLineToHtml(line, 'furigana', 'ja-kana'), /<ruby>桜<rp>\(<\/rp><rt>さくら<\/rt><rp>\)<\/rp><\/ruby>/);
  assert.match(renderFuriganaLineToHtml(line, 'romaji', 'ja-kana'), /<rt>sakura<\/rt>/);
  assert.match(renderFuriganaLineToHtml(line, 'furigana', 'yue-jyutping'), /<rt lang="yue-Latn">/);
  assert.equal(renderFuriganaLineToHtml({ segments: [] }, 'furigana', 'ja-kana'), '<p class="empty">&nbsp;</p>');
});

test('buildHtmlExport pairs translations below source lines', () => {
  const html = buildHtmlExport(SONG, true, 'furigana');
  assert.match(html, /<title>桜<\/title>/);
  assert.match(html, /<p class="artist">Example<\/p>/);
  assert.match(html, /<p class="translation">Cherry blossoms dance<\/p>/);
  assert.match(html, /<p class="translation">Toward tomorrow<\/p>/);
  // Blank separator line stays empty with no translation pair
  assert.match(html, /<p class="empty">&nbsp;<\/p>/);
  // Only one translation paragraph per non-empty source line
  assert.equal((html.match(/<p class="translation">/g) ?? []).length, 2);
});

test('buildHtmlExport omits translations when disabled', () => {
  const html = buildHtmlExport(SONG, false, 'furigana');
  assert.equal((html.match(/<p class="translation">/g) ?? []).length, 0);
});

test('buildHtmlExport escapes lyrics and falls back to plain lines', () => {
  const song = { ...SONG, lyrics_furigana: '[]', lyrics_raw: 'A & B <C>' };
  const html = buildHtmlExport(song, false, 'none');
  assert.match(html, /A &amp; B &lt;C&gt;/);
});

test('buildExport routes formats and extensions', () => {
  const text = buildExport(SONG, { format: 'text', includeTranslation: false, reading: 'none' });
  assert.equal(text.extension, 'txt');
  assert.equal(text.contentType, 'text/plain; charset=utf-8');

  const lrc = buildExport(SONG, { format: 'lrc', includeTranslation: true, reading: 'furigana' });
  assert.equal(lrc.extension, 'lrc');
  assert.equal(lrc.body, SONG.lyrics_synced); // LRC ignores reading/translation options

  const html = buildExport(SONG, { format: 'html', includeTranslation: true, reading: 'furigana' });
  assert.equal(html.extension, 'html');
  assert.equal(html.contentType, 'text/html; charset=utf-8');
});
