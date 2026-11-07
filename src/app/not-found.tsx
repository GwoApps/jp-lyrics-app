'use client';

import { FileQuestion } from 'lucide-react';
import Link from 'next/link';
import { useI18n } from '@/lib/i18n';

/**
 * Route-level 404. Renders inside the root layout, so `AppShell` (topbar,
 * theme toggle, language switcher) is still available around it.
 */
export default function NotFound() {
  const { t } = useI18n();

  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <FileQuestion className="mb-4 h-10 w-10 text-[var(--muted-foreground)] opacity-20" />
      <h1 className="text-lg font-semibold tracking-tight">{t('common.notFoundTitle')}</h1>
      <p className="mt-2 max-w-md text-sm text-[var(--muted-foreground)]">{t('common.notFoundBody')}</p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-4 py-2 text-xs font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90"
        >
          {t('common.backHome')}
        </Link>
        <Link
          href="/#songs"
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 py-2 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
        >
          {t('common.goToSongList')}
        </Link>
      </div>
    </div>
  );
}
