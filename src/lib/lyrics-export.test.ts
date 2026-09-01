import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildExport,
  buildHtmlExport,
  buildTextExport,
  ExportError,
  isEmptyAfterTrim,
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

test('parseTranslations keeps index alignment by replacing non-string entries with empty strings', () => {
  assert.deepEqual(parseTranslations(''), []);
  assert.deepEqual(parseTranslations('bad'), []);
  // Non-string slots are kept in place as '' (never filtered) so later
  // lines keep their source-line index.
  assert.deepEqual(parseTranslations('["a", 1, null]'), ['a', '', '']);
  assert.deepEqual(parseTranslations('["第一行", null, "第三行"]'), ['第一行', '', '第三行']);
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
  assert.equal(lrc.contentType, 'text/plain; charset=utf-8');
  // LRC ignores the reading option but injects missing [ti:]/[ar:] metadata and
  // pairs each timed row with its translation on the same timestamp.
  assert.equal(
    lrc.body,
    `[ti:${SONG.title}]\n[ar:${SONG.artist}]\n[00:01.000]桜が舞う\n[00:01.000]Cherry blossoms dance\n[00:05.000]明日へ\n[00:05.000]Toward tomorrow`,
  );

  const html = buildExport(SONG, { format: 'html', includeTranslation: true, reading: 'furigana' });
  assert.equal(html.extension, 'html');
  assert.equal(html.contentType, 'text/html; charset=utf-8');
});

test('isEmptyAfterTrim treats invisible whitespace as empty', () => {
  assert.equal(isEmptyAfterTrim(''), true);
  assert.equal(isEmptyAfterTrim(null), true);
  assert.equal(isEmptyAfterTrim(undefined), true);
  assert.equal(isEmptyAfterTrim('   '), true);
  assert.equal(isEmptyAfterTrim('\t\n\r'), true);
  assert.equal(isEmptyAfterTrim('\u00a0\u3000\u200b\u200c\u200d\ufeff'), true);
  assert.equal(isEmptyAfterTrim('  [00:01.00]桜が舞う\n  '), false);
});

test('buildExport LRC rejects blank synced lyrics (incl. invisible whitespace)', () => {
  for (const blank of ['', '   ', '\t\n', '\u00a0\u200b\ufeff']) {
    const song = { ...SONG, lyrics_synced: blank };
    assert.throws(
      () => buildExport(song, { format: 'lrc', includeTranslation: false }),
      (error: unknown) => error instanceof ExportError && error.code === 'lrc_no_synced_lyrics',
    );
  }
});

test('buildTextExport keeps line alignment when a stale null slot exists mid-cache', () => {
  const song = {
    ...SONG,
    // Line 2 (null slot) must not cause line 3's translation to shift up.
    lyrics_translation: JSON.stringify(['Cherry blossoms dance', null, 'Toward tomorrow']),
  };
  const withTranslation = buildTextExport(song, true, 'none');
  // Even though index 1 is a null slot, "Toward tomorrow" stays on the THIRD
  // source line (index 2) — it is not printed under line 2.
  assert.equal(
    withTranslation,
    '桜が舞う\nCherry blossoms dance\n\n明日へ\nToward tomorrow',
  );
});

test('buildExport LRC injects [ti:]/[ar:] metadata when missing', () => {
  const lrc = buildExport(SONG, { format: 'lrc', includeTranslation: false });
  assert.match(lrc.body, /^\[ti:桜\]\n/);
  assert.match(lrc.body, /^\[ar:Example\]\n/m);
  // Original synced rows are preserved after the injected tags
  assert.match(lrc.body, /\[00:01\.000\]桜が舞う/);
});

test('buildExport LRC does not duplicate existing metadata tags', () => {
  const synced = '[ti:原曲名]\n[ar:原歌手]\n[00:01.000]桜が舞う';
  const lrc = buildExport({ ...SONG, lyrics_synced: synced }, { format: 'lrc', includeTranslation: false });
  assert.equal(lrc.body, synced);
});

