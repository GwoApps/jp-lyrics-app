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
 * Real-time now-playing via SSE diff + checksum verification.
 * - Primary: EventSource → /api/spotify/now-playing/stream (diff protocol)
 * - Fallback: fetch polling every 3s if SSE fails
 * - Auto-reconnect on page visibility restore (mobile background → foreground)
 */
export function useNowPlaying() {
  const [data, setData] = useState<NowPlayingData | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const fallbackRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const gotMessageRef = useRef(false);
  const localDataRef = useRef<NowPlayingData>(EMPTY);
  const localSeqRef = useRef(0);
  const checksumErrRef = useRef(0);
  const mountedRef = useRef(true);
  const lastMessageTimeRef = useRef(0);

  const clearFallback = useCallback(() => {
    if (fallbackRef.current) {
      clearInterval(fallbackRef.current);
      fallbackRef.current = null;
    }
  }, []);

  const startFallback = useCallback((reason: string) => {
    if (fallbackRef.current) return;
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
    fallbackRef.current = setInterval(poll, 3000);
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
        // Full refresh: d contains the full data object
        const fullData = msg.d as unknown as NowPlayingData;
        if (fullData && typeof fullData.connected === 'boolean') {
          localDataRef.current = fullData;
          localSeqRef.current = msg.seq;
          setData(fullData);
          gotMessageRef.current = true;
          lastMessageTimeRef.current = Date.now();
          clearFallback();
          // Reconnect to normal diff stream
          es.close();
          if (mountedRef.current) connect();
        }
      } catch { /* */ }
    };

    es.onerror = () => {
      es.close();
      if (!gotMessageRef.current) startFallback('full refresh failed');
    };
  }, [startFallback, clearFallback]);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;

    esRef.current?.close();
    clearFallback();
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
        clearFallback();

        // First message after connect: d is the full data
        if (msg.d && typeof msg.d.connected === 'boolean' && msg.d.progress_ms !== undefined) {
          // Looks like a full data object
          localDataRef.current = msg.d as unknown as NowPlayingData;
          localSeqRef.current = msg.seq;
          setData(localDataRef.current);
          return;
        }

        // Diff message: apply to local state
        if (msg.seq <= localSeqRef.current) return; // stale

        const candidate = applyDiff(localDataRef.current, msg.d);
        const expected = computeChecksum(candidate);

        if (expected !== msg.c) {
          // Checksum mismatch — possible packet corruption
          checksumErrRef.current++;
          if (checksumErrRef.current >= 2) {
            requestFullRefresh();
            return;
          }
          // Allow one retry (next message may fix it)
          return;
        }

        // Checksum OK — apply
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
  }, [startFallback, clearFallback, requestFullRefresh]);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      esRef.current?.close();
      esRef.current = null;
      clearFallback();
    };
  }, [connect, clearFallback]);

  // Reconnect when page returns from background (mobile tab switch / app switch)
  useEffect(() => {
    const STALE_THRESHOLD_MS = 10_000; // 10s without data = stale

    const handleVisibility = () => {
      if (!mountedRef.current) return;
      if (document.visibilityState !== 'visible') return;

      const es = esRef.current;
      const hasFallback = fallbackRef.current !== null;
      const lastMsg = lastMessageTimeRef.current;
      const stale = !lastMsg || (Date.now() - lastMsg > STALE_THRESHOLD_MS);

      // Check if SSE is dead or data is stale
      const sseDead = !es || es.readyState === EventSource.CLOSED;
      const sseOpenButStale = es?.readyState === EventSource.OPEN && stale;

      if (sseDead || sseOpenButStale || (hasFallback && stale)) {
        console.warn(`[now-playing] visibility restore — reconnecting (sseDead=${sseDead}, stale=${stale})`);
        clearFallback();
        esRef.current?.close();
        esRef.current = null;
        localSeqRef.current = 0;
        checksumErrRef.current = 0;
        connect();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [connect, clearFallback]);

  return data;
}
