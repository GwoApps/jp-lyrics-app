/**
 * Single source of truth for the app's language → font-family contract.
 *
 * The cascade in `globals.css` (issue #274) gives every language its own CJK
 * family so glyph shapes match the text instead of everything falling back to
 * Noto Sans JP (which draws Japanese variants of 直/骨/次/令/真 … for Chinese).
 * DOM text gets that for free from `html[lang=…]` / `[lang=…]`, but surfaces
 * that cannot inherit CSS — the share-card canvas (issue #336), and any future
 * offscreen renderer — must name the family explicitly.
 *
 * The constants here mirror the family lists in `globals.css`; keep them in
 * sync (the ordering of {@link FONT_STACKS} is preserved by the tests).
 * `lyrics-export.ts` intentionally keeps its self-contained offline stacks: its
 * HTML is opened from disk without web fonts, so it leans on locally installed
 * families instead of the Google Fonts loaded by `layout.tsx`.
 */

/** Family list shared by Latin/reading text, matching `globals.css` `[lang="en"]`. */
export const LATIN_FONT_STACK = "'Inter', 'Noto Sans JP', sans-serif";

/** Simplified Chinese (`zh`, `zh-CN`, `zh-SG`, …). */
export const SIMPLIFIED_CHINESE_FONT_STACK =
  "'Inter', 'Noto Sans SC', 'Source Han Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif";

/** Traditional Chinese (Taiwan) — `zh-TW`, `zh-Hant`, … */
export const TRADITIONAL_CHINESE_FONT_STACK =
  "'Inter', 'Noto Sans TC', 'Source Han Sans TC', 'PingFang TC', 'Microsoft JhengHei', sans-serif";

/** Hong Kong Traditional Chinese — `zh-HK`, `zh-Hant-HK`, `yue-Hant`, … */
export const HONG_KONG_FONT_STACK =
  "'Inter', 'Noto Sans TC', 'Source Han Sans TC', 'PingFang HK', 'Microsoft JhengHei', sans-serif";

/**
 * Fallback for every other language, mirrored from the historical
 * `body { font-family }` default: Japanese leads, Simplified Chinese backs it up
 * so Chinese text never falls through to a Japanese-only system default.
 */
export const DEFAULT_FONT_STACK = "'Inter', 'Noto Sans JP', 'Noto Sans SC', sans-serif";

/** Ordered `[matcher, stack]` table; the first matching entry wins. */
export const FONT_STACKS: ReadonlyArray<readonly [RegExp, string]> = [
  // Traditional Chinese variants must be tested before the broad `zh` rule,
  // mirroring the source order in `globals.css` where they win the cascade.
  [/^zh-(tw|hk|hant)\b/, TRADITIONAL_CHINESE_FONT_STACK],
  [/^yue\b/, TRADITIONAL_CHINESE_FONT_STACK],
  [/^zh\b/, SIMPLIFIED_CHINESE_FONT_STACK],
  [/^ja\b/, DEFAULT_FONT_STACK],
  [/^en\b/, LATIN_FONT_STACK],
  // Latin readings (romaji / jyutping) stay in Inter even inside CJK text.
  [/^yue-latn\b/, LATIN_FONT_STACK],
];

/**
 * Font stack for a BCP-47 language tag (`ja`, `zh-CN`, `zh-Hant`, `yue-Hant`, …).
 * Unknown, blank or malformed tags get {@link DEFAULT_FONT_STACK}, so a caller
 * can never end up with an empty or `undefined` family in `ctx.font`.
 */
export function fontStackForLang(languageTag: string | null | undefined): string {
  const tag = languageTag?.trim().toLowerCase();
  if (!tag) return DEFAULT_FONT_STACK;
  for (const [matcher, stack] of FONT_STACKS) {
    if (matcher.test(tag)) return stack;
  }
  return DEFAULT_FONT_STACK;
}

/**
 * Build a canvas `ctx.font` value (`` `bold 52px <family list>` ``) whose family
 * list follows the text language. Every stack ends in the `sans-serif` generic
 * family, so the value is always a valid canvas font even before webfonts load.
 */
export function canvasFont(fontTag: string | null | undefined, size: number | string, weight = ''): string {
  const prefix = weight ? `${weight} ` : '';
  return `${prefix}${size}px ${fontStackForLang(fontTag)}`;
}
