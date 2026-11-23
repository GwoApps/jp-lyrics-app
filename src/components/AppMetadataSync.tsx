'use client';

import { useEffect } from 'react';
import { useParams, usePathname } from 'next/navigation';
import { useI18n } from '@/lib/i18n';
import { APP_NAME_NEUTRAL, localizedDocumentTitle } from '@/lib/app-identity';

/** Titles that used to be hard-coded in per-route metadata; now localized here. */
const STATIC_TITLE_KEYS: Record<string, string> = {
  '/albums': 'home.albumList',
  '/artists': 'artists.title',
};

function localizedTitle(
  pathname: string | null,
  nameSegment: string | string[] | undefined,
  t: (key: string) => string,
): string | null {
  const path = pathname?.replace(/\/+$/, '') || '/';
  const appName = t('common.appName');
  if (path in STATIC_TITLE_KEYS) return localizedDocumentTitle(t(STATIC_TITLE_KEYS[path]), appName);
  // `/artists/<name>` uses the route segment rather than `document.title`: a
  // client navigation may still carry the previous page's title when this runs.
  const detail = path.match(/^\/artists\/([^/]+)$/);
  if (detail) {
    const raw = Array.isArray(nameSegment) ? nameSegment[0] : nameSegment;
    let artist: string | null = null;
    if (raw) {
      try {
        artist = decodeURIComponent(raw).trim() || null;
      } catch {
        artist = raw.trim() || null;
      }
    }
    return localizedDocumentTitle(artist ?? t('artists.title'), appName);
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
  const params = useParams<{ name?: string }>();

  useEffect(() => {
    const name = t('common.appName');
    const localTitle = localizedTitle(pathname, params?.name, t);
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
  }, [t, pathname, params?.name]);

  return null;
}
