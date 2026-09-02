import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SongData } from '@/lib/types';
import type { ImportAlertState, ImportReviewState } from './models';
import type { SyncStage } from '@/lib/lyrics-fetcher';
import type { ProviderStage } from '@/lib/lyrics-provider/types';
import { readSyncEventStream } from '@/lib/sync-sse-reader';
import { parseLrc } from '@/lib/lrc';
import { LYRICS_SOURCE_KEYS } from '@/lib/lyrics-source';

interface UseSyncDeps {
  id: string;
  song: SongData | null;
  setSong: React.Dispatch<React.SetStateAction<SongData | null>>;
  setImportAlert: React.Dispatch<React.SetStateAction<ImportAlertState | null>>;
  fetchSong: () => Promise<{ data?: SongData; notFound?: boolean }>;
  applySongResult: (result: { data?: SongData; notFound?: boolean }) => void;
  showToast: (type: 'success' | 'error' | 'info', msg: string, actionLabel?: string, onAction?: () => void) => void;
  t: (key: string, params?: Record<string, string>) => string;
}

interface UseSyncReturn {
  syncLines: ReturnType<typeof parseLrc>;
  syncing: boolean;
  syncStage: SyncStage | ProviderStage | null;
  lowConfidenceSync: { source: string; confidence: number; lines: number; lrc: string; candidate: string; match?: ImportReviewState['match'] } | null;
  confirmLowConfidenceSync: () => Promise<void>;
  cancelLowConfidenceSync: () => void;
  plainHitSync: { source: string; confidence: number; plain: string; candidate: string; match?: ImportReviewState['match'] } | null;
  confirmPlainSync: () => Promise<void>;
  cancelPlainSync: () => void;
  handleSync: () => Promise<void>;
  cancelSync: () => void;
}

/**
 * Sub-hook: lyrics sync workflow (multi-source fetch, low-confidence / plain-text
 * confirmation, cancel). Owns all sync state; writes to `song` only via the
 * orchestrator-injected `setSong` and re-loads via `fetchSong`/`applySongResult`.
 */
