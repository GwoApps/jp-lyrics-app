/**
 * Client-safe helpers for the translation target language.
 *
 * The effective target language for a translation request resolves as
 *   user setting (`translation_target_lang`) > admin/global config > default.
 * These helpers centralize the preset options and the human-readable display
 * labels so the song-page entry can show exactly what language the next
 * translation will produce (issue #123).
 */

/** Common target-language presets, aligned with the admin config combobox. */
export const TARGET_LANG_PRESETS = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'zh-TW', label: '繁體中文' },
  { value: 'zh-HK', label: '繁體中文（香港）' },
  { value: 'en-US', label: 'English' },
] as const;

export type TargetLangValue = (typeof TARGET_LANG_PRESETS)[number]['value'];

/** Is the given code one of the known presets? */
export function isKnownTargetLang(code: string | null | undefined): code is TargetLangValue {
  return !!code && TARGET_LANG_PRESETS.some((p) => p.value === code);
}

/** Display name for a known preset, otherwise the raw code (custom values). */
export function targetLangDisplay(code: string | null | undefined): string {
  if (!code) return '';
  const preset = TARGET_LANG_PRESETS.find((p) => p.value === code);
  return preset ? preset.label : code;
}
