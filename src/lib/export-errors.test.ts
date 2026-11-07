import assert from 'node:assert/strict';
import test from 'node:test';
import { EXPORT_ERROR_KEYS, exportErrorMsg } from './export-errors.ts';

const t = (key: string) => key;

test('every export error code maps to a distinct localized key', () => {
  assert.equal(exportErrorMsg(t, 'song_not_found'), 'song.exportSongNotFound');
  assert.equal(exportErrorMsg(t, 'lrc_no_synced_lyrics'), 'song.exportLrcUnavailable');
  assert.equal(exportErrorMsg(t, 'forbidden'), 'apiErrors.forbidden');
  assert.equal(exportErrorMsg(t, 'login_required'), 'apiErrors.loginRequired');
});

test('unknown or missing codes fall back to the generic export failure', () => {
  assert.equal(exportErrorMsg(t, 'brand_new_export_error'), 'song.exportFailed');
  assert.equal(exportErrorMsg(t, undefined), 'song.exportFailed');
  // Callers may supply their own fallback key.
  assert.equal(exportErrorMsg(t, undefined, 'song.exportSongNotFound'), 'song.exportSongNotFound');
});

test('unknown codes never leak the raw server string to the UI', () => {
  for (const code of Object.keys(EXPORT_ERROR_KEYS)) {
    assert.ok(EXPORT_ERROR_KEYS[code].includes('.'), `${code} should map to a namespaced i18n key`);
  }
});
