/* eslint-disable react-hooks/set-state-in-effect */

'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import Toast from '@/components/Toast';
import SpotifyLoginButton from '@/components/SpotifyLoginButton';
import { useAuthSession } from '@/lib/auth-session';
import { useCoverTheme } from '@/hooks/useCoverPalette';

interface SongData {
  id: string;
  title: string;
  artist: string;
  lyrics_raw: string;
  lyrics_translation: string;
  cover_url?: string | null;
}

interface AuthState {
  authenticated: boolean;
  isAdmin?: boolean;
}

export default function TranslationEditPage() {
  const router = useRouter();
  const params = useParams();
  const { t } = useI18n();
  const id = params?.id as string;

  const [song, setSong] = useState<SongData | null>(null);
  const [draft, setDraft] = useState<string[]>([]);
  const [original, setOriginal] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const { session } = useAuthSession();
  const coverTheme = useCoverTheme(song?.cover_url);
  const coverColor = coverTheme.palette;
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const auth: AuthState | null = session === null ? null : {
    authenticated: session.user !== null,
    isAdmin: session.user?.isAdmin === true,
  };

  const showToast = useCallback((type: 'success' | 'error', msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const loadSong = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/songs/${id}`);
      if (!res.ok) throw new Error();
      const data = (await res.json()) as SongData;
      setSong(data);
      if (!data.cover_url) {
        fetch(`/api/songs/${id}/cover`)
          .then(async (coverResponse) => {
            if (!coverResponse.ok) return null;
            const coverData = await coverResponse.json() as { cover_url?: string | null };
            return coverData.cover_url ?? null;
          })
          .then((url) => {
            if (url) setSong((current) => current ? { ...current, cover_url: url } : current);
          })
          .catch(() => {});
      }
      const rawLines = data.lyrics_raw.split('\n');
      let parsed: string[] = [];
      try {
        const json = JSON.parse(data.lyrics_translation || '[]');
        if (Array.isArray(json)) parsed = json.filter((item): item is string => typeof item === 'string');
      } catch { /* empty draft */ }
      // Align exactly to the current lyric lines; stale/extra entries are dropped.
      const aligned = Array.from({ length: rawLines.length }, (_, i) => parsed[i] ?? '');
      setOriginal(aligned);
      setDraft(aligned);
    } catch {
      showToast('error', t('song.notFound'));
    } finally {
      setLoading(false);
    }
  }, [id, showToast, t]);

  useEffect(() => {
    loadSong();
  }, [loadSong]);

  const sourceLyrics = song?.lyrics_raw ?? '';
  const rawLines = useMemo(() => sourceLyrics.split('\n'), [sourceLyrics]);
  const filledCount = useMemo(() => draft.filter((line) => line.trim()).length, [draft]);
  const isDirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(original), [draft, original]);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  const handleSave = useCallback(async () => {
    if (!id) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/songs/${id}/translation`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          translations: draft,
          source_lyrics: sourceLyrics,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (res.status === 401) throw new Error(t('translation.loginRequired'));
        if (res.status === 403) throw new Error(t('translation.forbidden'));
        if (res.status === 409) throw new Error(t('translation.staleSource'));
        throw new Error(data.error === 'song_not_found' ? t('song.notFound') : t('translation.saveFailed'));
      }
      setOriginal(draft);
      showToast('success', t('translation.saved'));
    } catch (e: unknown) {
      showToast('error', e instanceof Error ? e.message : t('translation.saveFailed'));
    } finally {
      setSaving(false);
    }
  }, [id, draft, sourceLyrics, showToast, t]);

  const handleCancel = useCallback(() => {
    if (isDirty && !window.confirm(t('translation.unsavedConfirm'))) return;
    router.push(`/songs/${id}`);
  }, [isDirty, router, id, t]);

  if (loading || auth === null) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--muted-foreground)]/30 border-t-[var(--muted-foreground)]" />
      </div>
    );
  }

  if (!song) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-center">
        <p className="text-sm text-[var(--muted-foreground)]">{t('song.notFound')}</p>
        <button
          onClick={() => router.push('/')}
          className="mt-4 inline-flex items-center gap-1 text-xs text-[var(--song-accent)] hover:underline"
        >
          <ArrowLeft className="h-3 w-3" /> {t('song.backToList')}
        </button>
      </div>
    );
  }

  if (!auth.authenticated) {
    return (
      <div className="fade-in max-w-2xl">
        <div className="mb-6 flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
          <Link href="/" className="hover:text-[var(--foreground)] transition-colors">{t('common.list')}</Link>
          <span className="opacity-40">/</span>
          <Link href={`/songs/${id}`} className="hover:text-[var(--foreground)] transition-colors truncate max-w-[180px]">{song.title}</Link>
          <span className="opacity-40">/</span>
          <span className="text-[var(--foreground)]">{t('translation.editBreadcrumb')}</span>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-6 text-center">
          <p className="text-sm text-[var(--muted-foreground)]">{t('translation.loginRequired')}</p>
          <SpotifyLoginButton
            className="song-editor-primary-button mt-4 inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium transition-opacity hover:opacity-90"
          >
            {t('song.spotify')}
          </SpotifyLoginButton>
        </div>
      </div>
    );
  }

  const songThemeStyle = coverTheme.style;

  return (
    <div className={`song-view song-editor-page fade-in max-w-3xl${coverColor ? ' song-view--accented' : ''}`} style={songThemeStyle}>
      {/* Breadcrumb */}
      <div className="mb-6 flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
        <Link href="/" className="hover:text-[var(--foreground)] transition-colors">{t('common.list')}</Link>
        <span className="opacity-40">/</span>
        <Link href={`/songs/${id}`} className="hover:text-[var(--foreground)] transition-colors truncate max-w-[140px] sm:max-w-[180px]">
          {song.title}
        </Link>
        <span className="opacity-40">/</span>
        <span className="text-[var(--foreground)]">{t('translation.editBreadcrumb')}</span>
      </div>

      <div className="sticky top-11 z-40 -mx-4 mb-6 flex flex-col gap-3 border-b border-[var(--border)] bg-[var(--background)]/95 px-4 py-3 backdrop-blur-sm sm:-mx-6 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">{t('translation.title')}</h1>
          <p className="text-xs text-[var(--muted-foreground)]">{t('translation.lineSummary', { count: String(filledCount), total: String(rawLines.length) })}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleSave}
            disabled={saving || !isDirty}
            className="song-editor-primary-button inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : null}
            {saving ? t('common.loading') : t('common.save')}
          </button>
          <button
            onClick={handleCancel}
            className="rounded-md px-4 py-2 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
          >
            {t('common.cancel')}
          </button>
        </div>
      </div>

      {/* Column headers */}
      <div className="mb-2 hidden grid-cols-[1fr_1.2fr] gap-3 px-3 text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)] sm:grid">
        <span>{t('translation.sourceColumn')}</span>
        <span>{t('translation.translatedColumn')}</span>
      </div>

      <div className="space-y-1.5 pb-24">
        {rawLines.map((raw, i) => {
          const isEmptyLine = !raw.trim();
          return (
            <div key={i} className={`grid gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)]/50 p-2.5 sm:grid-cols-[1fr_1.2fr] sm:gap-3 ${isEmptyLine ? 'opacity-50' : ''}`}>
              <div className="min-w-0 break-words text-sm leading-relaxed text-[var(--foreground)]">
                {raw || <span className="text-xs text-[var(--muted-foreground)]">{t('translation.emptyLine')}</span>}
              </div>
              <input
                ref={(el) => { inputRefs.current[i] = el; }}
                value={draft[i] ?? ''}
                onChange={(e) => {
                  const next = draft.slice();
                  next[i] = e.target.value;
                  setDraft(next);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    for (let j = i + 1; j < rawLines.length; j += 1) {
                      if (rawLines[j].trim()) {
                        inputRefs.current[j]?.focus();
                        break;
                      }
                    }
                  }
                }}
                disabled={isEmptyLine}
                placeholder={isEmptyLine ? '' : t('translation.inputPlaceholder')}
                className="w-full rounded-md border border-[var(--border)] bg-[var(--input)] px-2.5 py-1.5 text-sm outline-none transition-colors focus:border-[var(--primary)] disabled:opacity-50"
                aria-label={t('translation.translatedColumn')}
              />
            </div>
          );
        })}
      </div>

      {toast && <Toast type={toast.type} message={toast.msg} />}
    </div>
  );
}
