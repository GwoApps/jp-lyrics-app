import assert from 'node:assert/strict';
import test from 'node:test';
import { SETTING_TO_LS, mergeSettingsWithLocal, SYNCABLE_KEYS } from './sync-settings.ts';
import { flushSettingUploads, queueSettingUpload, resetSettingUploads } from './settings-upload.ts';

test('settings form keeps the local choice over a stale server value (issue #519)', () => {
  const local: Record<string, string> = {
    [SETTING_TO_LS.font_size]: '26',
    [SETTING_TO_LS.reading_mode]: 'original',
  };
  const merged = mergeSettingsWithLocal(
    { font_size: '20', reading_mode: 'furigana', theme: 'dark' },
    (key) => local[key] ?? null,
  );
  assert.equal(merged.font_size, '26');
  assert.equal(merged.reading_mode, 'original');
  assert.equal(merged.theme, 'dark');
});

test('only known syncable settings keys are uploaded', () => {
  assert.ok(SYNCABLE_KEYS.includes('font_size'));
  assert.ok(SYNCABLE_KEYS.includes('reading_mode'));
  assert.ok(SYNCABLE_KEYS.includes('show_translation'));
  assert.ok(!SYNCABLE_KEYS.includes('sync_settings'));
});

test('rapid font-size changes collapse into one debounced upload (issue #519)', async () => {
  const previousWindow = globalThis.window;
  const previousStorage = globalThis.localStorage;
  const previousFetch = globalThis.fetch;
  const store: Record<string, string> = { [SETTING_TO_LS.font_size]: '20' };
  const calls: Record<string, string>[] = [];
  // A minimal browser stub: these helpers are plain client logic, no DOM needed.
  Object.defineProperty(globalThis, 'window', { value: {} as Window & typeof globalThis, configurable: true });
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: (key: string) => store[key] ?? null, setItem: (key: string, value: string) => { store[key] = value; } },
    configurable: true,
  });
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body)) as Record<string, string>);
    return { ok: true } as Response;
  }) as typeof fetch;
  try {
    resetSettingUploads();
    for (const size of ['22', '24', '26']) {
      store[SETTING_TO_LS.font_size] = size;
      queueSettingUpload(SETTING_TO_LS.font_size, true);
    }
    await new Promise((resolve) => setTimeout(resolve, 450));
    assert.equal(calls.length, 1, 'dragging the slider must not send a request per step');
    assert.deepEqual(calls[0], { font_size: '26' });

    // Sync off and logged out never queue an upload.
    store['jplrc-sync-settings'] = 'false';
    queueSettingUpload(SETTING_TO_LS.font_size, true);
    queueSettingUpload(SETTING_TO_LS.font_size, false);
    await flushSettingUploads();
    assert.equal(calls.length, 1);
  } finally {
    resetSettingUploads();
    globalThis.fetch = previousFetch;
    Object.defineProperty(globalThis, 'window', { value: previousWindow, configurable: true });
    Object.defineProperty(globalThis, 'localStorage', { value: previousStorage, configurable: true });
  }
});
