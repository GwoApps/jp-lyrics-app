'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
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
} from 'lucide-react';
import ConfirmDialog from '@/components/ConfirmDialog';
import CoverImage from '@/components/CoverImage';
import Toast from '@/components/Toast';
import { useCoverTheme } from '@/hooks/useCoverPalette';
import { useNowPlaying } from '@/hooks/useNowPlaying';
import { useI18n } from '@/lib/i18n';
import {
  createTimelineDraft,
  fmtMs,
  fmtTime,
  parseLrcTimestamp,
  serializeTimelineDraft,
  type TimelineDraftLine,
} from '@/lib/lrc';
import { songMatchScore } from '@/lib/match';

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

interface HistoryEntry {
  index: number;
  previousTime: number | null;
}

function getAccurateProgress(anchor: { progressMs: number; receivedAt: number; playing: boolean }) {
  return Math.max(0, anchor.progressMs + (anchor.playing ? Date.now() - anchor.receivedAt : 0));
}

export default function TimelineEditorPage() {
  const params = useParams();
  const router = useRouter();
  const { t } = useI18n();
  const id = params?.id as string;
  const [song, setSong] = useState<TimelineSong | null>(null);
  const [lines, setLines] = useState<TimelineDraftLine[]>([]);
  const [initialDraft, setInitialDraft] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [offsetDraft, setOffsetDraft] = useState('0');
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [liveProgress, setLiveProgress] = useState(0);
  const rowRefs = useRef<Array<HTMLDivElement | null>>([]);
  const progressAnchor = useRef({ progressMs: 0, receivedAt: 0, playing: false });
  const nowPlaying = useNowPlaying(true);
  const coverTheme = useCoverTheme(song?.cover_url ?? null);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/songs/${id}`)
      .then(async (response) => {
        if (!response.ok) throw new Error('load_failed');
        return response.json() as Promise<TimelineSong>;
      })
      .then((data) => {
        if (!data.permissions?.can_edit) throw new Error('forbidden');
        const draft = createTimelineDraft(data.lyrics_raw || '', data.lyrics_synced || '');
        const serialized = serializeTimelineDraft(draft);
        setSong(data);
        setLines(draft);
        setInitialDraft(serialized);
        const firstUnmarked = draft.findIndex((line) => line.timeMs == null);
        setCurrentIndex(firstUnmarked >= 0 ? firstUnmarked : 0);
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error && reason.message === 'forbidden'
          ? t('timelineWorkspace.forbidden')
          : t('timelineWorkspace.loadFailed'));
      })
      .finally(() => setLoading(false));
  }, [id, t]);

  useEffect(() => {
    if (!nowPlaying) return;
    progressAnchor.current = {
      progressMs: nowPlaying.progress_ms || 0,
      receivedAt: Date.now(),
      playing: !!nowPlaying.is_playing,
    };
  }, [nowPlaying]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setLiveProgress(getAccurateProgress(progressAnchor.current));
    }, 200);
    return () => window.clearInterval(timer);
  }, []);

  const serialized = useMemo(() => serializeTimelineDraft(lines), [lines]);
  const dirty = serialized !== initialDraft;
  const markedCount = useMemo(() => lines.filter((line) => line.timeMs != null).length, [lines]);
  const progressPercent = lines.length ? Math.round(markedCount / lines.length * 100) : 0;
  const currentLine = lines[currentIndex];

  const spotifyMatches = !!(song && nowPlaying?.track
    && songMatchScore(song, nowPlaying.track) >= 0.5);
  const canUseSpotifyTime = !!(nowPlaying?.connected && nowPlaying.track && spotifyMatches);

  useEffect(() => {
    if (!dirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    rowRefs.current[currentIndex]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [currentIndex]);

  const showToast = useCallback((type: 'success' | 'error', msg: string) => {
    setToast({ type, msg });
    window.setTimeout(() => setToast(null), 2500);
  }, []);

  const selectLine = useCallback((index: number) => {
    setCurrentIndex(Math.max(0, Math.min(lines.length - 1, index)));
  }, [lines.length]);

  const setLineTime = useCallback((index: number, timeMs: number | null, advance = false) => {
    const previousTime = lines[index]?.timeMs ?? null;
    setHistory((items) => [...items.slice(-49), { index, previousTime }]);
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
    const entry = history[history.length - 1];
    if (!entry) return;
    setLines((current) => current.map((line, index) => index === entry.index
      ? { ...line, timeMs: entry.previousTime }
      : line));
    setCurrentIndex(entry.index);
    setHistory((current) => current.slice(0, -1));
  }, [history]);

  const applyOffset = (offsetMs: number) => {
    if (!Number.isFinite(offsetMs) || offsetMs === 0) return;
    setLines((current) => current.map((line) => ({
      ...line,
      timeMs: line.timeMs == null ? null : Math.max(0, Math.round(line.timeMs + offsetMs)),
    })));
    setOffsetDraft('0');
  };

  const resetDraft = () => {
    if (!song) return;
    const draft = createTimelineDraft(song.lyrics_raw || '', song.lyrics_synced || '');
    setLines(draft);
    setHistory([]);
    const firstUnmarked = draft.findIndex((line) => line.timeMs == null);
    setCurrentIndex(firstUnmarked >= 0 ? firstUnmarked : 0);
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
    setSaving(true);
    try {
      const response = await fetch(`/api/songs/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lyrics_synced: serializeTimelineDraft(lines) }),
      });
      if (!response.ok) throw new Error('save_failed');
      const updated = await response.json() as TimelineSong;
      const nextDraft = createTimelineDraft(updated.lyrics_raw || song.lyrics_raw, updated.lyrics_synced || '');
      const nextSerialized = serializeTimelineDraft(nextDraft);
      setSong(updated);
      setLines(nextDraft);
      setInitialDraft(nextSerialized);
      setHistory([]);
      showToast('success', markedCount === lines.length
        ? t('timelineWorkspace.savedComplete')
        : t('timelineWorkspace.savedProgress', { marked: String(markedCount), total: String(lines.length) }));
    } catch {
      showToast('error', t('timelineWorkspace.saveFailed'));
    } finally {
      setSaving(false);
    }
  }, [id, lines, markedCount, showToast, song, t]);

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
    if (dirty) setConfirmLeave(true);
    else router.push(`/songs/${id}`);
  };

  if (loading) {
    return <div className="mx-auto max-w-6xl animate-pulse space-y-5 py-8"><div className="h-8 w-64 rounded bg-[var(--muted)]" /><div className="h-36 rounded-xl bg-[var(--muted)]" /><div className="h-[55vh] rounded-xl bg-[var(--muted)]" /></div>;
  }

  if (error || !song) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-4 py-24 text-center">
        <AlertTriangle className="h-8 w-8 text-[var(--warning)]" />
        <p className="text-sm text-[var(--muted-foreground)]">{error || t('timelineWorkspace.loadFailed')}</p>
        <Link href={`/songs/${id}`} className="song-editor-primary-button rounded-md px-4 py-2 text-sm">{t('timelineWorkspace.backToSong')}</Link>
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
          <button type="button" onClick={resetDraft} disabled={!dirty} className="song-accent-button inline-flex h-9 items-center gap-2 rounded-md px-3 text-xs font-medium disabled:opacity-40">
            <RotateCcw className="h-4 w-4" />{t('timelineWorkspace.reset')}
          </button>
          <button type="button" onClick={save} disabled={saving || !dirty} className="song-editor-primary-button inline-flex h-9 items-center gap-2 rounded-md px-4 text-xs font-medium disabled:opacity-40">
            {saving ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <Save className="h-4 w-4" />}
            {saving ? t('timeline.saving') : t('timelineWorkspace.saveProgress')}
          </button>
        </div>
      </header>

      <section className="mb-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${canUseSpotifyTime ? 'bg-[var(--success)]/15 text-[var(--success)]' : 'bg-[var(--muted)] text-[var(--muted-foreground)]'}`}>
                <Headphones className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{nowPlaying?.track?.name || t('timelineWorkspace.spotifyIdle')}</div>
                <div className="truncate text-xs text-[var(--muted-foreground)]">{nowPlaying?.track?.artist || t('timelineWorkspace.spotifyHint')}</div>
              </div>
            </div>
            <div className="font-mono text-xl font-semibold tabular-nums">{fmtMs(liveProgress)}</div>
          </div>
          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-[var(--muted)]">
            <div className="h-full rounded-full bg-[var(--song-accent)] transition-[width] duration-200" style={{ width: `${nowPlaying?.duration_ms ? Math.min(100, liveProgress / nowPlaying.duration_ms * 100) : 0}%` }} />
          </div>
          <div className="mt-2 flex justify-between text-[10px] text-[var(--muted-foreground)] tabular-nums">
            <span>{fmtTime(liveProgress)}</span><span>{fmtTime(nowPlaying?.duration_ms || 0)}</span>
          </div>
          {nowPlaying?.track && !spotifyMatches && (
            <div className="mt-3 flex items-start gap-2 rounded-md bg-[var(--warning)]/10 px-3 py-2 text-xs text-[var(--warning)]">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{t('timelineWorkspace.trackMismatch')}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <div className="flex items-end justify-between gap-3">
            <div><div className="text-xs text-[var(--muted-foreground)]">{t('timelineWorkspace.progress')}</div><div className="mt-1 text-2xl font-semibold tabular-nums">{markedCount}<span className="text-sm font-normal text-[var(--muted-foreground)]"> / {lines.length}</span></div></div>
            <div className="text-sm font-medium text-[var(--song-accent)]">{progressPercent}%</div>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--muted)]"><div className="h-full rounded-full bg-[var(--song-accent)]" style={{ width: `${progressPercent}%` }} /></div>
          <p className="mt-3 text-[11px] leading-relaxed text-[var(--muted-foreground)]">{t('timelineWorkspace.autoAdvanceHint')}</p>
        </div>
      </section>

      <section className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 sm:p-5">
        <div className="grid items-center gap-4 md:grid-cols-[40px_minmax(0,1fr)_40px]">
          <button type="button" onClick={() => selectLine(currentIndex - 1)} disabled={currentIndex === 0} className="hidden h-10 w-10 items-center justify-center rounded-md text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)] disabled:opacity-30 md:flex" aria-label={t('timelineWorkspace.previousLine')}><ChevronUp className="h-5 w-5" /></button>
          <div className="min-w-0 text-center">
            <div className="mb-2 text-[10px] font-medium text-[var(--muted-foreground)]">{t('timelineWorkspace.currentLine', { current: String(currentIndex + 1), total: String(lines.length) })}</div>
            <div className="text-lg font-medium leading-relaxed sm:text-2xl">{currentLine?.text}</div>
            <div className="mt-2 font-mono text-xs text-[var(--muted-foreground)]">{currentLine?.timeMs == null ? t('timelineWorkspace.unmarked') : fmtMs(currentLine.timeMs)}</div>
          </div>
          <button type="button" onClick={() => selectLine(currentIndex + 1)} disabled={currentIndex >= lines.length - 1} className="hidden h-10 w-10 items-center justify-center rounded-md text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)] disabled:opacity-30 md:flex" aria-label={t('timelineWorkspace.nextLine')}><ChevronDown className="h-5 w-5" /></button>
        </div>
        <button type="button" onClick={markCurrentLine} disabled={!canUseSpotifyTime} className="song-editor-primary-button mx-auto mt-5 flex min-h-12 w-full max-w-md items-center justify-center gap-2 rounded-lg px-5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40">
          <LocateFixed className="h-5 w-5" />
          {canUseSpotifyTime ? t('timelineWorkspace.markAt', { time: fmtMs(liveProgress) }) : t('timelineWorkspace.waitingSpotify')}
        </button>
        <div className="mt-3 flex items-center justify-center gap-4 text-[10px] text-[var(--muted-foreground)]">
          <span>{t('timelineWorkspace.shortcutMark')}</span><span>{t('timelineWorkspace.shortcutNavigate')}</span><span>{t('timelineWorkspace.shortcutSave')}</span>
        </div>
      </section>

      <section className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
        <span className="mr-1 text-xs font-medium text-[var(--muted-foreground)]">{t('timeline.offset')}</span>
        {[-500, -100, 100, 500].map((offset) => (
          <button key={offset} type="button" onClick={() => applyOffset(offset)} className="song-accent-button inline-flex h-8 items-center rounded-md px-2.5 text-[11px] tabular-nums">
            {offset > 0 ? <Plus className="mr-1 h-3 w-3" /> : <Minus className="mr-1 h-3 w-3" />}{Math.abs(offset)}ms
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1">
          <input type="number" step="10" value={offsetDraft} onChange={(event) => setOffsetDraft(event.target.value)} className="h-8 w-24 rounded-md border border-[var(--border)] bg-[var(--input)] px-2 text-xs tabular-nums outline-none focus:border-[var(--song-accent)]" aria-label={t('timeline.customOffset')} />
          <button type="button" onClick={() => applyOffset(Number(offsetDraft))} className="song-accent-button h-8 rounded-md px-3 text-xs">{t('timeline.apply')}</button>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)]">
        <div className="border-b border-[var(--border)] px-4 py-3">
          <h2 className="text-sm font-medium">{t('timelineWorkspace.lyricLines')}</h2>
          <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">{t('timelineWorkspace.listHint')}</p>
        </div>
        <div className="max-h-[58vh] overflow-y-auto p-2 sm:p-3">
          {lines.map((line, index) => {
            const selected = index === currentIndex;
            return (
              <div key={`${index}-${line.text}`} ref={(element) => { rowRefs.current[index] = element; }} onClick={() => selectLine(index)} className={`mb-1 grid cursor-pointer grid-cols-[28px_minmax(0,1fr)] items-center gap-2 rounded-lg border px-2 py-2 transition-colors sm:grid-cols-[32px_112px_minmax(0,1fr)_72px] sm:gap-3 sm:px-3 ${selected ? 'border-[var(--song-accent)] bg-[var(--song-accent)]/8' : 'border-transparent hover:bg-[var(--accent)]'}`}>
                <div className="flex justify-center">{line.timeMs == null ? <Circle className="h-4 w-4 text-[var(--muted-foreground)]/50" /> : <CheckCircle2 className="h-4 w-4 text-[var(--success)]" />}</div>
                <div className="hidden sm:block">
                  <input key={`${index}-${line.timeMs ?? 'empty'}`} defaultValue={line.timeMs == null ? '' : fmtMs(line.timeMs)} placeholder="--:--.---" onClick={(event) => event.stopPropagation()} onBlur={(event) => {
                    const value = event.currentTarget.value.trim();
                    if (!value) {
                      if (line.timeMs != null) setLineTime(index, null);
                      return;
                    }
                    const parsed = parseLrcTimestamp(value);
                    if (parsed != null) setLineTime(index, parsed);
                    else event.currentTarget.value = line.timeMs == null ? '' : fmtMs(line.timeMs);
                  }} className="h-8 w-full rounded-md border border-[var(--border)] bg-[var(--input)] px-2 font-mono text-[11px] tabular-nums outline-none focus:border-[var(--song-accent)]" aria-label={t('timeline.timestamp', { line: String(index + 1) })} />
                </div>
                <div className="min-w-0">
                  <div className={`truncate text-sm ${selected ? 'font-medium text-[var(--foreground)]' : 'text-[var(--muted-foreground)]'}`}>{line.text}</div>
                  <div className="mt-0.5 font-mono text-[10px] text-[var(--muted-foreground)] sm:hidden">{line.timeMs == null ? t('timelineWorkspace.unmarked') : fmtMs(line.timeMs)}</div>
                </div>
                <div className="flex justify-end gap-1">
                  {line.timeMs != null && (
                    <button type="button" onClick={(event) => { event.stopPropagation(); seekSpotify(line.timeMs!); }} disabled={!nowPlaying?.connected} className="rounded-md p-2 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)] disabled:opacity-30" aria-label={t('timelineWorkspace.seekToLine')} title={t('timelineWorkspace.seekToLine')}><Headphones className="h-3.5 w-3.5" /></button>
                  )}
                  <button type="button" onClick={(event) => { event.stopPropagation(); setLineTime(index, null); }} disabled={line.timeMs == null} className="rounded-md p-2 text-[var(--muted-foreground)] hover:bg-[var(--destructive)]/10 hover:text-[var(--destructive)] disabled:opacity-20" aria-label={t('timelineWorkspace.clearTime')} title={t('timelineWorkspace.clearTime')}><Eraser className="h-3.5 w-3.5" /></button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <div className="sticky bottom-3 mt-4 flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--background)]/95 p-3 shadow-lg backdrop-blur">
        <div className="min-w-0 text-xs text-[var(--muted-foreground)]">
          {dirty ? t('timelineWorkspace.unsavedStatus') : t('timelineWorkspace.savedStatus')}
        </div>
        <button type="button" onClick={save} disabled={saving || !dirty} className="song-editor-primary-button inline-flex h-9 shrink-0 items-center gap-2 rounded-md px-4 text-xs font-medium disabled:opacity-40">
          {saving ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : dirty ? <Save className="h-4 w-4" /> : <Check className="h-4 w-4" />}
          {saving ? t('timeline.saving') : t('timelineWorkspace.saveProgress')}
        </button>
      </div>

      {toast && <Toast type={toast.type} message={toast.msg} />}
      <ConfirmDialog open={confirmLeave} title={t('timeline.unsavedTitle')} body={t('timeline.unsavedBody')} confirmLabel={t('timeline.discard')} cancelLabel={t('common.cancel')} variant="danger" onConfirm={() => router.push(`/songs/${id}`)} onCancel={() => setConfirmLeave(false)} />
    </div>
  );
}
