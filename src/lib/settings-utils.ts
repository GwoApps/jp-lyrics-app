/**
 * Client-safe helpers for personal settings.
 *
 * This module must stay free of any server-only imports (no `./db`) so the
 * `/settings` page (a client component) can import it in the browser bundle.
 * The server-side `./user-settings` module re-exports these so both sides
 * share one source of truth for value normalization.
 */

import { isKnownTargetLang } from './target-lang.ts';

/** Upper bound on any single setting value length (covers every existing key). */
export const MAX_SETTING_VALUE_LENGTH = 32;

/** Language-independent error codes for invalid setting values (HTTP 400). */
export type SettingValidationError =
  | 'invalid_theme'
  | 'invalid_locale'
  | 'invalid_font_size'
  | 'invalid_reading_mode'
  | 'invalid_boolean'
  | 'invalid_target_lang'
  | 'invalid_value_length';

/**
 * Validate a single setting value for the given key.
 *
 * Returns the normalized value to persist, or a language-independent error
 * code when the value is invalid. This mirrors the strength of the admin-side
 * validation so user-level overrides cannot smuggle arbitrary strings into the
 * translation prompt or bloat the `user_settings` table with oversized values.
 * Callers pass only whitelisted keys (see `USER_SETTING_KEYS`).
 */
export function validateSettingValue(
  key: string,
  value: string,
): { ok: true; value: string } | { ok: false; error: SettingValidationError } {
  if (value.length > MAX_SETTING_VALUE_LENGTH) {
    return { ok: false, error: 'invalid_value_length' };
  }
  switch (key) {
    case 'theme':
      return value === 'dark' || value === 'light'
        ? { ok: true, value }
        : { ok: false, error: 'invalid_theme' };
    case 'locale':
      return ['ja', 'en', 'zh-CN', 'zh-TW'].includes(value)
        ? { ok: true, value }
        : { ok: false, error: 'invalid_locale' };
    case 'font_size': {
      const n = parseInt(value, 10);
      if (Number.isNaN(n)) return { ok: false, error: 'invalid_font_size' };
      return { ok: true, value: String(Math.min(32, Math.max(14, n))) };
    }
    case 'reading_mode':
      return value === 'original' || value === 'furigana'
        ? { ok: true, value }
        : { ok: false, error: 'invalid_reading_mode' };
    case 'romanize_furigana':
    case 'show_translation':
    case 'follow_playing':
    case 'sync_settings':
      return value === 'true' || value === 'false'
        ? { ok: true, value }
        : { ok: false, error: 'invalid_boolean' };
    case 'translation_target_lang':
      // Empty string clears the override (fall back to the admin/global default).
      if (value.trim() === '') return { ok: true, value: '' };
      return isKnownTargetLang(value)
        ? { ok: true, value }
        : { ok: false, error: 'invalid_target_lang' };
    default:
      return { ok: false, error: 'invalid_value_length' };
  }
}

export function normalizeTheme(v: string | undefined): 'dark' | 'light' {
  return v === 'light' ? 'light' : 'dark';
}

export function normalizeReadingMode(v: string | undefined): 'original' | 'furigana' {
  return v === 'original' ? 'original' : 'furigana';
}

export function normalizeBoolean(v: string | undefined): boolean {
  return v === 'true';
}

export function normalizeFontSize(v: string | undefined): number {
  if (!v) return 20;
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return 20;
  return Math.min(32, Math.max(14, n));
}

export function normalizeLocale(v: string | undefined): string {
  const locales = ['ja', 'en', 'zh-CN', 'zh-TW'];
  return v && locales.includes(v) ? v : 'zh-CN';
}
