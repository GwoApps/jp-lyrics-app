'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

export interface NowPlayingData {
  connected: boolean;
  is_playing: boolean;
  progress_ms: number;
  duration_ms: number;
  track: { name: string; artist: string; album: string } | null;
  error?: number;
}

interface DiffMessage {
  seq: number;
  c: number;   // checksum of full data
  d: Partial<NowPlayingData>; // changed fields only
  _full?: boolean; // true when server sends full data
}

const EMPTY: NowPlayingData = { connected: false, is_playing: false, progress_ms: 0, duration_ms: 0, track: null };

/** Fast 32-bit hash — must match server */
function computeChecksum(data: NowPlayingData): number {
  const s = `${data.progress_ms}|${data.is_playing}|${data.track?.name ?? ''}|${data.track?.artist ?? ''}|${data.duration_ms}|${data.connected}`;
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
  const [pollMode, setPollMode] = useState<string | null>(null); // null = loading config
  const esRef = useRef<EventSource | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const gotMessageRef = useRef(false);
  const localDataRef = useRef<NowPlayingData>(EMPTY);
  const localSeqRef = useRef(0);
  const checksumErrRef = useRef(0);
  const mountedRef = useRef(true);
  const lastMessageTimeRef = useRef(0);

  const stopClientPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // ─── Fetch poll mode config on mount (only when enabled) ───
  useEffect(() => {
    if (!enabled) {
      // Clean up any existing connections when disabled
      esRef.current?.close();
      esRef.current = null;
      stopClientPolling();
      setData(null);
      setPollMode(null);
      return;
    }
    mountedRef.current = true;
    fetch('/api/spotify/config')
      .then(r => r.json())
      .then(d => { if (mountedRef.current) setPollMode(d.pollMode || 'client'); })
      .catch(() => { if (mountedRef.current) setPollMode('client'); }); // default to client
    return () => { mountedRef.current = false; };
  }, [enabled, stopClientPolling]);

  // ─── Client mode: simple polling ───
  const startClientPolling = useCallback(() => {
    if (pollRef.current) return;

    const poll = async () => {
      if (!mountedRef.current) return;
      try {
        const res = await fetch('/api/spotify/now-playing');
        const d = await res.json();
        if (mountedRef.current) {
          setData(d);
          lastMessageTimeRef.current = Date.now();
        }
      } catch { /* */ }
    };

    poll();
    pollRef.current = setInterval(poll, CLIENT_POLL_INTERVAL_MS);
  }, []);

  // ─── Server mode: SSE with diff protocol ───
  const clearFallback = useCallback(() => {
    // In server mode, fallback = retry SSE; no client polling fallback
  }, []);

  const startFallback = useCallback((reason: string) => {
    // In server mode, fall back to REST polling if SSE fails
    if (pollRef.current) return;
    console.warn(`[now-playing] SSE ${reason}, falling back to polling`);

    const poll = async () => {
      try {
        const res = await fetch('/api/spotify/now-playing');
        const d = await res.json();
        if (mountedRef.current) {
          setData(d);
          lastMessageTimeRef.current = Date.now();
        }
      } catch { /* */ }
    };

    poll();
    pollRef.current = setInterval(poll, 3000);
  }, []);

  /** Request full refresh from SSE endpoint */
  const requestFullRefresh = useCallback(() => {
    if (!mountedRef.current) return;
    console.warn('[now-playing] checksum mismatch, requesting full refresh');
    esRef.current?.close();
    checksumErrRef.current = 0;

    const es = new EventSource('/api/spotify/now-playing/stream?full=true');
    esRef.current = es;

    es.onmessage = (e) => {
      if (!mountedRef.current) return;
      try {
        const msg = JSON.parse(e.data) as DiffMessage;
        if ((msg as unknown as { _heartbeat?: boolean })._heartbeat) return;
        const fullData = msg.d as unknown as NowPlayingData;
        if (fullData && typeof fullData.connected === 'boolean') {
          localDataRef.current = fullData;
          localSeqRef.current = msg.seq;
          setData(fullData);
          gotMessageRef.current = true;
          lastMessageTimeRef.current = Date.now();
          stopClientPolling();
          es.close();
          if (mountedRef.current) connectSSE();
        }
      } catch { /* */ }
    };

    es.onerror = () => {
      es.close();
      if (!gotMessageRef.current) startFallback('full refresh failed');
    };
  }, [startFallback, stopClientPolling]);

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

  // ─── Start appropriate mode once config is loaded ───
  useEffect(() => {
    if (pollMode === null) return; // still loading config

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
  }, [pollMode, connectSSE, startClientPolling, stopClientPolling]);

  // ─── Reconnect on visibility restore (both modes) ───
  useEffect(() => {
    if (pollMode === null) return;
    const STALE_THRESHOLD_MS = 10_000;

    const handleVisibility = () => {
      if (!mountedRef.current) return;
      if (document.visibilityState !== 'visible') return;

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
  }, [pollMode, connectSSE, startClientPolling, stopClientPolling]);

  return data;
}
