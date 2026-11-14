/**
 * Locale identity shared by the server and the client.
 *
 * The active locale has to be known *before* the first render, otherwise the
 * server has nothing to render: reading it from `localStorage` alone meant the
 * whole tree stayed empty until hydration finished (issue #419). So the same
 * value is mirrored into a cookie (see `LOCALE_COOKIE`), which the root layout
 * can read, and this module owns the names and normalization both sides need.
 *
 * Keep this file free of React, `window` and dictionary imports: it is imported
 * by the server layout, by the client provider and by tests.
 */

export type Locale = 'ja' | 'en' | 'zh-CN' | 'zh-TW';

/** Every locale the switcher offers, in switcher order. */
export const LOCALES: readonly Locale[] = ['ja', 'en', 'zh-CN', 'zh-TW'];

/** Locale used when nothing better is known — the dictionaries' reference language. */
export const DEFAULT_LOCALE: Locale = 'zh-CN';

/** localStorage key; also the cookie name so both stores stay in step. */
export const LOCALE_STORAGE_KEY = 'jplrc-locale';
export const LOCALE_COOKIE = 'jplrc-locale';

/** One year, in seconds — a language choice is not a session preference. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const LOCALE_META: Record<Locale, { label: string }> = {
  ja: { label: '日本語' },
  en: { label: 'English' },
  'zh-CN': { label: '简体中文' },
  'zh-TW': { label: '繁體中文' },
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** Normalize any stored/cookie/header value to a locale the app can render. */
export function asLocale(value: string | null | undefined): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

/** Locale → BCP-47 tag for date formatting. */
export function localeToBCP47(locale: string): string {
  const map: Record<string, string> = { ja: 'ja-JP', en: 'en-US', 'zh-CN': 'zh-CN', 'zh-TW': 'zh-TW' };
  return map[locale] ?? DEFAULT_LOCALE;
}

/**
 * First-visit fallback: pick a locale from the browser's `navigator.language`
 * list. A returning reader is served from the cookie/localStorage instead.
 */
export function localeFromLanguages(languages: readonly string[]): Locale {
  for (const raw of languages) {
    const tag = raw.toLowerCase();
    if (tag.startsWith('zh')) {
      return tag.includes('tw') || tag.includes('hk') || tag.includes('hant') ? 'zh-TW' : 'zh-CN';
    }
    if (tag.startsWith('ja')) return 'ja';
    if (tag.startsWith('en')) return 'en';
  }
  return DEFAULT_LOCALE;
}

/** Serialize the cookie the way the browser would send it back. */
export function localeCookieAttributes(): string {
  return `path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`;
}
