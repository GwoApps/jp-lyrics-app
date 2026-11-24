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

/**
 * The title this route must show, or `null` when the server already rendered a
 * route-specific one (song pages) and it must not be touched.
 *
 * `/artists/<name>` derives the artist from the pathname instead of parsing
 * `document.title`: during a client-side navigation `document.title` still holds
 * the previous page's title, so parsing it dropped the site name and could carry
 * the wrong first segment over (issue #491).
 */
function localizedTitle(pathname: string | null, appName: string, t: (key: string) => string): string | null {
  const path = pathname?.replace(/\/+$/, '') || '/';
  if (path in STATIC_TITLE_KEYS) return t(STATIC_TITLE_KEYS[path]);
  const detail = path.match(/^\/artists\/([^/]+)$/);
  if (detail) {
    let artist = detail[1];
    try {
      artist = decodeURIComponent(artist);
    } catch {
      // Malformed percent-escape: keep the raw path segment.
    }
    artist = artist.trim();
    return artist ? `${artist} · ${appName}` : t('artists.title');
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
 *
 * Every write is gated on the value actually differing. Assigning the same
 * title still replaces the `<title>` text node, so an unconditional write here
 * re-enters this observer and writes forever — a self-triggering loop that pins
 * the main thread and freezes the page. It fired on every route whose server
 * title is the neutral `APP_NAME_NEUTRAL` (`/`, `/settings`) and on every route
 * with a `STATIC_TITLE_KEYS` entry (`/albums`, `/artists`).
 */
export default function AppMetadataSync() {
  const { t } = useI18n();
  const pathname = usePathname();

  useEffect(() => {
    const name = t('common.appName');
    const routeTitle = localizedTitle(pathname, name, t);
    const generic = new Set([name, APP_NAME_NEUTRAL]);
    const apply = () => {
      // A route-specific title wins; a neutral one becomes the localized app
      // name; a title the route rendered itself (song pages) is left alone.
      const next = routeTitle ?? (generic.has(document.title.trim()) ? name : null);
      if (next && document.title !== next) document.title = next;
      const meta = document.querySelector('meta[name="apple-mobile-web-app-title"]');
      if (meta && meta.getAttribute('content') !== name) meta.setAttribute('content', name);
    };
    apply();
    // Next.js flushes the layout metadata after hydration and again on every
    // client-side navigation, re-inserting its own `<title>`; a plain
    // assignment would be overwritten by that flush. `characterData` need not be
    // observed: rewriting the title replaces the `<title>` text node, which is
    // already a childList mutation inside `document.head`.
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [t, pathname]);

  return null;
}
