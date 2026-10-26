'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import './globals.css';
import ja from '@/i18n/ja.json';
import en from '@/i18n/en.json';
import zhCN from '@/i18n/zh-CN.json';
import zhTW from '@/i18n/zh-TW.json';

type Dict = Record<string, Record<string, string>>;

const DICTS: Record<string, Dict> = { ja, en, 'zh-CN': zhCN, 'zh-TW': zhTW };
const DEFAULT_LOCALE = 'zh-CN';

/**
 * Last-resort boundary: it replaces the root layout, so no provider, no
 * `AppShell` and none of the root layout's theme bootstrap are available.
 * Everything it needs — `<html>`/`<body>`, the theme attributes, the locale
 * dictionaries and the stylesheet — is therefore supplied here.
 *
 * Locale resolution mirrors `@/lib/i18n` `detectLocale`; it is duplicated
 * instead of imported so this page still renders when the module that threw is
 * the i18n layer itself.
 */
function detectLocale(): string {
  if (typeof window === 'undefined') return DEFAULT_LOCALE;
  try {
    const saved = localStorage.getItem('jplrc-locale');
    if (saved && saved in DICTS) return saved;
  } catch {
    // localStorage can be unavailable (private mode / blocked storage).
  }
  const nav = navigator.language || '';
  if (nav.startsWith('zh')) {
    return nav.includes('TW') || nav.includes('HK') || nav.includes('Hant') ? 'zh-TW' : 'zh-CN';
  }
  if (nav.startsWith('en')) return 'en';
  if (nav.startsWith('ja')) return 'ja';
  return DEFAULT_LOCALE;
}

// Same bootstrap as the root layout: applying the theme before first paint
// keeps this page from flashing the wrong background on dark-mode devices.
const THEME_INIT_SCRIPT = `
  (function() {
    try {
      var t = localStorage.getItem('jplrc-theme');
      var dark = t === 'light' ? false : true;
      if (t !== 'light' && t !== 'dark') {
        dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      }
      document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
      var meta = document.getElementById('theme-color-meta');
      if (meta) meta.setAttribute('content', dark ? '#0a0a0a' : '#ffffff');
    } catch (e) {
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  })();
`;

const subscribeHydration = () => () => {};

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Server and first client pass use the default locale; once hydrated the
  // page adopts the user's stored/browser language (same pattern as
  // `ThemeProvider` / `I18nProvider`, which also gate on hydration).
  const [clientLocale] = useState(detectLocale);
  const hydrated = useSyncExternalStore(subscribeHydration, () => true, () => false);
  const locale = hydrated ? clientLocale : DEFAULT_LOCALE;

  useEffect(() => {
    console.error('[global error]', error);
  }, [error]);

  const t = (key: string): string => {
    const [ns, k] = key.split('.');
    return DICTS[locale]?.[ns]?.[k] ?? DICTS[DEFAULT_LOCALE][ns]?.[k] ?? key;
  };

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <meta name="theme-color" content="#0a0a0a" id="theme-color-meta" />
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <h1 className="text-lg font-semibold tracking-tight">{t('common.errorTitle')}</h1>
          <p className="mt-2 max-w-md text-sm text-[var(--muted-foreground)]">{t('common.errorBody')}</p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-4 py-2 text-xs font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90"
            >
              {t('common.reload')}
            </button>
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 py-2 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
            >
              {t('common.backHome')}
            </Link>
          </div>
        </div>
      </body>
    </html>
  );
}
