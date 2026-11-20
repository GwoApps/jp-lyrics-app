import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const src = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Compile the real provider (TSX -> CommonJS) and feed it real dictionaries,
// so the count=1/0/2 cases exercise the same t() the app renders with.

const i18nSource = await readFile(resolve(src, 'lib/i18n.tsx'), 'utf8');
const i18nJs = ts.transpileModule(i18nSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
const dictionaries: Record<string, Record<string, Record<string, string>>> = {
  en: JSON.parse(await readFile(resolve(src, 'i18n/en.json'), 'utf8')),
  ja: JSON.parse(await readFile(resolve(src, 'i18n/ja.json'), 'utf8')),
  'zh-CN': JSON.parse(await readFile(resolve(src, 'i18n/zh-CN.json'), 'utf8')),
  'zh-TW': JSON.parse(await readFile(resolve(src, 'i18n/zh-TW.json'), 'utf8')),
};
const exports: Record<string, unknown> = {};
runInNewContext(i18nJs, {
  exports,
  require: (specifier: string) => {
    if (specifier === 'react') return React;
    if (specifier === '@/i18n/en.json') return dictionaries.en;
    if (specifier === '@/i18n/ja.json') return dictionaries.ja;
    if (specifier === '@/i18n/zh-CN.json') return dictionaries['zh-CN'];
    if (specifier === '@/i18n/zh-TW.json') return dictionaries['zh-TW'];
    if (specifier === './locale') {
      return {
        DEFAULT_LOCALE: 'zh-CN',
        LOCALE_COOKIE: 'locale',
        LOCALE_STORAGE_KEY: 'locale',
        localeCookieAttributes: () => 'path=/',
        localeToBCP47: (l: string) => l,
      };
    }
    return require(specifier);
  },
  console,
  process,
});
const I18nProvider = exports.I18nProvider as React.ComponentType<{ initialLocale?: string; children?: React.ReactNode }>;
const useI18n = exports.useI18n as () => { t: (key: string, vars?: Record<string, string | number>) => string };

function translate(locale: string, key: string, count: number): string {
  let result = '';
  function Probe() {
    result = useI18n().t(key, { count });
    return null;
  }
  renderToStaticMarkup(React.createElement(I18nProvider, { initialLocale: locale }, React.createElement(Probe)));
  return result;
}

test('count=1 picks the _one variant, count=0/2 keep the base key', () => {
  for (const [key, one, many] of [
    ['home.songCount', '1 song', '0 songs'],
    ['home.albumCount', '1 album', '0 albums'],
    ['home.albumTrackCount', '1 track', '0 tracks'],
  ] as const) {
    assert.equal(translate('en', key, 1), one, `${key} count=1`);
    assert.equal(translate('en', key, 0), many, `${key} count=0`);
    assert.equal(translate('en', key, 2), many.replace('0 ', '2 '), `${key} count=2`);
  }
});

test('a missing _one key falls back to the original key without changing the caller', () => {
  assert.equal(translate('en', 'common.cancel', 1), dictionaries.en.common.cancel);
  assert.equal(translate('en', 'common.cancel', 2), dictionaries.en.common.cancel);
});

test('all four locales share the same _one keys and keep their own wording', () => {
  const singularKeys = [
    ['common', 'linesSynced'], ['artists', 'artistCount'], ['home', 'albumCount'],
    ['home', 'songCount'], ['home', 'albumTrackCount'],
    ['home', 'playlistImportReviewHeader'], ['song', 'translationContinueRemain'],
    ['admin', 'songCount'],
  ] as const;
  for (const locale of Object.keys(dictionaries)) {
    for (const [ns, key] of singularKeys) {
      assert.ok(dictionaries[locale][ns][key + '_one'], `${locale} ${ns}.${key}_one`);
    }
  }
  assert.equal(translate('zh-CN', 'home.songCount', 1), '1 首');
  assert.equal(translate('zh-CN', 'home.songCount', 2), '2 首');
});
