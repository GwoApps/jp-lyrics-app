import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  asLocale, DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, LOCALE_META,
  LOCALES, LOCALE_STORAGE_KEY, localeCookieAttributes, localeFromLanguages, localeToBCP47,
} from './locale.ts';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, '..', rel), 'utf8');
const layoutSource = read('app/layout.tsx');
const i18nSource = read('lib/i18n.tsx');

test('the four locales are the ones the switcher and the dictionaries offer', () => {
  assert.deepEqual([...LOCALES], ['ja', 'en', 'zh-CN', 'zh-TW']);
  for (const locale of LOCALES) {
    assert.ok(LOCALE_META[locale]?.label, `LOCALE_META is missing ${locale}`);
    assert.ok(localeToBCP47(locale), `localeToBCP47 is missing ${locale}`);
  }
  assert.equal(DEFAULT_LOCALE, 'zh-CN');
});

test('any unknown value normalizes to the reference locale instead of crashing', () => {
  for (const value of [null, undefined, '', 'fr', 'zh', 'zh-cn', 'ZH-TW', 'en-US']) {
    assert.equal(isLocale(value), false, `${String(value)} should not be a stored locale`);
    assert.equal(asLocale(value), DEFAULT_LOCALE, `${String(value)} should fall back`);
  }
  for (const locale of LOCALES) assert.equal(asLocale(locale), locale);
});

test('Accept-Language picks the same locale navigator.languages would have', () => {
  assert.equal(localeFromLanguages(['ja-JP', 'ja']), 'ja');
  assert.equal(localeFromLanguages(['en-US', 'en']), 'en');
  assert.equal(localeFromLanguages(['zh-CN', 'zh']), 'zh-CN');
  // Traditional-script variants are recognized by region and by script subtag.
  assert.equal(localeFromLanguages(['zh-TW']), 'zh-TW');
  assert.equal(localeFromLanguages(['zh-HK']), 'zh-TW');
  assert.equal(localeFromLanguages(['zh-Hant']), 'zh-TW');
  // First supported language wins, unknown ones are skipped.
  assert.equal(localeFromLanguages(['fr-FR', 'de', 'ja']), 'ja');
  assert.equal(localeFromLanguages([]), DEFAULT_LOCALE);
});

test('the locale cookie is the bridge between the client choice and the server render', () => {
  // Same name in both stores, so one write keeps them in step.
  assert.equal(LOCALE_COOKIE, LOCALE_STORAGE_KEY);
  const attributes = localeCookieAttributes();
  assert.match(attributes, /path=\//);
  assert.match(attributes, new RegExp(`max-age=${LOCALE_COOKIE_MAX_AGE}`));
  assert.match(attributes, /samesite=lax/i);
  // A language choice is not a session preference: it must outlive the tab.
  assert.ok(LOCALE_COOKIE_MAX_AGE >= 30 * 24 * 60 * 60);
});

test('the root layout resolves the locale server-side and renders it in <html lang>', () => {
  assert.match(layoutSource, /from 'next\/headers'/, 'the layout must read the request to know the locale');
  assert.match(layoutSource, /cookies\(\)/);
  assert.match(layoutSource, /cookieStore\.get\(LOCALE_COOKIE\)/, 'the cookie is the recorded choice');
  assert.match(layoutSource, /accept-language/, 'a first visit has no cookie, only Accept-Language');
  assert.match(layoutSource, /<html lang=\{locale\}>/);
  // The layout is async because it awaits the request data.
  assert.match(layoutSource, /export default async function RootLayout/);
});

test('I18nProvider no longer withholds the tree until hydration (issue #419)', () => {
  // The regression that made every cold start blank: `!ready return null`.
  assert.doesNotMatch(i18nSource, /if \(!ready\) return null/);
  assert.doesNotMatch(i18nSource, /useSyncExternalStore\(subscribeHydration, \(\) => true, \(\) => false\)[\s\S]{0,80}return null/);
  // It renders on the server with the locale the layout resolved.
  assert.match(i18nSource, /initialLocale/);
  assert.match(i18nSource, /<I18nContext\.Provider/);
});

test('the chosen locale is mirrored into the cookie, not only localStorage', () => {
  assert.match(i18nSource, /document\.cookie = `\$\{LOCALE_COOKIE\}/);
  assert.match(i18nSource, /localStorage\.setItem\(LOCALE_STORAGE_KEY/);
  // Every locale still mirrors onto <html lang> for the font cascade (#274).
  assert.match(i18nSource, /document\.documentElement\.lang = locale/);
});

test('the shell keeps its language-neutral metadata', () => {
  // Unchanged from #273: `metadata` cannot await the request, so it must not
  // hard-code one language's copy.
  assert.doesNotMatch(layoutSource, /title:\s*'[^']*[\u4e00-\u9fff][^']*'/);
});
