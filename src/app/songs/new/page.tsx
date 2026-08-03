'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import SongForm from '@/components/SongForm';
import { useI18n } from '@/lib/i18n';
import { readSongPrefill } from '@/lib/song-prefill';

export default function NewSongPage() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const [prefill] = useState(() => readSongPrefill(searchParams));

  const handleSave = async (body: Record<string, string | boolean>) => {
    const res = await fetch('/api/songs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(t('new.saveFailed'));
    return res.json() as Promise<{ id: string }>;
  };

  return (
    <div className="fade-in max-w-2xl">
      {/* Breadcrumb */}
      <div className="mb-6 sm:mb-8 flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
        <Link href="/" className="hover:text-[var(--foreground)] transition-colors">{t('common.list')}</Link>
        <span className="opacity-40">/</span>
        <span className="text-[var(--foreground)]">{t('new.newBreadcrumb')}</span>
      </div>

      <h1 className="text-lg font-semibold tracking-tight mb-6 sm:mb-8">{t('new.title')}</h1>

      <SongForm
        ns="new"
        mode="create"
        initialTitle={prefill.title}
        initialArtist={prefill.artist}
        initialReadingSchemeConfirmed={false}
        canManageCover
        showLinkcore
        showCantonesePlaceholders
        spotifyTrackId={prefill.spotifyTrackId}
        onSave={handleSave}
        cancelHref="/"
        saveLabel={t('new.saveAndView')}
      />
    </div>
  );
}
