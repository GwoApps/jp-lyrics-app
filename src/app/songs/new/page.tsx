'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n';

export default function NewSongPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [lyrics, setLyrics] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  const showToast = (type: 'success' | 'error', msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3000);
  };

  const handleSave = async () => {
    if (!title.trim()) {
      showToast('error', t('new.titleRequired'));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/songs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          artist: artist.trim(),
          lyrics_raw: lyrics,
        }),
      });
      if (!res.ok) throw new Error(t('new.saveFailed'));
      const song = await res.json();
      showToast('success', t('new.saved'));
      setTimeout(() => router.push(`/songs/${song.id}`), 800);
    } catch (e: unknown) {
      showToast('error', e instanceof Error ? e.message : t('new.error'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fade-in max-w-2xl">
      {/* Breadcrumb */}
      <div className="mb-6 sm:mb-8 flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
        <a href="/" className="hover:text-[var(--foreground)] transition-colors">{t('common.list')}</a>
        <span className="opacity-40">/</span>
        <span className="text-[var(--foreground)]">{t('new.newBreadcrumb')}</span>
      </div>

      <h1 className="text-lg font-semibold tracking-tight mb-6 sm:mb-8">{t('new.title')}</h1>

      <div className="space-y-5 sm:space-y-6">
        {/* Title */}
        <div>
          <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-2">
            {t('new.songTitle')}
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('new.titlePlaceholder')}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--input)] px-3 sm:px-4 py-2.5 text-sm outline-none focus:border-[var(--primary)] transition-colors placeholder:text-[var(--muted-foreground)]/50"
          />
        </div>

        {/* Artist */}
        <div>
          <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-2">
            {t('new.artist')}
          </label>
          <input
            type="text"
            value={artist}
            onChange={(e) => setArtist(e.target.value)}
            placeholder={t('new.artistPlaceholder')}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--input)] px-3 sm:px-4 py-2.5 text-sm outline-none focus:border-[var(--primary)] transition-colors placeholder:text-[var(--muted-foreground)]/50"
          />
        </div>

        {/* Lyrics */}
        <div>
          <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-2">
            {t('new.lyrics')}
            <span className="ml-2 font-normal">{t('new.lyricsHint')}</span>
          </label>
          <textarea
            value={lyrics}
            onChange={(e) => setLyrics(e.target.value)}
            placeholder={t('new.lyricsPlaceholder')}
            rows={12}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--input)] px-3 sm:px-4 py-3 text-sm outline-none focus:border-[var(--primary)] transition-colors placeholder:text-[var(--muted-foreground)]/50 resize-y leading-relaxed"
          />
          <p className="mt-2 text-[11px] text-[var(--muted-foreground)]">
            {t('new.furiganaHint')}
          </p>
        </div>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 pt-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-md bg-[var(--primary)] px-5 py-2.5 text-sm font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving ? t('new.converting') : t('new.saveAndView')}
          </button>
          <button
            onClick={() => router.push('/')}
            className="rounded-md px-5 py-2.5 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
          >
            {t('common.cancel')}
          </button>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`toast toast-${toast.type}`}>{toast.msg}</div>
      )}
    </div>
  );
}
