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

/** Language tag used to render translation text when none is stored. */
export const DEFAULT_TRANSLATION_LANG = 'zh-CN';

/** `ja` / `zh-CN` / `zh-Hant` / `en-US` …: a 2-3 letter language plus 1-8 char subtags. */
const LANGUAGE_TAG_RE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/;

/**
 * Normalize a stored `songs.lyrics_translation_lang` into a tag that is safe to
 * put on an HTML `lang` attribute, with canonical BCP-47 casing
 * (`zh-cn` → `zh-CN`, `ZH-hant-tw` → `zh-Hant-TW`).
 *
 * Blank or malformed values (rows written before the column existed, values
 * hand-edited in the DB) fall back to {@link DEFAULT_TRANSLATION_LANG} instead
 * of leaking arbitrary text into markup.
 *
 * Every surface that renders translation text uses this: the detail page lyric
 * list (`FuriganaLine`), the share page and the HTML export (issue #274). The
 * tag drives both screen-reader pronunciation and CJK font selection
 * (`globals.css` re-fonts `[lang^="zh"]` … for element-level `lang`s, and
 * `html[lang^="zh"]` … for the UI language carried by `<html lang>`).
 */
export function resolveTranslationLang(code: string | null | undefined): string {
  const raw = code?.trim();
  if (!raw || !LANGUAGE_TAG_RE.test(raw)) return DEFAULT_TRANSLATION_LANG;
  const [language, ...subtags] = raw.split('-');
  return [
    language.toLowerCase(),
    ...subtags.map((subtag) => {
      // Script subtags are 4 letters (`Hant`), regions are 2 letters or 3
      // digits (`TW`, `419`); anything else (variants) stays lowercase.
      if (subtag.length === 4) return subtag[0].toUpperCase() + subtag.slice(1).toLowerCase();
      if (subtag.length === 2 || /^\d{3}$/.test(subtag)) return subtag.toUpperCase();
      return subtag.toLowerCase();
    }),
  ].join('-');
}