test('buildExport LRC keeps existing tags and only fills the missing one', () => {
  const synced = '[ar:原歌手]\n[00:01.000]桜が舞う';
  const lrc = buildExport({ ...SONG, lyrics_synced: synced }, { format: 'lrc', includeTranslation: false });
  assert.match(lrc.body, /^\[ti:桜\]\n/);
  assert.match(lrc.body, /^\[ar:原歌手\]\n/m);
  // Only one [ti:] tag total
  assert.equal((lrc.body.match(/\[ti:/g) ?? []).length, 1);
});

test('buildExport LRC omits metadata tags for missing title/artist', () => {
  const lrc = buildExport(
    { ...SONG, title: '', artist: '' },
    { format: 'lrc', includeTranslation: false },
  );
  assert.equal(lrc.body, SONG.lyrics_synced);
});

test('buildExport LRC with translation skips blank source lines and keeps index alignment', () => {
  // lyrics_raw = '桜が舞う\n\n明日へ' — the blank separator line (index 1) must
  // NOT consume a synced row, so 'Toward tomorrow' (index 2) pairs with the
  // SECOND timed row, not the first.
  const song = { ...SONG, lyrics_raw: '桜が舞う\n\n明日へ' };
  const lrc = buildExport(song, { format: 'lrc', includeTranslation: true });
  assert.equal(
    lrc.body,
    `[ti:${SONG.title}]\n[ar:${SONG.artist}]\n[00:01.000]桜が舞う\n[00:01.000]Cherry blossoms dance\n[00:05.000]明日へ\n[00:05.000]Toward tomorrow`,
  );
});

test('buildExport LRC with translation does not emit a redundant line for untranslated rows', () => {
  const song = {
    ...SONG,
    // The second timed row ('明日へ') has no translation -> no extra line.
    lyrics_translation: JSON.stringify(['Cherry blossoms dance', '', '']),
  };
  const lrc = buildExport(song, { format: 'lrc', includeTranslation: true });
  assert.equal(
    lrc.body,
    `[ti:${SONG.title}]\n[ar:${SONG.artist}]\n[00:01.000]桜が舞う\n[00:01.000]Cherry blossoms dance\n[00:05.000]明日へ`,
  );
});

test('buildExport LRC with translation keeps alignment when a stale null slot sits mid-cache', () => {
  const song = {
    ...SONG,
    // Index 1 is a null slot: index 2 ('Toward tomorrow') must still pair with
    // the second timed row instead of shifting up to the first.
    lyrics_translation: JSON.stringify(['Cherry blossoms dance', null, 'Toward tomorrow']),
  };
  const lrc = buildExport(song, { format: 'lrc', includeTranslation: true });
  assert.match(lrc.body, /\[00:01\.000\]Cherry blossoms dance\n\[00:05\.000\]明日へ\n\[00:05\.000\]Toward tomorrow/);
  // The null slot must not produce a translation under the first timed row.
  assert.doesNotMatch(lrc.body, /\[00:01\.000\]\n/);
});

test('buildExport LRC with translation preserves existing metadata tags and reuses their timestamps', () => {
  const synced = '[ar:原歌手]\n[00:01.000]桜が舞う';
  const lrc = buildExport({ ...SONG, lyrics_synced: synced }, { format: 'lrc', includeTranslation: true });
  assert.equal(
    lrc.body,
    `[ti:${SONG.title}]\n[ar:原歌手]\n[00:01.000]桜が舞う\n[00:01.000]Cherry blossoms dance`,
  );
});

test('buildExport LRC with translation keeps untimed rows and multi-timestamp prefixes intact', () => {
  // Multi-timestamp row: the translation reuses the whole `[..][..]` prefix so it
  // stays lined up with the player highlight; an untimed row is left untouched.
  const synced = '[00:01.000][00:02.000]桜が舞う\n未标记行';
  const lrc = buildExport(
    { ...SONG, lyrics_synced: synced, lyrics_raw: '桜が舞う\n未标记行' },
    { format: 'lrc', includeTranslation: true },
  );
  assert.equal(
    lrc.body,
    `[ti:${SONG.title}]\n[ar:${SONG.artist}]\n[00:01.000][00:02.000]桜が舞う\n[00:01.000][00:02.000]Cherry blossoms dance\n未标记行`,
  );
});
