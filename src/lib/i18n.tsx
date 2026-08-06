'use client';

import { createContext, useContext, useState, useCallback, useSyncExternalStore, ReactNode } from 'react';
import ja from '@/i18n/ja.json';
import en from '@/i18n/en.json';
import zhCN from '@/i18n/zh-CN.json';
import zhTW from '@/i18n/zh-TW.json';

export type Locale = 'ja' | 'en' | 'zh-CN' | 'zh-TW';

const LOCALES: Record<Locale, Record<string, Record<string, string>>> = { ja, en, 'zh-CN': zhCN, 'zh-TW': zhTW };

export const LOCALE_META: Record<Locale, { label: string }> = {
  ja:    { label: '日本語' },
  en:    { label: 'English' },
  'zh-CN': { label: '简体中文' },
  'zh-TW': { label: '繁體中文' },
};

/** Locale → BCP-47 tag for date formatting. */
export function localeToBCP47(locale: string): string {
  const map: Record<string, string> = { ja: 'ja-JP', en: 'en-US', 'zh-CN': 'zh-CN', 'zh-TW': 'zh-TW' };
  return map[locale] ?? 'zh-CN';
}

function detectLocale(): Locale {
  if (typeof window === 'undefined') return 'zh-CN';
  const saved = localStorage.getItem('jplrc-locale') as Locale | null;
  if (saved && LOCALES[saved]) return saved;
  const nav = navigator.language;
  if (nav.startsWith('zh')) {
    if (nav.includes('TW') || nav.includes('HK') || nav.includes('Hant')) return 'zh-TW';
    return 'zh-CN';
  }
  if (nav.startsWith('en')) return 'en';
  if (nav.startsWith('ja')) return 'ja';
  return 'zh-CN';
}

type I18nContextValue = {
  locale: Locale;
  bcp47: string;
  setLocale: (l: Locale) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nContextValue>({ locale: 'zh-CN', bcp47: 'zh-CN', setLocale: () => {}, t: (k) => k });
const subscribeHydration = () => () => {};

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectLocale);
  const ready = useSyncExternalStore(subscribeHydration, () => true, () => false);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    localStorage.setItem('jplrc-locale', l);
    document.documentElement.lang = l;
  }, []);

  const t = useCallback((key: string, vars?: Record<string, string | number>): string => {
    const [ns, k] = key.split('.');
    const dict = LOCALES[locale];
    let val = dict?.[ns]?.[k] ?? LOCALES['zh-CN'][ns]?.[k] ?? key;
    if (vars) {
      for (const [rk, rv] of Object.entries(vars)) {
        val = val.replace(`{${rk}}`, String(rv));
      }
    }
    return val;
  }, [locale]);

  // Avoid hydration mismatch: render children only after locale is detected
  if (!ready) return null;

  return <I18nContext.Provider value={{ locale, bcp47: localeToBCP47(locale), setLocale, t }}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
