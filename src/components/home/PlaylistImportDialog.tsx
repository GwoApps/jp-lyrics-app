'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Loader2, AlertTriangle, X } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { useModalFocus } from '@/hooks/useModalFocus';
import { importErrorMsg } from '@/lib/import-errors';
import type { SongItem } from '@/lib/types';
import ConfirmDialog from '@/components/ConfirmDialog';
import Toast from '@/components/Toast';

interface PlaylistImportDialogProps {
  open: boolean;
  /** Fired with the refreshed song list after a successful import. */
  onImported: (songs: SongItem[]) => void;
  /** Fired when the user dismisses the dialog (backdrop click, Escape, Cancel/Close). */
  onClose: () => void;
}

interface PlaylistTrackResult {
  spotifyId?: string;
  title: string;
  artist: string;
  status: 'imported' | 'skipped' | 'failed';
  needsReview?: boolean;
  rateLimited?: boolean;
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

function readResumeState(): ResumeState | null {
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(RESUME_KEY);
    return raw ? (JSON.parse(raw) as ResumeState) : null;
  } catch { /* storage unavailable */ }
  return null;
}

/**
 * Spotify playlist URL importer, shown as a modal dialog.
 *
 * Two phases, both inside the same dialog:
 *   1. confirm — paste the playlist URL and press Import;
 *   2. progress — live per-track progress, counts, cancel, and (on success) the
 *      summary plus the low-confidence review list.
 *
 * Imports run as a series of short chunked requests (`POST` creates a job,
 * repeated `PUT`s process one chunk each), so the progress stays live without a
 * long-lived connection. An interrupted import can be resumed from localStorage
 * (a timed-out / crashed / refreshed page is not lost).
 *
 * While a chunk loop is running the dialog cannot be dismissed (backdrop click
 * or Escape) — the progress must stay visible and the user leaves through
 * Cancel, which also tells the server to stop the job.
 */