export function useSync(deps: UseSyncDeps): UseSyncReturn {
  const { id, song, setSong, setImportAlert, fetchSong, applySongResult, showToast, t } = deps;

  const syncLines = useMemo<ReturnType<typeof parseLrc>>(() => {
    if (!song?.lyrics_synced) return [];
    return parseLrc(song.lyrics_synced);
  }, [song]);
  const [syncing, setSyncing] = useState(false);
  const [syncStage, setSyncStage] = useState<SyncStage | ProviderStage | null>(null);
  // Tracks the in-flight sync request so the user can cancel a long
  // multi-source fetch (or stop an accidental one) without reloading, and so
  // the request is aborted when the component unmounts.
  const syncAbortRef = useRef<AbortController | null>(null);
  // Pending fuzzy-search sync result waiting for explicit user confirmation
  // (server refuses to overwrite lyrics below the confidence threshold).
  const [lowConfidenceSync, setLowConfidenceSync] = useState<{
    source: string;
    confidence: number;
    lines: number;
    lrc: string;
    candidate: string;
    match?: ImportReviewState['match'];
  } | null>(null);
  // Pending plain-text sync result (no LRC timeline) waiting for explicit user
  // confirmation (server refuses to overwrite lyrics/timeline without it).
  const [plainHitSync, setPlainHitSync] = useState<{
    source: string;
    confidence: number;
    plain: string;
    candidate: string;
    match?: ImportReviewState['match'];
  } | null>(null);

  // Handlers
  const applySyncResult = useCallback(async (data: {
    source: string;
    lines: number;
    lrc: string;
  }) => {
    const songRes = await fetch(`/api/songs/${id}`);
    if (songRes.ok) {
      const updated = await songRes.json();
      setSong(updated);
    }
    const sourceKey = LYRICS_SOURCE_KEYS[data.source];
    showToast('success', t('song.synced', {
      source: sourceKey ? t(sourceKey) : data.source,
      lines: String(data.lines),
    }));
  }, [id, t, showToast, setSong]);

  const runSync = useCallback(async (force: boolean, confirmPlain = false) => {
    const controller = new AbortController();
    syncAbortRef.current = controller;
    setSyncing(true);
    setSyncStage(null);
    try {
      const res = await fetch(`/api/songs/${id}/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Ask the server to stream per-source progress over SSE so the UI can
          // show "正在查询 LRCLIB…" etc. instead of a frozen spinner.
          Accept: 'text/event-stream',
        },
        // The cancel button aborts this fetch; the request (and the server-side
        // fetch chain behind it) stops mid-way. No write has happened yet, so
        // cancelling has zero side effects.
        signal: controller.signal,
        body: JSON.stringify({
          force,
          confirmPlain,
          // Snapshot of the lyrics this request is based on. The server
          // refuses (409 stale_source) when they changed in another tab
          // while the fetch was in flight — a slow sync must never silently
          // clobber newer lyrics (and wipe furigana/translation with them).
          source_lyrics: song?.lyrics_raw ?? '',
        }),
      });
      const { status, body: data } = await readSyncEventStream(res, (stage) => setSyncStage(stage));
      // Fuzzy search below the confidence threshold: the server keeps the
      // current lyrics untouched — ask before overriding (furigana and
      // translation would be reset too).
      if (data.lowConfidence) {
        setLowConfidenceSync({
          source: data.source,
          confidence: data.confidence,
          lines: data.lines,
          lrc: data.lrc,
          candidate: data.candidate,
          match: data.match,
        });
        return;
      }
      // Plain-text hit (no LRC timeline): nothing was written yet — ask the
      // user whether to replace the current lyrics with this plain text.
      if (data.plainHit) {
        setPlainHitSync({
          source: data.source,
          confidence: data.confidence,
          plain: data.plain,
          candidate: data.candidate,
          match: data.match,
        });
        return;
      }
      // Confirmed plain-text overwrite succeeded (no timeline remains).
      if (data.plainUpdated) {
        const updated = await fetch(`/api/songs/${id}`, { cache: 'no-store' });
        if (updated.ok) setSong(await updated.json());
        const sourceKey = LYRICS_SOURCE_KEYS[data.source];
        showToast('success', t('song.plainUpdated', {
          source: sourceKey ? t(sourceKey) : data.source,
        }));
        return;
      }
      if (data.synced) {
        await applySyncResult(data);
      } else {
        // Mid-fetch failure surfaced over SSE (or a stale/non-2xx result).
        if (data.error === 'network_error' || status >= 500) {
          setImportAlert({ message: t('song.networkErrorAlert') });
          return;
        }
        const errorKey: Record<string, string> = {
          lyrics_not_found: 'apiErrors.lyricsNotFound',
          lyrics_rate_limited: 'apiErrors.lyricsRateLimited',
          forbidden: 'apiErrors.forbidden',
          login_required: 'apiErrors.loginRequired',
          stale_source: 'song.syncStale',
        };
        const message = data.error && errorKey[data.error]
          ? t(errorKey[data.error])
          : t('song.syncNotFound');
        setImportAlert({ message });
        if (data.error === 'stale_source') {
          // Another tab saved different lyrics while this sync was in flight —
          // the server wrote nothing. Re-fetch so the user sees the current
          // lyrics instead of their stale baseline.
          void fetchSong().then(applySongResult);
        }
      }
    } catch {
      // Cancelling is expected — a clean stop, not a network failure.
      if (!controller.signal.aborted) {
        setImportAlert({ message: t('song.networkErrorAlert') });
      }
    } finally {
      setSyncing(false);
      setSyncStage(null);
      if (syncAbortRef.current === controller) syncAbortRef.current = null;
    }
  }, [id, t, showToast, applySyncResult, song, fetchSong, applySongResult, setImportAlert, setSong]);

  const handleSync = useCallback(() => runSync(false), [runSync]);

  /** Abort the in-flight sync fetch (cancel button on the sync progress line). */
  const cancelSync = useCallback(() => {
    syncAbortRef.current?.abort();
  }, []);

  // Abort any in-flight sync when the component unmounts so a slow server-side
  // fetch chain never keeps running after the user leaves the page (issue #129).
  useEffect(() => () => { syncAbortRef.current?.abort(); }, []);

  // Confirm a low-confidence candidate by echoing back the signed token the
  // server issued during the preview. The server writes EXACTLY the reviewed
  // content — it does not re-fetch, so a changing upstream can never swap in a
  // different candidate after the user confirmed (fixes the TOCTOU).
  const confirmLowConfidenceSync = useCallback(async () => {
    if (!lowConfidenceSync?.candidate) return;
    const token = lowConfidenceSync.candidate;
    setLowConfidenceSync(null);
    setSyncing(true);
    try {
      const res = await fetch(`/api/songs/${id}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidate: token }),
      });
      const data = await res.json();
      if (res.status === 409 && (data.error === 'candidate_expired' || data.error === 'candidate_invalid' || data.error === 'stale_source')) {
        setImportAlert({ message: t('song.candidateExpired') });
        return;
      }
      if (data.synced) {
        await applySyncResult(data);
      } else {
        setImportAlert({ message: t('song.syncNotFound') });
      }
    } catch {
      setImportAlert({ message: t('song.networkErrorAlert') });
    } finally {
      setSyncing(false);
    }
  }, [id, t, lowConfidenceSync, applySyncResult, setImportAlert]);

  const cancelLowConfidenceSync = useCallback(() => setLowConfidenceSync(null), []);

  // Confirm a plain-text candidate via its signed token (same guarantee as the
  // low-confidence flow — the server writes the reviewed content atomically).
  const confirmPlainSync = useCallback(async () => {
    if (!plainHitSync?.candidate) return;
    const token = plainHitSync.candidate;
    setPlainHitSync(null);
    setSyncing(true);
    try {
      const res = await fetch(`/api/songs/${id}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidate: token }),
      });
      const data = await res.json();
      if (res.status === 409 && (data.error === 'candidate_expired' || data.error === 'candidate_invalid' || data.error === 'stale_source')) {
        setImportAlert({ message: t('song.candidateExpired') });
        return;
      }
      // Confirmed plain-text overwrite succeeded (no timeline remains).
      if (data.plainUpdated) {
        const updated = await fetch(`/api/songs/${id}`, { cache: 'no-store' });
        if (updated.ok) setSong(await updated.json());
        const sourceKey = LYRICS_SOURCE_KEYS[data.source];
        showToast('success', t('song.plainUpdated', {
          source: sourceKey ? t(sourceKey) : data.source,
        }));
        return;
      }
      if (data.synced) {
        await applySyncResult(data);
      } else {
        setImportAlert({ message: t('song.syncNotFound') });
      }
    } catch {
      setImportAlert({ message: t('song.networkErrorAlert') });
    } finally {
      setSyncing(false);
    }
  }, [id, t, plainHitSync, applySyncResult, showToast, setImportAlert, setSong]);

  const cancelPlainSync = useCallback(() => setPlainHitSync(null), []);
  return {
    syncLines,
    syncing,
    syncStage,
    lowConfidenceSync,
    confirmLowConfidenceSync,
    cancelLowConfidenceSync,
    plainHitSync,
    confirmPlainSync,
    cancelPlainSync,
    handleSync,
    cancelSync,
  };
}
