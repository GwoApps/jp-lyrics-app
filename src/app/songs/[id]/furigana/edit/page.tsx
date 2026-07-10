/* eslint-disable react-hooks/set-state-in-effect */

'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, RotateCcw, Sparkles } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import FuriganaEditor from '@/components/FuriganaEditor';
import { convertToFuriganaClient } from '@/lib/kuroshiro-client';
import type { FuriganaLine } from '@/lib/types';

interface SongData {
  id: string;
  title: string;
  artist: string;
  lyrics_raw: string;
  lyrics_furigana: string;
}

interface AuthState {
  authenticated: boolean;
  isAdmin?: boolean;
}

export default function FuriganaEditPage() {
  const router = useRouter();
  const params = useParams();
  const { t } = useI18n();
  const id = params?.id as string;

  const [song, setSong] = useState<SongData | null>(null);
  const [draft, setDraft] = useState<FuriganaLine[]>([]);
  const [original, setOriginal] = useState<FuriganaLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [saving, setSaving] = useState(false);
  const [reconverting, setReconverting] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  const showToast = useCallback((type: 'success' | 'error', msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3000);
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
    try {
      const res = await fetch(`/api/songs/${id}`);
      if (!res.ok) throw new Error();
      const data = (await res.json()) as SongData;
      setSong(data);
      const parsed = parseFurigana(data.lyrics_furigana);
      setOriginal(parsed);
      setDraft(parsed);
    } catch {
      showToast('error', t('song.notFound'));
    } finally {
      setLoading(false);
    }
  }, [id, parseFurigana, showToast, t]);

  useEffect(() => {
    loadSong();
  }, [loadSong]);

  useEffect(() => {
    fetch('/api/me')
      .then((r) => r.json())
      .then((d) => setAuth({ authenticated: !!d.authenticated, isAdmin: !!d.isAdmin }))
      .catch(() => setAuth({ authenticated: false }));
  }, []);

  useEffect(() => {
    if (!song?.lyrics_raw) return;
    if (draft.length > 0 || original.length > 0) return;
    setReconverting(true);
    convertToFuriganaClient(song.lyrics_raw)
      .then((lines) => {
        setDraft(lines);
        setOriginal(lines);
      })
      .catch(() => showToast('error', t('song.furiganaLoadFailed')))
      .finally(() => setReconverting(false));
  }, [song, draft.length, original.length, showToast, t]);

  const rawLines = useMemo(() => song?.lyrics_raw.split('\n') ?? [], [song?.lyrics_raw]);

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
      const res = await fetch(`/api/songs/${id}/furigana`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lyrics_furigana: draft }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (res.status === 401) throw new Error(t('furigana.loginRequired'));
        if (res.status === 403) throw new Error(t('furigana.forbidden'));
        throw new Error(data.error === 'song_not_found' ? t('song.notFound') : t('furigana.saveFailed'));
      }
      setOriginal(draft);
      showToast('success', t('furigana.saved'));
    } catch (e: unknown) {
      showToast('error', e instanceof Error ? e.message : t('furigana.saveFailed'));
    } finally {
      setSaving(false);
    }
  }, [id, draft, showToast, t]);

  const handleReset = useCallback(async () => {
    if (isDirty && !window.confirm(t('furigana.unsavedConfirm'))) return;
    await loadSong();
  }, [isDirty, loadSong, t]);

  const handleReconvert = useCallback(async () => {
    if (!song?.lyrics_raw) return;
    setReconverting(true);
    try {
      const lines = await convertToFuriganaClient(song.lyrics_raw);
      setDraft(lines);
      showToast('success', t('edit.saved'));
    } catch {
      showToast('error', t('song.furiganaLoadFailed'));
    } finally {
      setReconverting(false);
    }
  }, [song, showToast, t]);

  const handleCancel = useCallback(() => {
    if (isDirty && !window.confirm(t('furigana.unsavedConfirm'))) return;
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
          className="mt-4 inline-flex items-center gap-1 text-xs text-[var(--primary)] hover:underline"
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
          <a
            href="/api/auth/login"
            className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90"
          >
            {t('song.spotify')}
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="fade-in max-w-3xl">
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

      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">{t('furigana.title')}</h1>
          {song.artist && <p className="text-xs text-[var(--muted-foreground)]">{song.artist}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleSave}
            disabled={saving || !isDirty}
            className="inline-flex items-center gap-1.5 rounded-md bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:opacity-50"
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

      <FuriganaEditor lines={draft} rawLines={rawLines} onChange={setDraft} />

      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}
    </div>
  );
}
