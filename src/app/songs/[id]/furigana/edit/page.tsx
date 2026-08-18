/* eslint-disable react-hooks/set-state-in-effect */

'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, RotateCcw, Sparkles, RefreshCw } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import ConfirmDialog from '@/components/ConfirmDialog';
import FuriganaEditor from '@/components/FuriganaEditor';
import Toast from '@/components/Toast';
import SpotifyLoginButton from '@/components/SpotifyLoginButton';
import { convertLyricsReading, normalizeReadingScheme } from '@/lib/lyrics-reading';
import type { FuriganaLine, ReadingScheme } from '@/lib/types';
import { useAuthSession } from '@/lib/auth-session';
import { useCoverTheme } from '@/hooks/useCoverPalette';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { furiganaLinesMatchSource } from '@/lib/furigana-validation';

interface SongData {
  id: string;
  title: string;
  artist: string;
  lyrics_raw: string;
  lyrics_furigana: string;
  reading_scheme: ReadingScheme;
  cover_url?: string | null;
}

interface AuthState {
  authenticated: boolean;
  isAdmin?: boolean;
}

export default function FuriganaEditPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const { t } = useI18n();
  const id = params?.id as string;

  const [song, setSong] = useState<SongData | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [draft, setDraft] = useState<FuriganaLine[]>([]);
  const [original, setOriginal] = useState<FuriganaLine[]>([]);
  const [loading, setLoading] = useState(true);
  const { session } = useAuthSession();
  const coverTheme = useCoverTheme(song?.cover_url);
  const coverColor = coverTheme.palette;
  const auth: AuthState | null = session === null ? null : {
    authenticated: session.user !== null,
    isAdmin: session.user?.isAdmin === true,
  };
  const [saving, setSaving] = useState(false);
  const [reconverting, setReconverting] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((type: 'success' | 'error', msg: string) => {
    // Clear any pending timer from a previous toast so it cannot dismiss the new one early.
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ type, msg });
    toastTimerRef.current = setTimeout(() => {
      toastTimerRef.current = null;
      setToast(null);
    }, 3000);
  }, []);

  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, []);

  const parseFurigana = useCallback((str: string): FuriganaLine[] => {
    if (!str) return [];
    try {
      const parsed = JSON.parse(str);
      if (Array.isArray(parsed)) return parsed as FuriganaLine[];
    } catch {
      // fall through
    }
    return [];
  }, []);

  const loadSong = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    let wasNotFound = false;
    try {
      const res = await fetch(`/api/songs/${id}`);
      if (res.status === 404) {
        wasNotFound = true;
        setLoadError(false);
        throw new Error('not found');
      }
      if (!res.ok) {
        setLoadError(true);
        throw new Error('load failed');
      }
      const data = (await res.json()) as SongData;
      setLoadError(false);
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
      const parsed = parseFurigana(data.lyrics_furigana);
      // Legacy/generated annotations can become stale after lyrics are edited. Rebuild them before
      // presenting the editor so a one-word reading correction never submits an invalid full payload.
      if (furiganaLinesMatchSource(parsed, data.lyrics_raw)) {
        setOriginal(parsed);
        setDraft(parsed);
      } else {
        setOriginal([]);
        setDraft([]);
      }
    } catch {
      showToast('error', t(wasNotFound ? 'song.notFound' : 'song.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [id, parseFurigana, showToast, t]);

  useEffect(() => {
    loadSong();
  }, [loadSong]);

  useEffect(() => {
    if (!song?.lyrics_raw) return;
    if (draft.length > 0 || original.length > 0) return;
    setReconverting(true);
    convertLyricsReading(song.lyrics_raw, normalizeReadingScheme(song.reading_scheme))
      .then((lines) => {
        setDraft(lines);
        setOriginal(lines);
      })
      .catch(() => showToast('error', t('song.furiganaLoadFailed')))
      .finally(() => setReconverting(false));
  }, [song, draft.length, original.length, showToast, t]);

  const sourceLyrics = song?.lyrics_raw ?? '';
  const rawLines = useMemo(() => sourceLyrics.split('\n'), [sourceLyrics]);
  const activeReadingScheme = normalizeReadingScheme(song?.reading_scheme);

  // Resolve the `?line=N` deep-link target against the parsed draft lines. The
  // detail-page「纠正注音」entry passes the source-line index; it matches the
  // editor's `draft` array position (both are built from `lyrics_raw` split by
  // line). Blank rows may be skipped in rendering, so we validate against the
  // parsed array length instead of `rawLines`.
  const focusLine = useMemo(() => {
    const raw = searchParams?.get('line');
    if (raw === null || raw === undefined) return undefined;
    const n = parseInt(raw, 10);
    if (Number.isNaN(n) || n < 0 || n >= draft.length) return undefined;
    return n;
  }, [searchParams, draft.length]);

  const isDirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(original), [draft, original]);

  // Unified unsaved-changes guard covering in-app <Link> clicks (breadcrumbs,
  // AppShell navigation), browser back/forward, `router.push` and unload. The
  // dialog is rendered at the bottom of this page.
  const { dialog: unsavedDialog, guard: guardNavigate } = useUnsavedChangesGuard({
    confirmHref: `/songs/${id}`,
    dirty: isDirty,
  });

  const doReset = useCallback(async () => {
    setConfirmReset(false);
    await loadSong();
  }, [loadSong]);

  const handleSave = useCallback(async () => {
    if (!id) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/songs/${id}/furigana`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lyrics_furigana: draft,
          reading_scheme: activeReadingScheme,
          source_lyrics: sourceLyrics,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (res.status === 401) throw new Error(t('furigana.loginRequired'));
        if (res.status === 403) throw new Error(t('furigana.forbidden'));
        if (res.status === 409) throw new Error(t('furigana.staleSource'));
        throw new Error(data.error === 'song_not_found' ? t('song.notFound') : t('furigana.saveFailed'));
      }
      setOriginal(draft);
      showToast('success', t('furigana.saved'));
    } catch (e: unknown) {
      showToast('error', e instanceof Error ? e.message : t('furigana.saveFailed'));
    } finally {
      setSaving(false);
    }
  }, [id, draft, activeReadingScheme, sourceLyrics, showToast, t]);

  const handleReset = useCallback(() => {
    if (isDirty) setConfirmReset(true);
    else void loadSong();
  }, [isDirty, loadSong]);

  const handleReconvert = useCallback(async () => {
    if (!song?.lyrics_raw) return;
    setReconverting(true);
    try {
      const lines = await convertLyricsReading(song.lyrics_raw, normalizeReadingScheme(song.reading_scheme));
      setDraft(lines);
      // Only replace the editor draft here — persistence happens in handleSave.
      // Use a dedicated message instead of `edit.saved` so the user isn't misled
      // into thinking the regenerated annotations have already been persisted.
      showToast('success', t('furigana.reconverted'));
    } catch {
      showToast('error', t('song.furiganaLoadFailed'));
    } finally {
      setReconverting(false);
    }
  }, [song, showToast, t]);

  const handleCancel = useCallback(() => {
    guardNavigate(`/songs/${id}`);
  }, [guardNavigate, id]);

  if (loading || auth === null) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--muted-foreground)]/30 border-t-[var(--muted-foreground)]" />
      </div>
    );
  }

  if (!song) {
    if (loadError) {
      return (
        <div className="flex flex-col items-center justify-center py-32 text-center">
          <RefreshCw className="h-10 w-10 mb-4 text-[var(--muted-foreground)] opacity-20" />
          <p className="text-sm text-[var(--muted-foreground)]">{t('song.loadFailed')}</p>
          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={() => loadSong()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 py-2 text-xs font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
            >
              <RefreshCw className="h-3.5 w-3.5" /> {t('song.retry')}
            </button>
            <button
              onClick={() => router.push('/')}
              className="inline-flex items-center gap-1 text-xs text-[var(--song-accent)] hover:underline"
            >
              <ArrowLeft className="h-3 w-3" /> {t('song.backToList')}
            </button>
          </div>
        </div>
      );
    }
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
          <span className="text-[var(--foreground)]">{t('furigana.editBreadcrumb')}</span>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-6 text-center">
          <p className="text-sm text-[var(--muted-foreground)]">{t('furigana.loginRequired')}</p>
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
        <span className="text-[var(--foreground)]">{t('furigana.editBreadcrumb')}</span>
      </div>

      <div className="sticky top-11 z-40 -mx-4 mb-6 flex flex-col gap-3 border-b border-[var(--border)] bg-[var(--background)]/95 px-4 py-3 backdrop-blur-sm sm:-mx-6 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">{t('furigana.title')}</h1>
          {song.artist && <p className="text-xs text-[var(--muted-foreground)]">{song.artist}</p>}
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
          <button
            onClick={handleReset}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--accent)] px-3 py-2 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors disabled:opacity-50"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {t('furigana.reset')}
          </button>
          <button
            onClick={handleReconvert}
            disabled={reconverting}
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--accent)] px-3 py-2 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors disabled:opacity-50"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {reconverting ? t('furigana.reconverting') : t('furigana.reconvert')}
          </button>
        </div>
      </div>

      <FuriganaEditor
        lines={draft}
        rawLines={rawLines}
        onChange={setDraft}
        readingScheme={activeReadingScheme}
        focusLine={focusLine}
      />

      {toast && <Toast type={toast.type} message={toast.msg} />}
      <ConfirmDialog
        open={confirmReset}
        title={t('common.unsavedTitle')}
        body={t('common.unsavedBody')}
        confirmLabel={t('common.discard')}
        cancelLabel={t('common.cancel')}
        variant="danger"
        onConfirm={() => void doReset()}
        onCancel={() => setConfirmReset(false)}
      />
      {unsavedDialog}
    </div>
  );
}
