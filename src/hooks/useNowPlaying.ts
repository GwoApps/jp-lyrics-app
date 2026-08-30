'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { MAX_CONSECUTIVE_ERRORS, backoffDelay } from '@/lib/retry-backoff';
import { isSpotifyTransientError } from '@/lib/spotify-error';

export interface NowPlayingData {
  connected: boolean;
  is_playing: boolean;
  progress_ms: number;
  duration_ms: number;
  track: { id: string; uri: string; name: string; artist: string; album: string; cover_url?: string | null } | null;
  error?: number;
}

export type SyncState = 'connected' | 'retrying' | 'stopped';

interface DiffMessage {
  seq: number;
  c: number;   // checksum of full data
  d: Partial<NowPlayingData>; // changed fields only
  _full?: boolean; // true when server sends full data
  _sync?: SyncState; // degraded-state flag pushed by the server poller
}

const EMPTY: NowPlayingData = { connected: false, is_playing: false, progress_ms: 0, duration_ms: 0, track: null };

/** Fast 32-bit hash — must match server */
function computeChecksum(data: NowPlayingData): number {
  const s = `${data.progress_ms}|${data.is_playing}|${data.track?.id ?? ''}|${data.track?.uri ?? ''}|${data.track?.name ?? ''}|${data.track?.artist ?? ''}|${data.track?.album ?? ''}|${data.track?.cover_url ?? ''}|${data.duration_ms}|${data.connected}`;
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

/** Apply diff to base, return new object (immutable) */
function applyDiff(base: NowPlayingData, diff: Partial<NowPlayingData>): NowPlayingData {
  return {
    connected: diff.connected ?? base.connected,
    is_playing: diff.is_playing ?? base.is_playing,
    progress_ms: diff.progress_ms ?? base.progress_ms,
    duration_ms: diff.duration_ms ?? base.duration_ms,
    track: diff.track !== undefined ? diff.track : base.track,
    error: diff.error !== undefined ? diff.error : base.error,
  };
}

/**
 * Polling interval for client mode (ms).
 * In server mode, the server polls at 2s and pushes via SSE.
 * In client mode, the browser polls at this interval.
 */
const CLIENT_POLL_INTERVAL_MS = 3000;

/**
 * Real-time now-playing with dual mode:
 * - Server mode: SSE diff stream from server-side poller (self-hosted)
 * - Client mode (default): Browser polls /api/spotify/now-playing directly (edge/serverless)
 *
 * @param enabled When false, skip all polling/SSE and return null immediately.
 */
export function useNowPlaying(enabled = true) {
  const [data, setData] = useState<NowPlayingData | null>(null);
  const [syncState, setSyncState] = useState<SyncState>('connected');
  const [pollMode, setPollMode] = useState<string | null>(null); // null = loading config
  const esRef = useRef<EventSource | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gotMessageRef = useRef(false);
  const localDataRef = useRef<NowPlayingData>(EMPTY);
  const localSeqRef = useRef(0);
  const checksumErrRef = useRef(0);
  const mountedRef = useRef(true);
  const lastMessageTimeRef = useRef(0);
  const clientErrorsRef = useRef(0);
  // Mirrors syncState so event handlers (visibility change) can read the latest
  // value without re-subscribing; never rendered from.
  const syncStateRef = useRef<SyncState>('connected');
  // Holds the latest connectSSE so requestFullRefresh can re-establish the
  // stream without a circular dependency. Updated in an effect, never during render.
  const connectSSERef = useRef<() => void>(() => {});

  const stopClientPolling = useCallback(() => {
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  /** A successful fetch/poll resets the failure counter and the degraded state. */
  const handlePollSuccess = useCallback((d: NowPlayingData) => {
    if (!mountedRef.current) return;
    clientErrorsRef.current = 0;
    setSyncState('connected');
    setData(d);
    lastMessageTimeRef.current = Date.now();
  }, []);

  // Holds the latest scheduler so the error path can re-schedule itself (backoff)
  // without a circular dependency. Updated in an effect, never during render.
  const scheduleClientPollRef = useRef<(delayMs: number) => void>(() => {});

  const scheduleClientPoll = useCallback((delayMs: number) => {
    if (!mountedRef.current) return;
    stopClientPolling();
    const run = async () => {
      if (!mountedRef.current) return;
      try {
        const res = await fetch('/api/spotify/now-playing');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const d = await res.json();
        // Transient Spotify fault (429/5xx): auto-retry with backoff instead of
        // the normal cadence, but never count toward a permanent stop — these
        // recover without user action (issue #117).
        if (d && d.error && isSpotifyTransientError(d.error)) {
          clientErrorsRef.current = 0;
          setSyncState('retrying');
          setData(d);
          lastMessageTimeRef.current = Date.now();
          scheduleClientPollRef.current(backoffDelay(1));
          return;
        }
        handlePollSuccess(d);
        // Success → back to the normal poll cadence.
        scheduleClientPollRef.current(CLIENT_POLL_INTERVAL_MS);
      } catch {
        const count = ++clientErrorsRef.current;
        if (count >= MAX_CONSECUTIVE_ERRORS) {
          // Permanently stop — sync can only resume via user action (resumeSync).
          setSyncState('stopped');
          return;
        }
        setSyncState('retrying');
        scheduleClientPollRef.current(backoffDelay(count));
      }
    };
    // Delay 0 → run immediately; otherwise schedule with backoff.
    if (delayMs <= 0) {
      void run();
    } else {
      pollRef.current = setTimeout(() => { void run(); }, delayMs);
    }
  }, [handlePollSuccess, stopClientPolling]);

  useEffect(() => {
    scheduleClientPollRef.current = scheduleClientPoll;
  });

  // Keep the syncState mirror up to date (for event handlers).
  useEffect(() => {
    syncStateRef.current = syncState;
  }, [syncState]);

  // ─── Client mode: polling with exponential backoff ───
  const startClientPolling = useCallback(() => {
    if (pollRef.current) return;
    scheduleClientPoll(0);
  }, [scheduleClientPoll]);

  // ─── Fetch poll mode config on mount (only when enabled) ───
  useEffect(() => {
    if (!enabled) {
      // Clean up any existing connections when disabled
      esRef.current?.close();
      esRef.current = null;
      stopClientPolling();
      return;
    }
    mountedRef.current = true;
    fetch('/api/spotify/config')
      .then(r => r.json())
      .then(d => { if (mountedRef.current) setPollMode(d.pollMode || 'client'); })
      .catch(() => { if (mountedRef.current) setPollMode('client'); }); // default to client
    return () => { mountedRef.current = false; };
  }, [enabled, stopClientPolling]);

  // ─── Server mode: SSE with diff protocol ───
  const startFallback = useCallback((reason: string) => {
    // In server mode, fall back to REST polling if SSE fails
    if (pollRef.current) return;
    console.warn(`[now-playing] SSE ${reason}, falling back to polling`);

    scheduleClientPoll(0);
  }, [scheduleClientPoll]);

  /** Request full refresh from SSE endpoint */
  const requestFullRefresh = useCallback(() => {
    if (!mountedRef.current) return;
    console.warn('[now-playing] checksum mismatch, requesting full refresh');
    esRef.current?.close();
    checksumErrRef.current = 0;

    // Track whether this full-refresh stream delivered a valid full message.
    // Do NOT reuse the global gotMessageRef: it belongs to the regular SSE
    // lifetime and may already be true from earlier messages, which would
    // suppress fallback when this recovery stream fails.
    let receivedFullMessage = false;

    const es = new EventSource('/api/spotify/now-playing/stream?full=true');
    esRef.current = es;

    es.onmessage = (e) => {
      if (!mountedRef.current) return;
      try {
        const msg = JSON.parse(e.data) as DiffMessage;
        if ((msg as unknown as { _heartbeat?: boolean })._heartbeat) return;
        const fullData = msg.d as unknown as NowPlayingData;
        if (fullData && typeof fullData.connected === 'boolean') {
          receivedFullMessage = true;
          localDataRef.current = fullData;
          localSeqRef.current = msg.seq;
          handlePollSuccess(fullData);
          if (msg._sync) setSyncState(msg._sync);
          gotMessageRef.current = true;
          stopClientPolling();
          es.close();
          if (mountedRef.current) connectSSERef.current();
        }
      } catch { /* */ }
    };

    es.onerror = () => {
      es.close();
      // If this full-refresh stream never delivered a valid full message,
      // deterministically fall back to REST polling so recovery always has
      // an active channel instead of leaving playback stale forever.
      if (!receivedFullMessage) startFallback('full refresh failed');
    };
  }, [handlePollSuccess, startFallback, stopClientPolling]);

  const connectSSE = useCallback(() => {
    if (!mountedRef.current) return;

    esRef.current?.close();
    stopClientPolling();
    gotMessageRef.current = false;

    const es = new EventSource('/api/spotify/now-playing/stream');
    esRef.current = es;

    let timeoutId: ReturnType<typeof setTimeout>;

    es.onmessage = (e) => {
      if (!mountedRef.current) return;
      try {
        const msg = JSON.parse(e.data) as DiffMessage & { _heartbeat?: boolean };
        if (msg._heartbeat) {
          lastMessageTimeRef.current = Date.now();
          return;
        }

        gotMessageRef.current = true;
        lastMessageTimeRef.current = Date.now();
        stopClientPolling();

        // First message after connect: d is the full data
        if (msg.d && typeof msg.d.connected === 'boolean' && msg.d.progress_ms !== undefined) {
          localDataRef.current = msg.d as unknown as NowPlayingData;
          localSeqRef.current = msg.seq;
          setSyncState(msg._sync ?? 'connected');
          setData(localDataRef.current);
          return;
        }

        // Diff message: apply to local state
        if (msg.seq <= localSeqRef.current) return;

        const candidate = applyDiff(localDataRef.current, msg.d);
        const expected = computeChecksum(candidate);

        if (expected !== msg.c) {
          checksumErrRef.current++;
          if (checksumErrRef.current >= 2) {
            requestFullRefresh();
            return;
          }
          return;
        }

        localDataRef.current = candidate;
        localSeqRef.current = msg.seq;
        checksumErrRef.current = 0;
        if (msg._sync) setSyncState(msg._sync);
        setData(candidate);
      } catch { /* ignore parse errors */ }
    };

    es.onopen = () => {
      if (!mountedRef.current) return;
      timeoutId = setTimeout(() => {
        if (!gotMessageRef.current) {
          es.close();
          startFallback('no data after 5s');
        }
      }, 5000);
    };

    es.onerror = () => {
      if (!mountedRef.current) return;
      clearTimeout(timeoutId);
      es.close();
      if (!gotMessageRef.current) {
        startFallback('connection error');
      } else {
        timeoutId = setTimeout(() => {
          if (mountedRef.current && esRef.current?.readyState === EventSource.CLOSED) {
            startFallback('reconnect failed');
          }
        }, 5000);
      }
    };
  }, [startFallback, stopClientPolling, requestFullRefresh]);

  useEffect(() => {
    connectSSERef.current = connectSSE;
  });

  /** Manually resume a permanently-stopped sync (user action only). */
  const resumeSync = useCallback(async () => {
    if (!mountedRef.current) return;
    clientErrorsRef.current = 0;
    setSyncState('connected');
    stopClientPolling();
    if (pollMode === 'client') {
      scheduleClientPoll(0);
    } else {
      // Server mode: ask the server poller to resume, then reconnect SSE.
      try { await fetch('/api/spotify/now-playing/resume', { method: 'POST' }); } catch { /* ignore */ }
      gotMessageRef.current = false;
      esRef.current?.close();
      esRef.current = null;
      localSeqRef.current = 0;
      checksumErrRef.current = 0;
      connectSSE();
    }
  }, [pollMode, scheduleClientPoll, stopClientPolling, connectSSE]);

  // ─── Start appropriate mode once config is loaded ───
  useEffect(() => {
    if (!enabled || pollMode === null) return; // disabled or still loading config

    if (pollMode === 'client') {
      startClientPolling();
    } else {
      connectSSE();
    }

    return () => {
      mountedRef.current = false;
      esRef.current?.close();
      esRef.current = null;
      stopClientPolling();
    };
  }, [enabled, pollMode, connectSSE, startClientPolling, stopClientPolling]);

  // ─── Reconnect on visibility restore (both modes) ───
  useEffect(() => {
    if (!enabled || pollMode === null) return;
    const STALE_THRESHOLD_MS = 10_000;

    const handleVisibility = () => {
      if (!mountedRef.current) return;
      if (document.visibilityState !== 'visible') return;

      // Sync was manually stopped — do NOT auto-resume; only the user can resume it.
      if (clientErrorsRef.current >= MAX_CONSECUTIVE_ERRORS || syncStateRef.current === 'stopped') return;

      const lastMsg = lastMessageTimeRef.current;
      const stale = !lastMsg || (Date.now() - lastMsg > STALE_THRESHOLD_MS);

      if (!stale) return;

      if (pollMode === 'client') {
        // Client mode: just restart polling
        stopClientPolling();
        startClientPolling();
      } else {
        // Server mode: reconnect SSE
        const es = esRef.current;
        const hasFallback = pollRef.current !== null;
        const sseDead = !es || es.readyState === EventSource.CLOSED;
        const sseOpenButStale = es?.readyState === EventSource.OPEN && stale;

        if (sseDead || sseOpenButStale || hasFallback) {
          stopClientPolling();
          esRef.current?.close();
          esRef.current = null;
          localSeqRef.current = 0;
          checksumErrRef.current = 0;
          connectSSE();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [enabled, pollMode, connectSSE, startClientPolling, stopClientPolling]);

  return { data: enabled ? data : null, syncState: enabled ? syncState : 'connected', resumeSync };
}
