'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useI18n } from '@/lib/i18n';
import { APP_NAME_NEUTRAL } from '@/lib/app-identity';

/** Titles that used to be hard-coded in per-route metadata; now localized here. */
const STATIC_TITLE_KEYS: Record<string, string> = {
  '/albums': 'home.albumList',
  '/artists': 'artists.title',
};

function localizedTitle(pathname: string | null, t: (key: string) => string): string | null {
  const path = pathname?.replace(/\/+$/, '') || '/';
  if (path in STATIC_TITLE_KEYS) return t(STATIC_TITLE_KEYS[path]);
  // `/artists/<name>` keeps the artist name from its static server title; only
  // the missing-name fallback was Japanese and needs a localized replacement.
  const detail = path.match(/^\/artists\/([^/]+)$/);
  if (detail) {
    const title = document.title.trim().split(' · ')[0];
    return title && title !== 'アーティスト' ? title : t('artists.title');
  }
  return null;
}

/**
 * Keeps the document title and the iOS home-screen name in the reader's UI
 * language. The root layout ships a language-neutral `metadata` because the
 * server cannot know the locale chosen in `localStorage`; once the app
 * hydrates, `common.appName` is authoritative (issue #273).
 *
 * The `description` meta stays as the static English copy in the layout: it is
 * read by crawlers before hydration, where a one-line product description
 * beats a two-word UI label.
 */
export default function AppMetadataSync() {
  const { t } = useI18n();
  const pathname = usePathname();

  useEffect(() => {
    const name = t('common.appName');
    const localTitle = localizedTitle(pathname, t);
    const generic = new Set([name, APP_NAME_NEUTRAL]);
    const apply = () => {
      // Next.js may have flushed a static page title; the localized one wins.
      if (localTitle) {
        document.title = localTitle;
      } else if (generic.has(document.title.trim())) {
        document.title = name;
      }
      document
        .querySelector('meta[name="apple-mobile-web-app-title"]')
        ?.setAttribute('content', name);
    };
    apply();
    // Next.js flushes the layout metadata after hydration and again on every
    // client-side navigation, re-inserting its own `<title>`; a plain
    // assignment would be overwritten by that flush.
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [t, pathname]);

  return null;
}
