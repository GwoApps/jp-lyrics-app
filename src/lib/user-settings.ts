/**
 * Per-user personal settings (non-admin preferences).
 *
 * These are the user-level counterparts of preferences that previously lived
 * only in browser localStorage (`jplrc-*` keys) plus the per-user translation
 * target-language override. They are stored server-side in the `user_settings`
 * table so they survive device switches / cache clears / incognito windows.
 *
 * Reading precedence: user setting > admin/global config > built-in default.
 * Unauthenticated users keep their existing localStorage-only behaviour.
 */
import { eq } from 'drizzle-orm';
import { getDB, schema } from './db';

// Client-safe value normalizers shared with the /settings page.
export { normalizeTheme, normalizeReadingMode, normalizeBoolean, normalizeFontSize, normalizeLocale } from './settings-utils';
export { MAX_SETTING_VALUE_LENGTH, validateSettingValue, type SettingValidationError } from './settings-utils';

export type SettingKey =
  | 'theme'                   // 'dark' | 'light'
  | 'locale'                  // 'ja' | 'en' | 'zh-CN' | 'zh-TW'
  | 'font_size'               // number (px), clamped [14, 32]
  | 'reading_mode'            // 'original' | 'furigana'
  | 'romanize_furigana'       // boolean
  | 'show_translation'        // boolean
  | 'follow_playing'          // boolean
  | 'translation_target_lang' // BCP-47 tag, e.g. 'zh-CN' | 'en-US'
  | 'sync_settings'           // boolean — master switch for cross-device sync

export const USER_SETTING_KEYS: readonly SettingKey[] = [
  'theme',
  'locale',
  'font_size',
  'reading_mode',
  'romanize_furigana',
  'show_translation',
  'follow_playing',
  'translation_target_lang',
  'sync_settings',
];

/** The shape the /api/me/settings API returns. */
export type UserSettingsMap = Partial<Record<SettingKey, string>>;

function isSettingKey(key: string): key is SettingKey {
  return (USER_SETTING_KEYS as readonly string[]).includes(key);
}

/** Load all settings for a user as a { key: value } map. */
export async function getUserSettings(userId: string): Promise<UserSettingsMap> {
  const db = getDB();
  const rows = await db.select({
    key: schema.userSettings.key,
    value: schema.userSettings.value,
  })
    .from(schema.userSettings)
    .where(eq(schema.userSettings.userId, userId))
    .all();
  const result: UserSettingsMap = {};
  for (const row of rows) {
    const key = row.key as string;
    if (isSettingKey(key)) result[key] = row.value;
  }
  return result;
}

/**
 * Upsert one or more settings for a user. Only whitelisted keys are accepted.
 * Returns the updated full settings map.
 */
export async function setUserSettings(
  userId: string,
  patch: UserSettingsMap,
): Promise<UserSettingsMap> {
  const db = getDB();
  const entries = Object.entries(patch) as [SettingKey, string][];
  for (const [key, value] of entries) {
    if (!isSettingKey(key)) continue;
    await db.insert(schema.userSettings)
      .values({ userId, key, value: String(value) })
      .onConflictDoUpdate({
        target: [schema.userSettings.userId, schema.userSettings.key],
        set: { value: String(value) },
      });
  }
  return getUserSettings(userId);
}

/**
 * Read the user's translation target-language override, or null when unset.
 * Callers fall back to the admin/global `targetLang` when null.
 */
export function userTranslationTargetLang(settings: UserSettingsMap): string | null {
  const raw = settings.translation_target_lang;
  return raw && raw.trim() ? raw.trim() : null;
}

/**
 * Merge a user's effective target-language into the resolved translation config.
 * User override wins when set; otherwise the admin/global value is kept.
 */
export function applyUserTargetLang(
  config: { targetLang: string },
  settings: UserSettingsMap,
): string {
  return userTranslationTargetLang(settings) ?? config.targetLang;
}
