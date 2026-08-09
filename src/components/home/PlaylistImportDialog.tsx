'use client';

import { useCallback, useRef, useState } from 'react';
import { Download, Loader2, AlertTriangle, X } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { importErrorMsg } from '@/lib/import-errors';
import type { SongItem } from '@/lib/types';
import ConfirmDialog from '@/components/ConfirmDialog';
import Toast from '@/components/Toast';

interface PlaylistImportDialogProps {
  open: boolean;
  onClose: () => void;
  /** Fired with the refreshed song list after a successful import. */
  onImported: (songs: SongItem[]) => void;
}

interface PlaylistTrackResult {
  spotifyId?: string;
  title: string;
  artist: string;
  status: 'imported' | 'skipped' | 'failed';
  needsReview?: boolean;
}

interface JobSummary {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  total: number;
  processed: number;
  imported: number;
  skipped: number;
  failed: number;
}

interface ChunkResponse {
  job: JobSummary;
  tracks: PlaylistTrackResult[];
  nextOffset: number;
  done: boolean;
}

/** Local-storage key so a page refresh can resume an unfinished import. */
const RESUME_KEY = 'jplrc-playlist-import-resume';

interface ResumeState {
  jobId: string;
  total: number;
  offset: number;
  processed: number;
}

/**
 * Spotify playlist URL importer.
 *
 * Imports run as a series of short chunked requests (`POST` creates a job,
 * repeated `PUT`s process one chunk each). The dialog shows live per-track
 * progress, supports cancel, and can resume an interrupted import from
 * localStorage (a timed-out / crashed / refreshed page is not lost).
 */
