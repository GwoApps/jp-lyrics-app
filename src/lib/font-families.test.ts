import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ALL_FONT_FAMILIES,
  fontFamiliesForLocale,
  fontFamiliesForTags,
  googleFontsHref,
  type GoogleFontFamily,
} from './font-families.ts';

function sorted(families: Iterable<GoogleFontFamily>): string[] {
  return [...families].sort();
}

test('fontFamiliesForTags maps each language to its Noto family', () => {
  assert.deepEqual(sorted(fontFamiliesForTags(['ja'])), ['jp']);
  assert.deepEqual(sorted(fontFamiliesForTags(['zh-CN'])), ['sc']);
  assert.deepEqual(sorted(fontFamiliesForTags(['zh-TW', 'zh-HK', 'yue-Hant'])), ['tc']);
  assert.deepEqual(sorted(fontFamiliesForTags(['en', 'yue-Latn'])), ['latin']);
  assert.deepEqual(sorted(fontFamiliesForTags(['pt-BR', '  ', null])), []);
});

test('fontFamiliesForTags unions all languages visible on a song page', () => {
  assert.deepEqual(sorted(fontFamiliesForTags(['ja', 'yue-Latn', 'zh-CN'])), ['jp', 'latin', 'sc']);
  assert.deepEqual(sorted(fontFamiliesForTags(['yue-Hant', 'zh-TW'])), ['tc']);
  // Latin is always loaded (UI + readings); locale adds one CJK family.
  assert.deepEqual(sorted(fontFamiliesForTags(['ja', 'en'])), ['jp', 'latin']);
});

test('fontFamiliesForLocale follows the UI locale and always keeps Latin', () => {
  assert.deepEqual(sorted(fontFamiliesForLocale('ja')), ['jp', 'latin']);
  assert.deepEqual(sorted(fontFamiliesForLocale('zh-CN')), ['latin', 'sc']);
  assert.deepEqual(sorted(fontFamiliesForLocale('zh-TW')), ['latin', 'tc']);
  assert.deepEqual(sorted(fontFamiliesForLocale('en')), ['latin']);
});

test('googleFontsHref keeps a stable order and only the requested families', () => {
  const href = googleFontsHref(new Set<GoogleFontFamily>(['sc', 'jp']));
  assert.match(href, /^https:\/\/fonts\.googleapis\.com\/css2\?/);
  assert.ok(href.indexOf('family=Inter:') < href.indexOf('family=Noto+Sans+JP:'));
  assert.ok(href.indexOf('family=Noto+Sans+JP:') < href.indexOf('family=Noto+Sans+SC:'));
  assert.ok(!href.includes('Noto+Sans+TC'));
  assert.ok(href.endsWith('&display=swap'));
  assert.equal(googleFontsHref(new Set()), '');
  assert.equal(new Set(ALL_FONT_FAMILIES).size, 4);
});
