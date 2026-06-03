'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useI18n } from '@/lib/i18n';

interface SongData {
  id: string;
  title: string;
  artist: string;
  lyrics_raw: string;
}

export default function EditSongPage() {
  const router = useRouter();
  const params = useParams();
  const { t } = useI18n();
  const id = params?.id as string;
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [lyrics, setLyrics] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  const showToast = (type: 'success' | 'error', msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    if (!id) return;
    fetch(`/api/songs/${id}`)
      .then((r) => r.json())
      .then((data: SongData) => {
        setTitle(data.title);
        setArtist(data.artist);
        setLyrics(data.lyrics_raw);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [id]);

  const handleSave = async () => {
    if (!title.trim()) {
      showToast('error', t('edit.titleRequired'));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/songs/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          artist: artist.trim(),
          lyrics_raw: lyrics,
        }),
      });
      if (!res.ok) throw new Error(t('edit.saveFailed'));
      showToast('success', t('edit.saved'));
      setTimeout(() => router.push(`/songs/${id}`), 800);
    } catch (e: unknown) {
      showToast('error', e instanceof Error ? e.message : t('edit.error'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="h-5 w-5 border-2 border-[var(--muted-foreground)]/30 border-t-[var(--muted-foreground)] rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="fade-in max-w-2xl">
      {/* Breadcrumb */}
      <div className="mb-6 sm:mb-8 flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
        <a href="/" className="hover:text-[var(--foreground)] transition-colors">{t('common.list')}</a>
        <span className="opacity-40">/</span>
        <a href={`/songs/${id}`} className="hover:text-[var(--foreground)] transition-colors truncate max-w-[140px] sm:max-w-[180px]">
          {title || t('edit.songDetail')}
        </a>
        <span className="opacity-40">/</span>
        <span className="text-[var(--foreground)]">{t('edit.editBreadcrumb')}</span>
      </div>

      <h1 className="text-lg font-semibold tracking-tight mb-6 sm:mb-8">{t('edit.title')}</h1>

      <div className="space-y-5 sm:space-y-6">
        {/* Title */}
        <div>
          <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-2">
            {t('edit.songTitle')} <span className="text-[var(--destructive)]">*</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--input)] px-3 sm:px-4 py-2.5 text-sm outline-none focus:border-[var(--primary)] transition-colors"
          />
        </div>

        {/* Artist */}
        <div>
          <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-2">
            {t('edit.artist')}
          </label>
          <input
            type="text"
            value={artist}
            onChange={(e) => setArtist(e.target.value)}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--input)] px-3 sm:px-4 py-2.5 text-sm outline-none focus:border-[var(--primary)] transition-colors"
          />
        </div>

        {/* Lyrics */}
        <div>
          <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-2">
            {t('edit.lyrics')}
          </label>
          <textarea
            value={lyrics}
            onChange={(e) => setLyrics(e.target.value)}
            rows={12}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--input)] px-3 sm:px-4 py-3 text-sm outline-none focus:border-[var(--primary)] transition-colors resize-y leading-relaxed"
          />
          <p className="mt-2 text-[11px] text-[var(--muted-foreground)]">
            {t('edit.furiganaHint')}
          </p>
        </div>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 pt-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-md bg-[var(--primary)] px-5 py-2.5 text-sm font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving ? t('edit.converting') : t('common.save')}
          </button>
          <button
            onClick={() => router.push(`/songs/${id}`)}
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
