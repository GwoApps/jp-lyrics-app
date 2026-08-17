'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpDown,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  Clock3,
  Eraser,
  Headphones,
  LocateFixed,
  Minus,
  Plus,
  RotateCcw,
  Save,
  Undo2,
  RefreshCw,
} from 'lucide-react';
import ConfirmDialog from '@/components/ConfirmDialog';
import CoverImage from '@/components/CoverImage';
import Toast from '@/components/Toast';
import SpotifyStatusCard from '@/components/timeline/SpotifyStatusCard';
import OffsetControls from '@/components/timeline/OffsetControls';
import MarkCurrentLineCard from '@/components/timeline/MarkCurrentLineCard';
import TimelineLineRow from '@/components/timeline/TimelineLineRow';
import { useCoverTheme } from '@/hooks/useCoverPalette';
import { useNowPlaying } from '@/hooks/useNowPlaying';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { useI18n } from '@/lib/i18n';
import {
  buildTimelineDraft,
  findTimelineConflicts,
  fmtMs,
  fmtTime,
  parseLrcTimestamp,
  serializeTimelineDraft,
  type TimelineDraftLine,
} from '@/lib/lrc';
import { songMatchScore } from '@/lib/match';
import {
  applyUndo,
  pushLineEntry,
  pushSnapshotEntry,
  type HistoryEntry,
} from '@/lib/timeline-history';

interface TimelineSong {
  id: string;
  title: string;
  artist: string;
  lyrics_raw: string;
  lyrics_synced: string;
  cover_url?: string | null;
  spotify_track_id?: string | null;
  permissions?: { can_edit: boolean };
}

function getAccurateProgress(anchor: { progressMs: number; receivedAt: number; playing: boolean }) {
  return Math.max(0, anchor.progressMs + (anchor.playing ? Date.now() - anchor.receivedAt : 0));
}

