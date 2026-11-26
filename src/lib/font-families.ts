/**
 * Which Google Fonts families a page actually needs (issue #466).
 *
 * A song page can show several languages at once (Japanese source, Chinese
 * translation, Latin readings, UI chrome), so the loaded families are the
 * *union* of every signal — not just the UI locale. Everything else falls back
 * to system fonts through the stacks in `globals.css`.
 *
 * Keep this module free of React and `window`: the server shell calls it for the
 * initial stylesheet, the client calls it again after the song loads to top up
 * families the server could not know yet.
 */

export type GoogleFontFamily = 'latin' | 'jp' | 'sc' | 'tc';

/** Request order: stable for tests and for Google Fonts' cache key. */
export const ALL_FONT_FAMILIES: readonly GoogleFontFamily[] = ['latin', 'jp', 'sc', 'tc'];

/** The Google Fonts `family=` query parameter for one family. */
const GOOGLE_FAMILY_QUERY: Record<GoogleFontFamily, string> = {
  latin: 'Inter:wght@400;500;600;700',
  jp: 'Noto+Sans+JP:wght@400;500;700',
  sc: 'Noto+Sans+SC:wght@400;500;700',
  tc: 'Noto+Sans+TC:wght@400;500;700',
};

/** BCP-47 tags → family needed to render them, following `globals.css`. */
export function fontFamiliesForTags(tags: Iterable<string | null | undefined>): Set<GoogleFontFamily> {
  const families = new Set<GoogleFontFamily>();
  for (const tag of tags) {
    const normalized = tag?.trim().toLowerCase();
    if (!normalized) continue;
    if (normalized.startsWith('en') || normalized.startsWith('yue-latn')) {
      families.add('latin');
    } else if (normalized.startsWith('ja')) {
      families.add('jp');
    } else if (/^zh-(tw|hk|hant)\b/.test(normalized) || normalized.startsWith('yue')) {
      families.add('tc');
    } else if (normalized.startsWith('zh')) {
      families.add('sc');
    }
  }
  return families;
}

/**
 * UI locale (`ja` / `en` / `zh-CN` / `zh-TW`) → families it needs.
 * Every stack in `globals.css` leads with Inter, so Latin is always included.
 */
export function fontFamiliesForLocale(locale: string): Set<GoogleFontFamily> {
  return fontFamiliesForTags(['en', locale]);
}

/** Google Fonts stylesheet URL for exactly the requested families. */
export function googleFontsHref(families: Iterable<GoogleFontFamily>): string {
  const selected = ALL_FONT_FAMILIES.filter((family) => {
    for (const item of families) if (item === family) return true;
    return false;
  });
  if (selected.length === 0) return '';
  const query = selected.map((family) => `family=${GOOGLE_FAMILY_QUERY[family]}`).join('&');
  return `https://fonts.googleapis.com/css2?${query}&display=swap`;
}
