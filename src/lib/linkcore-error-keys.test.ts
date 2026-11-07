import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LINKCORE_ERROR_KEYS, linkcoreErrorKey } from './linkcore-error-keys.ts';

/**
 * ISSUE #358: the create form derived its toast key from the API code
 * (`new.${data.error}`), so the `login_required` answer rendered the raw
 * identifier. These tests pin the mapping to real dictionary entries and pin
 * the list of codes to the route that produces them.
 */
const here = dirname(fileURLToPath(import.meta.url));
const i18nDir = join(here, '..', 'i18n');
const routePath = join(here, '..', 'app', 'api', 'lyrics', 'linkcore', 'route.ts');
const LOCALES = ['ja', 'en', 'zh-CN', 'zh-TW'] as const;

type Dict = Record<string, Record<string, string>>;

const loadDict = (locale: string): Dict =>
  JSON.parse(readFileSync(join(i18nDir, `${locale}.json`), 'utf8'));

const dictionaryValue = (dict: Dict, dottedKey: string): string | undefined => {
  const [namespace, ...rest] = dottedKey.split('.');
  return dict[namespace]?.[rest.join('.')];
};

test('every mapped Linkcore code resolves to a human-readable value in all four locales', () => {
  for (const locale of LOCALES) {
    const dict = loadDict(locale);
    for (const [code, dottedKey] of Object.entries(LINKCORE_ERROR_KEYS)) {
      const value = dictionaryValue(dict, dottedKey);
      assert.ok(value, `${locale}.json is missing ${dottedKey} (code ${code})`);
      assert.notEqual(value, dottedKey, `${locale}.json ${dottedKey} leaks the raw key`);
      assert.ok(value.trim().length > 0, `${locale}.json ${dottedKey} is empty`);
    }
  }
});

test('the map covers every error code and the auth failure the route can answer with', () => {
  const route = readFileSync(routePath, 'utf8');
  // Codes the route returns verbatim in the JSON body.
  const literals = [...route.matchAll(/error:\s*(?:code|'([^']+)')/g)].map((match) => match[1]).filter(Boolean);
  assert.ok(literals.includes('login_required'), 'route should answer login_required');
  for (const code of literals) {
    assert.ok(Object.hasOwn(LINKCORE_ERROR_KEYS, code), `LINKCORE_ERROR_KEYS is missing the route code "${code}"`);
  }
  // The fetch pipeline's error union must be enumerated too.
  const union = readFileSync(join(here, 'linkcore-lyrics.ts'), 'utf8')
    .match(/export type LinkcoreLyricsError =\s*([\s\S]*?);/)?.[1] ?? '';
  const codes = [...union.matchAll(/'([^']+)'/g)].map((match) => match[1]);
  assert.ok(codes.length > 0, 'could not read the LinkcoreLyricsError union');
  for (const code of codes) {
    assert.ok(Object.hasOwn(LINKCORE_ERROR_KEYS, code), `LINKCORE_ERROR_KEYS is missing the pipeline code "${code}"`);
  }
});

test('unknown or missing codes resolve to null so callers can fall back', () => {
  assert.equal(linkcoreErrorKey(undefined), null);
  assert.equal(linkcoreErrorKey(''), null);
  assert.equal(linkcoreErrorKey('something_else'), null);
  // Prototype keys must not resolve through the lookup.
  assert.equal(linkcoreErrorKey('constructor'), null);
  assert.equal(linkcoreErrorKey('toString'), null);
});

test('login_required maps to the existing generic auth copy, not a raw key', () => {
  assert.equal(linkcoreErrorKey('login_required'), 'apiErrors.loginRequired');
});