export default function TimelineEditorPage() {
  const params = useParams();
  const { t } = useI18n();
  const id = params?.id as string;
  const [song, setSong] = useState<TimelineSong | null>(null);
  const [lines, setLines] = useState<TimelineDraftLine[]>([]);
  const [initialDraft, setInitialDraft] = useState('');
  const [fuzzyMatched, setFuzzyMatched] = useState(0);
  const [unmatched, setUnmatched] = useState(0);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // True when the load failed for a retryable reason (network/5xx/429) —
  // offers a retry entry instead of a dead-end error page.
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [offsetDraft, setOffsetDraft] = useState('0');
  const [confirmSort, setConfirmSort] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [staleConflict, setStaleConflict] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const sourceLyricsRef = useRef('');
  const [liveProgress, setLiveProgress] = useState(0);
  const rowRefs = useRef<Array<HTMLDivElement | null>>([]);
  const progressAnchor = useRef({ progressMs: 0, receivedAt: 0, playing: false });
  const nowPlayingHook = useNowPlaying(true);
  const nowPlaying = nowPlayingHook.data;
  const coverTheme = useCoverTheme(song?.cover_url ?? null);

  // Pure fetch — no setState — so the effect can apply the result inside a
  // promise `.then` callback (avoids synchronous setState in an effect).
  const fetchSong = useCallback(async (): Promise<
    { data: TimelineSong } | { forbidden: true } | { failed: boolean; notFound?: boolean }
  > => {
    if (!id) return { failed: true, notFound: true };
    try {
      const response = await fetch(`/api/songs/${id}`);
      if (response.status === 404) return { failed: true, notFound: true };
      if (!response.ok) return { failed: true };
      const data = await response.json() as TimelineSong;
      if (!data.permissions?.can_edit) return { forbidden: true };
      return { data };
    } catch {
      return { failed: true };
    }
  }, [id]);

  // Build the timeline draft and persist both the lines and the alignment stats
  // (fuzzy matches + unmatched synced rows) so the mismatch banner can render.
  const applyDraft = useCallback((raw: string, synced: string) => {
    const result = buildTimelineDraft(raw, synced);
    setLines(result.lines);
    setFuzzyMatched(result.fuzzyMatched);
    setUnmatched(result.unmatched);
    setInitialDraft(serializeTimelineDraft(result.lines));
    const firstUnmarked = result.lines.findIndex((line) => line.timeMs == null);
    setCurrentIndex(firstUnmarked >= 0 ? firstUnmarked : 0);
  }, []);

  // Apply the fetched result to state. Called from promise `.then` callbacks
  // (mount + retry) so setState never runs synchronously inside an effect.
  const applySongResult = useCallback((result: { data: TimelineSong } | { forbidden: true } | { failed: boolean; notFound?: boolean }) => {
    if ('data' in result) {
      const { data } = result;
      setLoadError(false);
      setError('');
      setSong(data);
      applyDraft(data.lyrics_raw || '', data.lyrics_synced || '');
      sourceLyricsRef.current = data.lyrics_raw || '';
      return;
    }
    if ('forbidden' in result) {
      setLoadError(false);
      setError(t('timelineWorkspace.forbidden'));
      return;
    }
    // Genuine 404 (song absent) vs a retryable load failure.
    if (result.notFound) setLoadError(false);
    else setLoadError(true);
    setError(t('timelineWorkspace.loadFailed'));
  }, [applyDraft, t]);

  useEffect(() => {
    void fetchSong().then((result) => { applySongResult(result); setLoading(false); });
  }, [fetchSong, applySongResult]);

  useEffect(() => {
    if (!nowPlaying) return;
    const nextAnchor = {
      progressMs: nowPlaying.progress_ms || 0,
      receivedAt: Date.now(),
      playing: !!nowPlaying.is_playing,
    };
    progressAnchor.current = nextAnchor;
    const frame = window.requestAnimationFrame(() => {
      setLiveProgress(getAccurateProgress(nextAnchor));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [nowPlaying]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setLiveProgress(getAccurateProgress(progressAnchor.current));
    }, 100);
    return () => window.clearInterval(timer);
  }, []);

  const serialized = useMemo(() => serializeTimelineDraft(lines), [lines]);
  const dirty = serialized !== initialDraft;
  const markedCount = useMemo(() => lines.filter((line) => line.timeMs != null).length, [lines]);
  const progressPercent = lines.length ? Math.round(markedCount / lines.length * 100) : 0;
  const conflicts = useMemo(() => findTimelineConflicts(lines), [lines]);
  const conflictLines = useMemo(() => {
    const set = new Set<number>();
    for (const conflict of conflicts) {
      set.add(conflict.index);
      set.add(conflict.previousIndex);
    }
    return set;
  }, [conflicts]);
  const currentLine = lines[currentIndex];

  const spotifyMatches = !!(song && nowPlaying?.track
    && songMatchScore(song, nowPlaying.track) >= 0.5);
  const canUseSpotifyTime = !!(nowPlaying?.connected && nowPlaying.track && spotifyMatches);

  // Unified unsaved-changes guard covering the back button, breadcrumbs,
  // AppShell navigation, browser back/forward and unload. The dialog is
  // rendered at the bottom of this page.
  const { dialog: unsavedDialog, guard: guardNavigate } = useUnsavedChangesGuard({
    confirmHref: `/songs/${id}`,
    dirty,
  });

  useEffect(() => {
    rowRefs.current[currentIndex]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [currentIndex]);

  const showToast = useCallback((type: 'success' | 'error', msg: string) => {
    setToast({ type, msg });
    window.setTimeout(() => setToast(null), 3000);
  }, []);

  const selectLine = useCallback((index: number) => {
    setCurrentIndex(Math.max(0, Math.min(lines.length - 1, index)));
  }, [lines.length]);

  const setLineTime = useCallback((index: number, timeMs: number | null, advance = false) => {
    const previousTime = lines[index]?.timeMs ?? null;
    setHistory((items) => pushLineEntry(items, index, previousTime));
    setLines((current) => current.map((line, lineIndex) => lineIndex === index
      ? { ...line, timeMs: timeMs == null ? null : Math.max(0, Math.round(timeMs)) }
      : line));
    if (advance) {
      const nextUnmarked = lines.findIndex((line, lineIndex) => lineIndex > index && line.timeMs == null);
      selectLine(nextUnmarked >= 0 ? nextUnmarked : Math.min(index + 1, lines.length - 1));
    }
  }, [lines, selectLine]);

  const markCurrentLine = useCallback(() => {
    if (!canUseSpotifyTime || !currentLine) return;
    setLineTime(currentIndex, getAccurateProgress(progressAnchor.current), true);
  }, [canUseSpotifyTime, currentIndex, currentLine, setLineTime]);

  const undo = useCallback(() => {
    const result = applyUndo(history, lines);
    if (!result.lines) return;
    setLines(result.lines);
    if (result.lineIndex != null) setCurrentIndex(result.lineIndex);
    setHistory(result.entries);
  }, [history, lines]);

  const applyOffset = (offsetMs: number) => {
    if (!Number.isFinite(offsetMs) || offsetMs === 0) return;
    setHistory((items) => pushSnapshotEntry(items, lines));
    setLines((current) => current.map((line) => ({
      ...line,
      timeMs: line.timeMs == null ? null : Math.max(0, Math.round(line.timeMs + offsetMs)),
    })));
    setOffsetDraft('0');
  };

  /** Sort marked rows by timestamp; only invoked after explicit user confirmation. */
  const applySortByTime = useCallback(() => {
    setHistory((items) => pushSnapshotEntry(items, lines));
    setLines((current) => [...current].sort((a, b) => {
      if (a.timeMs == null) return b.timeMs == null ? 0 : 1;
      if (b.timeMs == null) return -1;
      return a.timeMs - b.timeMs;
    }));
    setConfirmSort(false);
  }, [lines]);

  const doReset = () => {
    setConfirmReset(false);
    if (!song) return;
    applyDraft(song.lyrics_raw || '', song.lyrics_synced || '');
    setHistory([]);
  };

  const requestReset = () => setConfirmReset(true);

  const reloadFromServer = useCallback(async () => {
    if (!id) return;
    try {
      const response = await fetch(`/api/songs/${id}`);
      if (!response.ok) throw new Error('reload_failed');
      const data = await response.json() as TimelineSong;
      if (!data.permissions?.can_edit) throw new Error('forbidden');
      setSong(data);
      applyDraft(data.lyrics_raw || '', data.lyrics_synced || '');
      sourceLyricsRef.current = data.lyrics_raw || '';
      setHistory([]);
      setStaleConflict(false);
      showToast('success', t('timelineWorkspace.reloaded'));
    } catch {
      showToast('error', t('timelineWorkspace.reloadFailed'));
    }
  }, [applyDraft, id, showToast, t]);

  const exportDraft = () => {
    const text = serializeTimelineDraft(lines);
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${song?.title || 'timeline'}-draft.lrc`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  const seekSpotify = async (positionMs: number) => {
    try {
      const response = await fetch('/api/spotify/seek', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ position_ms: positionMs }),
      });
      if (!response.ok) throw new Error('seek_failed');
      progressAnchor.current = {
        progressMs: positionMs,
        receivedAt: Date.now(),
        playing: !!nowPlaying?.is_playing,
      };
      setLiveProgress(positionMs);
    } catch {
      showToast('error', t('timelineWorkspace.seekFailed'));
    }
  };

  const save = useCallback(async () => {
    if (!song || lines.length === 0) return;
    if (conflicts.length > 0) {
      const first = conflicts[0];
      selectLine(first.index);
      showToast('error', t('timelineWorkspace.timestampsNotOrdered', {
        line: String(first.line),
        previousLine: String(first.previousLine),
      }));
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(`/api/songs/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lyrics_synced: serializeTimelineDraft(lines), source_lyrics: sourceLyricsRef.current }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null) as { error?: string } | null;
        if (data?.error === 'timestamps_not_ordered') {
          showToast('error', t('timelineWorkspace.saveBlockedServer'));
          return;
        }
        if (response.status === 409) {
          setStaleConflict(true);
          return;
        }
        throw new Error('save_failed');
      }
      const updated = await response.json() as TimelineSong;
      const raw = updated.lyrics_raw || song.lyrics_raw;
      applyDraft(raw, updated.lyrics_synced || '');
      sourceLyricsRef.current = raw;
      setSong(updated);
      setHistory([]);
      showToast('success', markedCount === lines.length
        ? t('timelineWorkspace.savedComplete')
        : t('timelineWorkspace.savedProgress', { marked: String(markedCount), total: String(lines.length) }));
    } catch {
      showToast('error', t('timelineWorkspace.saveFailed'));
    } finally {
      setSaving(false);
    }
  }, [applyDraft, conflicts, id, lines, markedCount, selectLine, showToast, song, t]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, button, a')) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        markCurrentLine();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        selectLine(currentIndex - 1);
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        selectLine(currentIndex + 1);
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        undo();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        save();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentIndex, markCurrentLine, save, selectLine, undo]);

  const requestLeave = () => {
    guardNavigate(`/songs/${id}`);
  };

  if (loading) {
    return <div className="mx-auto max-w-6xl animate-pulse space-y-5 py-8"><div className="h-8 w-64 rounded bg-[var(--muted)]" /><div className="h-36 rounded-xl bg-[var(--muted)]" /><div className="h-[55vh] rounded-xl bg-[var(--muted)]" /></div>;
  }

  if (error || !song) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-4 py-24 text-center">
        <AlertTriangle className="h-8 w-8 text-[var(--warning)]" />
        <p className="text-sm text-[var(--muted-foreground)]">{error || t('timelineWorkspace.loadFailed')}</p>
        <div className="flex items-center gap-3">
          {loadError && (
            <button onClick={() => { setLoading(true); void fetchSong().then((result) => { applySongResult(result); setLoading(false); }); }} className="song-editor-primary-button inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm">
              <RefreshCw className="h-4 w-4" /> {t('song.retry')}
            </button>
          )}
          <Link href={`/songs/${id}`} className="song-editor-primary-button rounded-md px-4 py-2 text-sm">{t('timelineWorkspace.backToSong')}</Link>
        </div>
      </div>
    );
  }

  if (lines.length === 0) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-4 py-24 text-center">
        <Clock3 className="h-8 w-8 text-[var(--muted-foreground)]" />
        <h1 className="text-lg font-semibold">{t('timelineWorkspace.noLyrics')}</h1>
        <p className="text-sm text-[var(--muted-foreground)]">{t('timelineWorkspace.noLyricsHint')}</p>
        <Link href={`/songs/${id}/edit`} className="song-editor-primary-button rounded-md px-4 py-2 text-sm">{t('timelineWorkspace.editLyrics')}</Link>
      </div>
    );
  }

  return (
    <div className={`song-view song-editor-page fade-in mx-auto max-w-6xl${coverTheme.palette ? ' song-view--accented' : ''}`} style={coverTheme.style}>
      <header className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" onClick={requestLeave} className="rounded-md p-2 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]" aria-label={t('timelineWorkspace.backToSong')} title={t('timelineWorkspace.backToSong')}>
            <ArrowLeft className="h-4 w-4" />
          </button>
          <CoverImage src={song.cover_url ?? null} alt={song.title} size="sm" />
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold sm:text-xl">{t('timelineWorkspace.title')}</h1>
            <p className="truncate text-sm text-[var(--muted-foreground)]">{song.title}{song.artist ? ` / ${song.artist}` : ''}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <button type="button" onClick={undo} disabled={history.length === 0} className="song-accent-button inline-flex h-9 items-center gap-2 rounded-md px-3 text-xs font-medium disabled:opacity-40">
            <Undo2 className="h-4 w-4" />{t('timelineWorkspace.undo')}
          </button>
          <button type="button" onClick={requestReset} disabled={!dirty} className="song-accent-button inline-flex h-9 items-center gap-2 rounded-md px-3 text-xs font-medium disabled:opacity-40">
            <RotateCcw className="h-4 w-4" />{t('timelineWorkspace.reset')}
          </button>
          <button type="button" onClick={save} disabled={saving || !dirty} className="song-editor-primary-button inline-flex h-9 items-center gap-2 rounded-md px-4 text-xs font-medium disabled:opacity-40">
            {saving ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <Save className="h-4 w-4" />}
            {saving ? t('timeline.saving') : t('timelineWorkspace.saveProgress')}
          </button>
        </div>
      </header>

      <section className="mb-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
        <SpotifyStatusCard
          nowPlaying={nowPlaying}
          liveProgress={liveProgress}
          canUseSpotifyTime={canUseSpotifyTime}
          spotifyMatches={spotifyMatches}
          syncState={nowPlayingHook.syncState}
          onResume={() => void nowPlayingHook.resumeSync()}
        />

        <OffsetControls
          offsetDraft={offsetDraft}
          onOffsetDraftChange={setOffsetDraft}
          onApply={applyOffset}
        />
      </section>

      <MarkCurrentLineCard
        currentIndex={currentIndex}
        totalLines={lines.length}
        currentLine={currentLine}
        liveProgress={liveProgress}
        canUseSpotifyTime={canUseSpotifyTime}
        onMark={markCurrentLine}
        onSelectPrev={() => selectLine(currentIndex - 1)}
        onSelectNext={() => selectLine(currentIndex + 1)}
      />

      <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)]">
        <div className="border-b border-[var(--border)] px-4 py-3">
          <h2 className="text-sm font-medium">{t('timelineWorkspace.lyricLines')}</h2>
          <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">{t('timelineWorkspace.listHint')}</p>
        </div>
        {(unmatched > 0 || fuzzyMatched > 0) && (
          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--warning)]/20 bg-[var(--warning)]/5 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="flex items-start gap-2 text-xs font-medium text-[var(--warning)]">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{unmatched > 0
                  ? t('timelineWorkspace.mismatchBanner', { count: String(unmatched) })
                  : t('timelineWorkspace.fuzzyBanner', { count: String(fuzzyMatched) })}</span>
              </p>
              <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">{t('timelineWorkspace.mismatchHint')}</p>
            </div>
          </div>
        )}
        {conflicts.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--destructive)]/20 bg-[var(--destructive)]/5 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="flex items-start gap-2 text-xs font-medium text-[var(--destructive)]">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{t('timelineWorkspace.conflictBanner', { count: String(conflicts.length) })}</span>
              </p>
              <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">{t('timelineWorkspace.conflictHint')}</p>
            </div>
            <button type="button" onClick={() => setConfirmSort(true)} className="song-accent-button inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium">
              <ArrowUpDown className="h-3.5 w-3.5" />{t('timelineWorkspace.sortByTime')}
            </button>
          </div>
        )}
        <div className="max-h-[58vh] overflow-y-auto p-2 sm:p-3">
          {lines.map((line, index) => (
            <TimelineLineRow
              key={`${index}-${line.text}`}
              line={line}
              index={index}
              selected={index === currentIndex}
              conflicted={conflictLines.has(index)}
              canSeek={!!nowPlaying?.connected}
              registerRow={(el) => { rowRefs.current[index] = el; }}
              onSelect={() => selectLine(index)}
              onSetTime={setLineTime}
              onClearTime={(i) => setLineTime(i, null)}
              onSeek={seekSpotify}
            />
          ))}
        </div>
      </section>

      <div className="sticky bottom-3 mt-4 flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--background)]/95 p-3 shadow-lg backdrop-blur">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <div className="truncate text-[var(--muted-foreground)]">{t('timelineWorkspace.progress')} <span className="ml-1 font-semibold text-[var(--foreground)] tabular-nums">{markedCount} / {lines.length}</span></div>
            <div className="shrink-0 font-medium text-[var(--song-accent)]">{progressPercent}%</div>
          </div>
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[var(--muted)]"><div className="h-full rounded-full bg-[var(--song-accent)]" style={{ width: `${progressPercent}%` }} /></div>
        </div>
        <button type="button" onClick={save} disabled={saving || !dirty} className="song-editor-primary-button inline-flex h-9 shrink-0 items-center gap-2 rounded-md px-4 text-xs font-medium disabled:opacity-40">
          {saving ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : dirty ? <Save className="h-4 w-4" /> : <Check className="h-4 w-4" />}
          {saving ? t('timeline.saving') : t('timelineWorkspace.saveProgress')}
        </button>
      </div>

      {toast && <Toast type={toast.type} message={toast.msg} />}
      {unsavedDialog}
      <ConfirmDialog
        open={confirmReset}
        title={t('common.unsavedTitle')}
        body={t('common.unsavedBody')}
        confirmLabel={t('common.discard')}
        cancelLabel={t('common.cancel')}
        variant="danger"
        onConfirm={doReset}
        onCancel={() => setConfirmReset(false)}
      />
      <ConfirmDialog open={confirmSort} title={t('timelineWorkspace.sortConfirmTitle')} body={t('timelineWorkspace.sortConfirmBody')} confirmLabel={t('timelineWorkspace.sortConfirmApply')} cancelLabel={t('common.cancel')} onConfirm={applySortByTime} onCancel={() => setConfirmSort(false)} />
      <ConfirmDialog open={staleConflict} title={t('timelineWorkspace.staleTitle')} body={t('timelineWorkspace.staleBody')} confirmLabel={t('timelineWorkspace.reload')} cancelLabel={t('timelineWorkspace.exportDraft')} variant="default" onConfirm={() => void reloadFromServer()} onCancel={() => { exportDraft(); setStaleConflict(false); }} />
    </div>
  );
}
