'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useI18n } from '@/lib/i18n';

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
    const apply = () => {
      if (document.title !== name) document.title = name;
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
