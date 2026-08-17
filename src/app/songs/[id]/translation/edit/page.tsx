/* eslint-disable react-hooks/set-state-in-effect */

'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, RefreshCw, RotateCcw, Sparkles } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import Toast from '@/components/Toast';
import SpotifyLoginButton from '@/components/SpotifyLoginButton';
import { useAuthSession } from '@/lib/auth-session';
import { useCoverTheme } from '@/hooks/useCoverPalette';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { parseTranslationCache } from '@/lib/translation/parse';
import { TRANSLATION_ERROR_KEYS } from '@/lib/translation-errors';

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

/**
 * Group ascending line indices into contiguous runs so each run maps to one
 * `start`/`count` slice request on the translate endpoint (issue #125).
 */
function groupConsecutiveRuns(indices: number[]): { start: number; length: number }[] {
  const runs: { start: number; length: number }[] = [];
  for (const idx of indices) {
    const last = runs[runs.length - 1];
    if (last && idx === last.start + last.length) last.length += 1;
    else runs.push({ start: idx, length: 1 });
  }
  return runs;
}

export default function TranslationEditPage() {
  const router = useRouter();
  const params = useParams();
  const { t } = useI18n();
  const id = params?.id as string;

  const [song, setSong] = useState<SongData | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const [original, setOriginal] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [lastFocusedLine, setLastFocusedLine] = useState<number | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error' | 'info'; msg: string } | null>(null);
  const { session } = useAuthSession();
  const coverTheme = useCoverTheme(song?.cover_url);
  const coverColor = coverTheme.palette;
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const auth: AuthState | null = session === null ? null : {
    authenticated: session.user !== null,
    isAdmin: session.user?.isAdmin === true,
  };

  const showToast = useCallback((type: 'success' | 'error' | 'info', msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3000);
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
      const rawLines = data.lyrics_raw.split('\n');
      // Index-aligned to the current lyric lines; stale non-string slots become
      // '' and extra entries are dropped instead of shifting later lines.
      const aligned = parseTranslationCache(data.lyrics_translation, rawLines.length);
      setOriginal(aligned);
      setDraft(aligned);
    } catch {
      showToast('error', t(wasNotFound ? 'song.notFound' : 'song.loadFailed'));
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
  // Indices whose source line is non-empty but the draft translation is blank
  // — the targets for the one-click「AI 补全缺失行」action (issue #125).
  const missingLines = useMemo(
    () => rawLines
      .map((raw, i) => ({ raw, i }))
      .filter(({ raw, i }) => raw.trim() && !(draft[i] ?? '').trim())
      .map(({ i }) => i),
    [rawLines, draft],
  );
  const isDirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(original), [draft, original]);

  // Unified unsaved-changes guard covering in-app <Link> clicks (breadcrumbs,
  // AppShell navigation), browser back/forward, `router.push` and unload. The
  // dialog is rendered at the bottom of this page.
  const { dialog: unsavedDialog, guard: guardNavigate } = useUnsavedChangesGuard({
    confirmHref: `/songs/${id}`,
    dirty: isDirty,
  });

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
    guardNavigate(`/songs/${id}`);
  }, [guardNavigate, id]);

  /**
   * One non-streaming slice request against /api/songs/[id]/translate.
   * `force: true` disables the server's cache reuse so the requested lines are
   * re-translated even when a previous translation is stored — the draft, not
   * the stored cache, decides what is missing (issue #125).
   */
  const runAiSlice = useCallback(async (start: number, count: number): Promise<string[]> => {
    const res = await fetch(`/api/songs/${id}/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ start, count, force: true }),
    });
    if (!res.ok) {
      // Surface the same localized error codes as the song page (quota,
      // not-configured, stale source, …) instead of failing silently.
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      const code = data.error ?? 'translation_failed';
      const key = TRANSLATION_ERROR_KEYS[code];
      throw new Error(key ? t(key) : t('song.translationFailed'));
    }
    const data = (await res.json()) as { translations?: string[] };
    return Array.isArray(data.translations) ? data.translations : [];
  }, [id, t]);

  /** One-click「AI 补全缺失行」: translate every blank draft line in place. */
  const handleAiFillMissing = useCallback(async () => {
    if (aiBusy || !id) return;
    if (missingLines.length === 0) {
      showToast('info', t('translation.fillMissingEmpty'));
      return;
    }
    setAiBusy(true);
    let filled = 0;
    try {
      for (const run of groupConsecutiveRuns(missingLines)) {
        const translations = await runAiSlice(run.start, run.length);
        // Count the target lines that actually received a non-empty translation.
        translations.forEach((value) => { if (value.trim()) filled += 1; });
        // Merge only the requested slice back into the draft; other lines the
        // user is typing in are left untouched.
        setDraft((prev) => {
          const next = prev.slice();
          translations.forEach((value, i) => {
            const idx = run.start + i;
            if (idx < next.length) next[idx] = value;
          });
          return next;
        });
      }
      showToast('success', t('translation.fillMissingDone', { count: String(filled) }));
    } catch (e: unknown) {
      showToast('error', e instanceof Error ? e.message : t('song.translationFailed'));
    } finally {
      setAiBusy(false);
    }
  }, [aiBusy, id, missingLines, runAiSlice, showToast, t]);

  /** Re-translate the currently focused line (「重新翻译此行」, issue #125). */
  const handleAiRetranslateLine = useCallback(async (lineIndex: number) => {
    if (aiBusy || !id) return;
    setAiBusy(true);
    try {
      const translations = await runAiSlice(lineIndex, 1);
      const value = translations[0] ?? '';
      setDraft((prev) => {
        const next = prev.slice();
        if (lineIndex < next.length) next[lineIndex] = value;
        return next;
      });
      showToast('success', t('translation.retranslateLineDone'));
    } catch (e: unknown) {
      showToast('error', e instanceof Error ? e.message : t('song.translationFailed'));
    } finally {
      setAiBusy(false);
    }
  }, [aiBusy, id, runAiSlice, showToast, t]);

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
          {missingLines.length > 0 && (
            <button
              onClick={() => void handleAiFillMissing()}
              disabled={aiBusy}
              className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--accent)] px-3 py-2 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors disabled:opacity-50"
            >
              {aiBusy ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <Sparkles className="h-3.5 w-3.5" />}
              {aiBusy ? t('common.loading') : t('translation.fillMissing', { count: String(missingLines.length) })}
            </button>
          )}
          {lastFocusedLine !== null && (
            <button
              onClick={() => void handleAiRetranslateLine(lastFocusedLine)}
              disabled={aiBusy}
              onMouseDown={(e) => e.preventDefault()}
              className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--accent)] px-3 py-2 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors disabled:opacity-50"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {t('translation.retranslateLine')}
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={saving || !isDirty || aiBusy}
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
                onFocus={() => setLastFocusedLine(i)}
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
      {unsavedDialog}
    </div>
  );
}
