/**
 * Client-side helpers for the cross-device sync master switch and for pulling
 * server-persisted settings into localStorage as a first-screen fast path.
 *
 * This module is client-only (guarded by `typeof window`) and shared by the
 * settings page and the AppShell bootstrap so both stay consistent about
 * which keys exist, when sync is enabled, and how a server payload is applied.
 */
'use client';

import { normalizeTheme, normalizeLocale } from './settings-utils';
import type { Locale } from './i18n';

/** LocalStorage key backing the cross-device sync master switch. */
export const SYNC_SETTINGS_LS_KEY = 'jplrc-sync-settings';

/** setting key → localStorage key, for writing a server payload into the fast path. */
export const SETTING_TO_LS: Record<string, string> = {
  theme: 'jplrc-theme',
  locale: 'jplrc-locale',
  font_size: 'jplrc-font-size',
  reading_mode: 'jplrc-reading-mode',
  romanize_furigana: 'jplrc-romanize-furigana',
  show_translation: 'jplrc-show-translation',
  follow_playing: 'jplrc-follow-playing',
  translation_target_lang: 'jplrc-translation-target-lang',
  sync_settings: SYNC_SETTINGS_LS_KEY,
};

/**
 * The preference keys governed by the `sync_settings` master switch. The switch
 * itself is always uploaded (so it survives a device change); these keys are only
 * uploaded when sync is enabled.
 */
export const SYNCABLE_KEYS: readonly (keyof typeof SETTING_TO_LS)[] = [
  'theme',
  'locale',
  'font_size',
  'reading_mode',
  'romanize_furigana',
  'show_translation',
  'follow_playing',
  'translation_target_lang',
];

/** A server-persisted settings payload (values are strings). */
export type SettingsPayload = Record<string, string | undefined>;

/**
 * Whether cross-device sync is currently enabled, read from localStorage.
 * Defaults to ON to preserve the existing always-sync behaviour for users who
 * have never touched the switch.
 */
export function isSyncEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  return localStorage.getItem(SYNC_SETTINGS_LS_KEY) !== 'false';
}

/** Set the master switch in localStorage (immediate effect). */
export function setSyncEnabled(enabled: boolean) {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(SYNC_SETTINGS_LS_KEY, String(enabled)); } catch {}
}

/** Write a settings map into the corresponding localStorage keys. */
export function syncSettingsToLocalStorage(settings: SettingsPayload) {
  if (typeof window === 'undefined') return;
  for (const [key, value] of Object.entries(settings)) {
    const lsKey = SETTING_TO_LS[key];
    if (!lsKey || value === undefined) continue;
    try { localStorage.setItem(lsKey, value); } catch {}
  }
}

/**
 * Apply theme + locale immediately from a settings payload so a just-fetched
 * server value is reflected without a reload. Theme needs the ThemeProvider's
 * setTheme; locale needs the I18n setLocale. No-ops when not passed (the
 * localStorage fast path alone is enough for page reloads).
 */
export function applyLiveSettings(
  settings: SettingsPayload,
  apply: { setTheme?: (t: 'dark' | 'light') => void; setLocale?: (l: Locale) => void },
) {
  if (typeof window === 'undefined') return;
  // Only apply a value when the server actually provided one, so an unset
  // preference never overwrites the user's existing browser/system default.
  if (settings.theme !== undefined) {
    apply.setTheme?.(normalizeTheme(settings.theme));
  }
  if (settings.locale !== undefined) {
    apply.setLocale?.(normalizeLocale(settings.locale) as Locale);
  }
}

/**
 * Fetch the server-persisted settings once for the current user and sync them
 * into localStorage, optionally applying theme/locale live. Used on app boot so
 * new devices / fresh sessions render with the saved preferences immediately.
 *
 * Returns the settings payload, or null on failure / when sync is disabled.
 */
export async function fetchAndSyncSettings(
  apply?: { setTheme?: (t: 'dark' | 'light') => void; setLocale?: (l: Locale) => void },
): Promise<SettingsPayload | null> {
  if (typeof window === 'undefined') return null;
  if (!isSyncEnabled()) return null;
  try {
    const res = await fetch('/api/me/settings', { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    const settings: SettingsPayload = data?.settings ?? {};
    syncSettingsToLocalStorage(settings);
    applyLiveSettings(settings, apply ?? {});
    return settings;
  } catch {
    return null;
  }
}