export default function PlaylistImportDialog({ open, onClose, onImported }: PlaylistImportDialogProps) {
  const { t } = useI18n();
  const [url, setUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [job, setJob] = useState<JobSummary | null>(null);
  const [currentTitle, setCurrentTitle] = useState('');
  const [result, setResult] = useState<PlaylistTrackResult[]>([]);
  const [resumeState, setResumeState] = useState<ResumeState | null>(() => {
    try {
      if (typeof window === 'undefined') return null;
      const raw = window.localStorage.getItem(RESUME_KEY);
      return raw ? (JSON.parse(raw) as ResumeState) : null;
    } catch { /* storage unavailable */ }
    return null;
  });
  const [alert, setAlert] = useState<{ message: string } | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const cancelRef = useRef(false);

  const persistResume = useCallback((state: ResumeState | null) => {
    try {
      if (state) localStorage.setItem(RESUME_KEY, JSON.stringify(state));
      else localStorage.removeItem(RESUME_KEY);
    } catch { /* storage unavailable */ }
  }, []);

  const refreshSongList = useCallback(async () => {
    try {
      const songsRes = await fetch('/api/songs');
      if (songsRes.ok) {
        const songs = await songsRes.json() as SongItem[];
        onImported(songs);
      }
    } catch { /* refresh failure is non-fatal — the dialog still shows the summary */ }
  }, [onImported]);

  const finishImport = useCallback(async (finalJob: JobSummary | null, accumulated: PlaylistTrackResult[]) => {
    setImporting(false);
    cancelRef.current = false;
    persistResume(null);
    setResumeState(null);
    if (finalJob) setJob(finalJob);
    if (accumulated.length > 0) setResult(accumulated);
    if (finalJob?.status === 'completed') {
      await refreshSongList();
    }
  }, [persistResume, refreshSongList]);

  /** Process chunks until the job completes or the user cancels. */
  const runImport = useCallback(async (jobId: string, total: number, startOffset: number, seedResults: PlaylistTrackResult[] = []) => {
    let offset = startOffset;
    const accumulated: PlaylistTrackResult[] = [...seedResults];
    let lastSummary: JobSummary | null = null;
    let retries = 0;
    let finished = false;

    setResult([...accumulated]);
    while (!cancelRef.current && !finished) {
      // Keep the resume cursor fresh so a crash mid-loop is resumable.
      const processed = Math.min(offset, total);
      persistResume({ jobId, total, offset, processed });

      let response: Response;
      try {
        response = await fetch('/api/songs/import-playlist', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jobId, offset }),
        });
      } catch {
        // Network / Worker timeout — retry from the same offset after a short
        // backoff. Tracks already saved are skipped server-side (idempotent).
        if (retries < 5) {
          retries += 1;
          await new Promise((r) => setTimeout(r, 1200 * retries));
          continue;
        }
        setAlert({ message: t('home.playlistImportNetworkError') });
        await finishImport(lastSummary, accumulated);
        return;
      }

      const data = await response.json();
      if (response.status === 409) {
        // Job ended server-side — cancelled (e.g. another tab) or failed.
        if (data?.error === 'job_failed') {
          setAlert({ message: t('home.playlistImportJobFailed') });
        } else {
          setToast({ type: 'error', msg: t('home.playlistImportCancelled') });
        }
        await finishImport(null, accumulated);
        return;
      }
      if (!response.ok || data.error) {
        setAlert({ message: importErrorMsg(t, data.error, 'home.playlistImportError') });
        await finishImport(null, accumulated);
        return;
      }

      const chunk = data as ChunkResponse;
      retries = 0;
      if (cancelRef.current) break; // cancelled while this request was in flight
      lastSummary = chunk.job;
      setJob(chunk.job);
      if (chunk.tracks.length > 0) {
        // Merge by Spotify track id — a timed-out chunk can replay already-done
        // tracks, so pushing blindly would double-count them on the client.
        const seen = new Set(accumulated.map((tr) => tr.spotifyId).filter(Boolean));
        for (const tr of chunk.tracks) {
          if (tr.spotifyId && seen.has(tr.spotifyId)) continue;
          accumulated.push(tr);
          if (tr.spotifyId) seen.add(tr.spotifyId);
        }
        setResult([...accumulated]);
        const lastTrack = chunk.tracks[chunk.tracks.length - 1];
        setCurrentTitle(lastTrack.title);
      }
      offset = chunk.nextOffset;
      finished = chunk.done;
    }

    if (cancelRef.current) {
      // Cancel request already fired in handleCancel; keep the partial summary.
      return;
    }
    await finishImport(lastSummary, accumulated);
  }, [finishImport, persistResume, t]);

  const handleImport = async () => {
    if (!url.trim() || importing) return;
    setImporting(true);
    setJob(null);
    setCurrentTitle('');
    cancelRef.current = false;
    try {
      const res = await fetch('/api/songs/import-playlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playlistUrl: url.trim() }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setAlert({ message: importErrorMsg(t, data.error, 'home.playlistImportError') });
        setImporting(false);
        return;
      }
      const created = data.job as JobSummary;
      setJob(created);
      setImporting(true);
      void runImport(created.id, created.total, 0);
    } catch {
      setToast({ type: 'error', msg: t('home.playlistImportFailed') });
      setImporting(false);
    }
  };

  const handleResume = async () => {
    if (!resumeState || importing) return;
    setImporting(true);
    cancelRef.current = false;
    // Rebuild the progress list from persisted outcomes before continuing.
    let seeded: PlaylistTrackResult[] = [];
    try {
      const res = await fetch(`/api/songs/import-playlist?jobId=${encodeURIComponent(resumeState.jobId)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.job) setJob(data.job);
        if (Array.isArray(data.tracks)) seeded = data.tracks as PlaylistTrackResult[];
      }
    } catch { /* non-fatal — resume still works */ }
    void runImport(resumeState.jobId, resumeState.total, resumeState.offset, seeded);
  };

  const handleCancel = async () => {
    if (!job) return;
    cancelRef.current = true;
    try {
      await fetch(`/api/songs/import-playlist?jobId=${encodeURIComponent(job.id)}`, { method: 'DELETE' });
      persistResume(null);
      setResumeState(null);
      setJob((prev) => prev ? { ...prev, status: 'cancelled' } : prev);
      setImporting(false);
    } catch {
      // The loop will notice cancelRef and stop anyway.
      setImporting(false);
    }
  };

  const reviewTracks = result.filter((track) => track.needsReview) ?? [];
  const isDone = job?.status === 'completed';
  const isCancelled = job?.status === 'cancelled';

  return (
    <>
      {open && (
        <div className="mb-4 rounded-lg bg-[var(--card)] border border-[var(--border)] p-4">
          <div className="flex items-center gap-2 mb-3">
            <Download className="h-4 w-4 text-[var(--primary)]" />
            <span className="text-sm font-medium">{t('home.playlistImportTitle')}</span>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={t('home.playlistUrlPlaceholder')}
              className="flex-1 rounded-md border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-xs outline-none focus:border-[var(--primary)] transition-colors placeholder:text-[var(--muted-foreground)]/50"
              disabled={importing}
            />
            <button
              onClick={() => void handleImport()}
              disabled={importing || !url.trim()}
              className="inline-flex items-center gap-1.5 rounded-md bg-[var(--primary)] px-4 py-2 text-xs font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              <span>{importing ? t('home.playlistImporting') : t('home.playlistImportBtn')}</span>
            </button>
          </div>

          {!importing && resumeState && !isDone && !isCancelled && (
            <div className="mt-3 rounded-md border border-[var(--border)] bg-[var(--accent)] p-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[var(--muted-foreground)]">
                  {t('home.playlistImportResumeHint', { total: String(resumeState.total), processed: String(resumeState.processed) })}
                </span>
                <div className="flex shrink-0 gap-2">
                  <button
                    onClick={() => void handleResume()}
                    className="rounded-md bg-[var(--primary)] px-2.5 py-1 text-xs font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90"
                  >
                    {t('home.playlistImportResume')}
                  </button>
                  <button
                    onClick={() => { persistResume(null); setResumeState(null); }}
                    className="rounded-md border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                  >
                    {t('common.clear')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {job && (importing || isDone || isCancelled) && (
            <div className="mt-3 text-xs text-[var(--muted-foreground)]">
              {importing && (
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 truncate">
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                    {currentTitle ? (
                      <span className="truncate">
                        {currentTitle}{t('home.playlistImportProcessingSuffix')}
                      </span>
                    ) : t('home.playlistImportPreparing')}
                  </span>
                  <button
                    onClick={() => void handleCancel()}
                    className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[var(--border)] px-2 py-1 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                  >
                    <X className="h-3 w-3" />
                    {t('home.playlistImportCancel')}
                  </button>
                </div>
              )}
              <div className="mt-2 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--border)]">
                  <div
                    className="h-full rounded-full bg-[var(--primary)] transition-all duration-300"
                    style={{ width: `${job.total > 0 ? Math.round((job.processed / job.total) * 100) : 0}%` }}
                  />
                </div>
                <span className="shrink-0 tabular-nums">
                  {job.processed}/{job.total}
                </span>
              </div>
              <div className="mt-2">
                {t('home.playlistImportResult', {
                  total: String(job.total),
                  imported: String(job.imported),
                  skipped: String(job.skipped),
                  failed: String(job.failed),
                })}
              </div>
              {isDone && reviewTracks.length > 0 && (
                <div className="mt-2 rounded-md border border-[var(--border)] bg-[var(--accent)] p-2">
                  <div className="flex items-center gap-1.5 font-medium text-[var(--warning)]">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    <span>{t('home.playlistImportReviewHeader', { count: String(reviewTracks.length) })}</span>
                  </div>
                  <ul className="mt-1.5 max-h-32 space-y-1 overflow-y-auto">
                    {reviewTracks.map((track, index) => (
                      <li key={`${track.title}-${index}`} className="truncate">
                        {track.title}{track.artist ? ` — ${track.artist}` : ''}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1.5 text-[var(--muted-foreground)]">{t('home.playlistImportReviewHint')}</p>
                </div>
              )}
              {isCancelled && (
                <div className="mt-2 text-[var(--muted-foreground)]">{t('home.playlistImportCancelled')}</div>
              )}
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={!!alert}
        title={t('home.importErrorTitle')}
        body={alert?.message}
        confirmLabel={t('common.confirm')}
        alert
        onConfirm={() => setAlert(null)}
        onCancel={() => setAlert(null)}
      />
      {toast && <Toast type={toast.type} message={toast.msg} />}
    </>
  );
}
