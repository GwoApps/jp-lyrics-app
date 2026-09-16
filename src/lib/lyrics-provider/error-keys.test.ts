import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LYRICS_PROVIDER_SAVE_ERROR_CODES,
  LYRICS_PROVIDER_SAVE_ERROR_KEYS,
  LYRICS_PROVIDER_TEST_ERROR_CODES,
  LYRICS_PROVIDER_TEST_ERROR_KEYS,
  lyricsProviderSaveErrorKey,
  lyricsProviderTestErrorKey,
} from './error-keys.ts';

const here = dirname(fileURLToPath(import.meta.url));
const i18nDir = join(here, '..', '..', 'i18n');
const LOCALES = ['ja', 'en', 'zh-CN', 'zh-TW'] as const;

type Dict = Record<string, Record<string, string>>;

function loadDict(locale: string): Dict {
  return JSON.parse(readFileSync(join(i18nDir, `${locale}.json`), 'utf8'));
}

function dictionaryValue(dict: Dict, dottedKey: string): string | undefined {
  const [ns, ...rest] = dottedKey.split('.');
  return dict[ns]?.[rest.join('.')];
}

/** Every language-neutral code the save endpoints can answer with. */
const SAVE_CODES = [
  // src/app/api/admin/lyrics-providers/route.ts (POST create) + reorder
  'invalid_name', 'invalid_base_url', 'invalid_fields',
  'auth_secret_required', 'secret_key_not_configured',
  // Deployment policy (validateProviderBaseUrl), also used for source_config URLs
  'http_disallowed', 'unsafe_host', 'metadata_forbidden', 'dns_failed', 'invalid_url',
  // PUT /:id
  'builtin_readonly_field', 'http_provider_readonly_field', 'builtin_undeletable',
  'invalid_source_config', 'invalid_source_schema',
];

/** Every code POST /:id/test and the persisted health check can report. */
const TEST_CODES = [
  ...SAVE_CODES,
  // test endpoint
  'builtin_no_manifest',
  // http-client.ts (fetchManifest / parseManifest / mapHttpStatus)
  'invalid_response', 'protocol_mismatch', 'protocol_version', 'timeout',
  'empty', 'invalid_request', 'auth_failed', 'rate_limited', 'temporary_unavailable', 'error',
];

test('every save error code resolves to an i18n key', () => {
  for (const code of SAVE_CODES) {
    const key = lyricsProviderSaveErrorKey(code);
    assert.ok(key, `no i18n key mapped for save code "${code}"`);
    assert.notEqual(key, code, `save code "${code}" maps to itself instead of an i18n key`);
  }
});

test('every test error code resolves to an i18n key', () => {
  for (const code of TEST_CODES) {
    const key = lyricsProviderTestErrorKey(code);
    assert.ok(key, `no i18n key mapped for test code "${code}"`);
    assert.notEqual(key, code, `test code "${code}" maps to itself instead of an i18n key`);
  }
});

test('every mapped key resolves to a human-readable value in all four locales', () => {
  // Guards the ISSUE #303 regression: a code whose key misses the dictionary
  // makes the UI render the raw key string instead of a message.
  const keys = new Set([
    ...Object.values(LYRICS_PROVIDER_SAVE_ERROR_KEYS),
    ...Object.values(LYRICS_PROVIDER_TEST_ERROR_KEYS),
  ]);
  for (const locale of LOCALES) {
    const dict = loadDict(locale);
    for (const dottedKey of keys) {
      const value = dictionaryValue(dict, dottedKey);
      assert.ok(value !== undefined, `${locale}.json is missing "${dottedKey}"`);
      assert.notEqual(value, dottedKey, `${locale}.json "${dottedKey}" leaks the raw key`);
      assert.ok(value.trim().length > 0, `${locale}.json "${dottedKey}" is empty`);
    }
  }
});

test('the mapped key set stays in sync with the code lists', () => {
  assert.deepEqual([...LYRICS_PROVIDER_SAVE_ERROR_CODES].sort(), [...SAVE_CODES].sort());
  assert.deepEqual([...LYRICS_PROVIDER_TEST_ERROR_CODES].sort(), [...TEST_CODES].sort());
  // The test table is the save table plus the manifest health-check codes.
  for (const code of LYRICS_PROVIDER_SAVE_ERROR_CODES) {
    assert.equal(
      LYRICS_PROVIDER_TEST_ERROR_KEYS[code],
      LYRICS_PROVIDER_SAVE_ERROR_KEYS[code],
      `code "${code}" maps differently for save and test`,
    );
  }
});

test('unknown or missing codes resolve to null so callers fall back to generic copy', () => {
  // The fallback must be the caller's generic message (admin.lyricsProviderSaveFailed /
  // admin.lyricsProviderTestFail), never the raw code and never a derived key.
  assert.equal(lyricsProviderSaveErrorKey('brand_new_code'), null);
  assert.equal(lyricsProviderTestErrorKey('brand_new_code'), null);
  assert.equal(lyricsProviderSaveErrorKey(undefined), null);
  assert.equal(lyricsProviderTestErrorKey(undefined), null);
  assert.equal(lyricsProviderSaveErrorKey(''), null);
  assert.equal(lyricsProviderTestErrorKey(''), null);
  // The old capCode() shape would have derived these keys and missed them.
  assert.equal(lyricsProviderSaveErrorKey('lyricsProviderErrorInvalidbaseurl'), null);
  assert.equal(lyricsProviderTestErrorKey('lyricsProviderErrorDnsfailed'), null);
});

test('error-keys.ts stays client-safe and never reaches the database layer', () => {
  const source = readFileSync(join(here, 'error-keys.ts'), 'utf8');
  assert.ok(!/from\s+['"][^'"]*\/db(\.ts)?['"]/.test(source), 'error-keys.ts must not import the db module');
  assert.ok(!/\bgetDB\b/.test(source), 'error-keys.ts must not reference getDB');
});