export default function PlaylistImportDialog({ open, onImported, onClose }: PlaylistImportDialogProps) {
  const { t } = useI18n();
  const [url, setUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [job, setJob] = useState<JobSummary | null>(null);
  const [currentTitle, setCurrentTitle] = useState('');
  const [result, setResult] = useState<PlaylistTrackResult[]>([]);
  const [resumeState, setResumeState] = useState<ResumeState | null>(readResumeState);
  const [alert, setAlert] = useState<{ message: string } | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const cancelRef = useRef(false);
  const titleId = useId();
  const hintId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);

  /**
   * Close the dialog and drop the transient import state, so reopening always
   * starts from a clean confirm form (an unfinished import survives through the
   * localStorage resume state instead).
   *
   * Mid-import this is a no-op: the running progress must stay on screen until
   * the user cancels it explicitly — so backdrop click and Escape do nothing.
   */
  const handleClose = useCallback(() => {
    if (importing) return;
    setUrl('');
    setJob(null);
    setResult([]);
    setCurrentTitle('');
    onClose();
  }, [importing, onClose]);

  useModalFocus({ open, dialogRef, initialFocusRef: urlInputRef, onEscape: handleClose });

  // The import summary toast is transient, matching the other copy/import paths.
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

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
  const rateLimitedTracks = result.filter((track) => track.rateLimited) ?? [];
  const isDone = job?.status === 'completed';
  const isCancelled = job?.status === 'cancelled';
  /** Confirm form vs. progress/summary view. */
  const showProgress = importing || isDone || isCancelled;
  const percent = job && job.total > 0 ? Math.round((job.processed / job.total) * 100) : 0;

  return (
    <>
      {open && (
        <div className="confirm-overlay" onClick={handleClose}>
          <div
            className="import-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            ref={dialogRef}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div id={titleId} className="import-dialog-title">
              {t('home.playlistImportTitle')}
            </div>

            {!showProgress && (
              <>
                <p id={hintId} className="import-dialog-hint">{t('home.playlistImportHint')}</p>
                <input
                  ref={urlInputRef}
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void handleImport(); }}
                  placeholder={t('home.playlistUrlPlaceholder')}
                  aria-label={t('home.playlistImportTitle')}
                  aria-describedby={hintId}
                  className="import-dialog-input"
                  disabled={importing}
                />

                {resumeState && (
                  <div className="import-dialog-note">
                    <span className="import-dialog-note-text">
                      {t('home.playlistImportResumeHint', { total: String(resumeState.total), processed: String(resumeState.processed) })}
                    </span>
                    <div className="import-dialog-note-actions">
                      <button
                        type="button"
                        className="confirm-dialog-btn confirm-dialog-btn--confirm"
                        onClick={() => void handleResume()}
                      >
                        {t('home.playlistImportResume')}
                      </button>
                      <button
                        type="button"
                        className="confirm-dialog-btn confirm-dialog-btn--cancel"
                        onClick={() => { persistResume(null); setResumeState(null); }}
                      >
                        {t('common.clear')}
                      </button>
                    </div>
                  </div>
                )}

                <div className="confirm-dialog-actions import-dialog-actions">
                  <button
                    type="button"
                    className="confirm-dialog-btn confirm-dialog-btn--cancel"
                    onClick={handleClose}
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    type="button"
                    className="confirm-dialog-btn confirm-dialog-btn--confirm"
                    onClick={() => void handleImport()}
                    disabled={importing || !url.trim()}
                  >
                    {t('home.playlistImportBtn')}
                  </button>
                </div>
              </>
            )}

            {showProgress && job && (
              <>
                <div className="import-dialog-progress">
                  <div className="import-dialog-status">
                    {importing ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                        <span className="truncate">
                          {currentTitle
                            ? `${currentTitle}${t('home.playlistImportProcessingSuffix')}`
                            : t('home.playlistImportPreparing')}
                        </span>
                      </>
                    ) : (
                      <span>{isCancelled ? t('home.playlistImportCancelled') : t('home.playlistImportResult', {
                        total: String(job.total),
                        imported: String(job.imported),
                        skipped: String(job.skipped),
                        failed: String(job.failed),
                      })}</span>
                    )}
                  </div>

                  <div className="import-dialog-bar">
                    <div
                      className="import-dialog-bar-track"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={job.total}
                      aria-valuenow={job.processed}
                      aria-label={t('home.playlistImportTitle')}
                    >
                      <div className="import-dialog-bar-fill" style={{ width: `${percent}%` }} />
                    </div>
                    <span className="import-dialog-count">{job.processed}/{job.total}</span>
                  </div>

                  {importing && (
                    <div className="import-dialog-summary">
                      {t('home.playlistImportResult', {
                        total: String(job.total),
                        imported: String(job.imported),
                        skipped: String(job.skipped),
                        failed: String(job.failed),
                      })}
                    </div>
                  )}

                  {isDone && reviewTracks.length > 0 && (
                    <div className="import-dialog-note import-dialog-note--stacked">
                      <div className="import-dialog-note-title">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        <span>{t('home.playlistImportReviewHeader', { count: String(reviewTracks.length) })}</span>
                      </div>
                      <ul className="import-dialog-list">
                        {reviewTracks.map((track, index) => (
                          <li key={`${track.title}-${index}`} className="truncate">
                            {track.title}{track.artist ? ` — ${track.artist}` : ''}
                          </li>
                        ))}
                      </ul>
                      <p className="import-dialog-note-text">{t('home.playlistImportReviewHint')}</p>
                    </div>
                  )}

                  {isDone && rateLimitedTracks.length > 0 && (
                    <div className="import-dialog-note import-dialog-note--stacked">
                      <span className="import-dialog-note-text">{t('home.playlistImportRateLimited')}</span>
                    </div>
                  )}
                </div>

                <div className="confirm-dialog-actions import-dialog-actions">
                  {importing ? (
                    <button
                      type="button"
                      className="confirm-dialog-btn confirm-dialog-btn--cancel"
                      onClick={() => void handleCancel()}
                    >
                      <X className="h-3 w-3" />
                      {t('home.playlistImportCancel')}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="confirm-dialog-btn confirm-dialog-btn--confirm"
                      onClick={handleClose}
                    >
                      {t('common.close')}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
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
