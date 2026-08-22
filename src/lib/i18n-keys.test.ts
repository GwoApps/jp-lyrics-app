import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LYRICS_SOURCE_KEYS } from './lyrics-source.ts';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const i18nDir = join(here, '..', 'i18n');
const LOCALES = ['ja', 'en', 'zh-CN', 'zh-TW'] as const;

type Dict = Record<string, Record<string, string>>;

function loadDict(locale: string): Dict {
  return JSON.parse(readFileSync(join(i18nDir, `${locale}.json`), 'utf8'));
}

function keySet(dict: Dict): string[] {
  const keys: string[] = [];
  for (const [ns, values] of Object.entries(dict)) {
    for (const key of Object.keys(values)) keys.push(`${ns}.${key}`);
  }
  return keys.sort();
}

test('all four locale dictionaries expose the exact same key set', () => {
  const base = keySet(loadDict(LOCALES[0]));
  for (const locale of LOCALES.slice(1)) {
    assert.deepEqual(keySet(loadDict(locale)), base, `${locale}.json keys differ`);
  }
});

test('common.clear exists in every locale with a human-readable accessible name', () => {
  for (const locale of LOCALES) {
    const value = loadDict(locale).common?.clear;
    assert.ok(value, `${locale}.json missing common.clear`);
    assert.notEqual(value, 'common.clear', `${locale}.json common.clear leaks the raw key`);
    assert.ok(value.trim().length > 0, `${locale}.json common.clear is empty`);
  }
});

test('common.* values used as aria-labels never leak the raw translation key', () => {
  // Icon-only buttons rely on aria-label as their accessible name. If a
  // dictionary value equals its own key (e.g. "clear": "common.clear"),
  // screen readers announce the internal identifier instead of a real label.
  for (const locale of LOCALES) {
    const common = loadDict(locale).common ?? {};
    for (const [key, value] of Object.entries(common)) {
      assert.notEqual(value, `common.${key}`, `${locale}.json common.${key} leaks the raw key`);
    }
  }
});

test('every LYRICS_SOURCE_KEYS value exists in all locale files', () => {
  const sourceValues = Object.values(LYRICS_SOURCE_KEYS);
  for (const locale of LOCALES) {
    const lyricsSources = loadDict(locale).lyricsSources ?? {};
    for (const dottedKey of sourceValues) {
      // dottedKey is like 'lyricsSources.manual'; strip the namespace prefix
      const leafKey = dottedKey.split('.').slice(1).join('.');
      assert.ok(
        leafKey in lyricsSources,
        `${locale}.json is missing lyricsSources.${leafKey} (referenced by LYRICS_SOURCE_KEYS)`,
      );
    }
  }
});
