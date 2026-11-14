'use client';

import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import ja from '@/i18n/ja.json';
import en from '@/i18n/en.json';
import zhCN from '@/i18n/zh-CN.json';
import zhTW from '@/i18n/zh-TW.json';
import {
  DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, LOCALE_STORAGE_KEY, localeCookieAttributes,
  localeToBCP47, type Locale,
} from './locale';

export { LOCALE_META, localeToBCP47 } from './locale';
export type { Locale } from './locale';

const DICTIONARIES: Record<Locale, Record<string, Record<string, string>>> = {
  ja, en, 'zh-CN': zhCN, 'zh-TW': zhTW,
};

type I18nContextValue = {
  locale: Locale;
  bcp47: string;
  setLocale: (l: Locale) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
};

/**
 * The context default is the reference locale, so an out-of-provider `useI18n`
 * (error boundaries, isolated unit renders) still yields readable text.
 */
const I18nContext = createContext<I18nContextValue>({
  locale: DEFAULT_LOCALE,
  bcp47: localeToBCP47(DEFAULT_LOCALE),
  setLocale: () => {},
  t: (k) => k,
});

/** Nothing ever changes, so React re-reads the snapshot once, after hydration. */
const subscribeHydrated = () => () => {};

/** Keys already reported as missing, so a re-render does not spam the console. */
const warnedMissingKeys = new Set<string>();

function readStoredLocale(): Locale | null {
  try {
    const saved = localStorage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(saved) ? saved : null;
  } catch {
    // Private mode / blocked storage: the server-resolved locale stands.
    return null;
  }
}

/**
 * Mirror the choice into both stores. The cookie is what lets the *server*
 * render in this language on the next request — without it the whole tree had
 * to wait for hydration, which is what made every cold start blank (issue #419).
 */
function persistLocale(locale: Locale) {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Storage may be unavailable; the cookie below still carries the choice.
  }
  document.cookie = `${LOCALE_COOKIE}=${locale}; ${localeCookieAttributes()}`;
}

export function I18nProvider({
  children,
  initialLocale = DEFAULT_LOCALE,
}: {
  children: ReactNode;
  /** Locale the server rendered with, resolved from the cookie / Accept-Language. */
  initialLocale?: Locale;
}) {
  const [switched, setSwitched] = useState<Locale | null>(null);
  // `false` in the server render *and* in the hydration render, so both produce
  // the locale the server resolved. Only afterwards may `localStorage` — the one
  // store the server cannot see — contribute a newer choice.
  const hydrated = useSyncExternalStore(subscribeHydrated, () => true, () => false);
  const locale = switched ?? (hydrated ? readStoredLocale() ?? initialLocale : initialLocale);

  // Keep <html lang> in sync with the active locale, including on an in-app
  // switch, so screen readers and language tools announce the UI in the right
  // language (and the locale-matched font cascade keeps applying).
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    // Write both stores back so the next request renders in this language even
    // if only one of them had it (a pre-cookie profile, or cleared cookies).
    persistLocale(locale);
  }, [locale]);

  const setLocale = useCallback((l: Locale) => {
    setSwitched(l);
  }, []);

  const t = useCallback((key: string, vars?: Record<string, string | number>): string => {
    const [ns, k] = key.split('.');
    const dict = DICTIONARIES[locale];
    let val = dict?.[ns]?.[k] ?? DICTIONARIES[DEFAULT_LOCALE][ns]?.[k] ?? key;
    // Falling back to the key itself means no dictionary has this entry, so the
    // UI is about to render an internal identifier. Dev builds shout about it;
    // `validate:i18n` is the CI-side counterpart that catches it before merge.
    if (val === key && process.env.NODE_ENV !== 'production' && !warnedMissingKeys.has(key)) {
      warnedMissingKeys.add(key);
      console.warn(`[i18n] missing translation key "${key}" — rendered as-is`);
    }
    if (vars) {
      for (const [rk, rv] of Object.entries(vars)) {
        val = val.replace(`{${rk}}`, String(rv));
      }
    }
    return val;
  }, [locale]);

  return <I18nContext.Provider value={{ locale, bcp47: localeToBCP47(locale), setLocale, t }}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
