'use client';

import { useEffect } from 'react';
import { RefreshCw, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useI18n } from '@/lib/i18n';

/**
 * Segment-level error boundary. Unlike `global-error.tsx` this renders inside
 * the root layout, so the AppShell (topbar + navigation) stays mounted and only
 * the failing segment is replaced — the user keeps their way back.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useI18n();

  useEffect(() => {
    console.error('[route error]', error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <TriangleAlert className="mb-4 h-10 w-10 text-[var(--destructive)] opacity-60" />
      <h1 className="text-lg font-semibold tracking-tight">{t('common.errorTitle')}</h1>
      <p className="mt-2 max-w-md text-sm text-[var(--muted-foreground)]">{t('common.errorBody')}</p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-4 py-2 text-xs font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90"
        >
          <RefreshCw className="h-3.5 w-3.5" /> {t('common.reload')}
        </button>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 py-2 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
        >
          {t('common.backHome')}
        </Link>
      </div>
    </div>
  );
}
