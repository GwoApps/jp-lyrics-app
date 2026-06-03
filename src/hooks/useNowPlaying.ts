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

/**
 * Real-time now-playing via SSE with polling fallback.
 * - Primary: EventSource → /api/spotify/now-playing/stream
 * - Fallback: fetch polling every 3s if SSE fails to open
 */
export function useNowPlaying() {
  const [data, setData] = useState<NowPlayingData | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const fallbackRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const gotMessageRef = useRef(false);

  const clearFallback = useCallback(() => {
    if (fallbackRef.current) {
      clearInterval(fallbackRef.current);
      fallbackRef.current = null;
    }
  }, []);

  const startFallback = useCallback((reason: string) => {
    if (fallbackRef.current) return; // already running
    console.warn(`[now-playing] SSE ${reason}, falling back to polling`);

    const poll = async () => {
      try {
        const res = await fetch('/api/spotify/now-playing');
        const d = await res.json();
        setData(d);
      } catch { /* */ }
    };

    poll(); // immediate first fetch
    fallbackRef.current = setInterval(poll, 3000);
  }, []);

  useEffect(() => {
    let mounted = true;
    let timeoutId: ReturnType<typeof setTimeout>;

    const connect = () => {
      if (!mounted) return;

      // Close existing connection if any
      esRef.current?.close();

      const es = new EventSource('/api/spotify/now-playing/stream');
      esRef.current = es;

      es.onmessage = (e) => {
        if (!mounted) return;
        try {
          const parsed = JSON.parse(e.data) as NowPlayingData & { _heartbeat?: boolean };
          if (parsed._heartbeat) return; // skip internal heartbeat marker
          gotMessageRef.current = true;
          clearFallback(); // SSE is working, stop fallback if running
          setData(parsed);
        } catch { /* ignore parse errors */ }
      };

      es.onopen = () => {
        if (!mounted) return;
        // If no message arrives within 5s, assume broken and fall back
        timeoutId = setTimeout(() => {
          if (!gotMessageRef.current) {
            es.close();
            startFallback('no data after 5s');
          }
        }, 5000);
      };

      es.onerror = () => {
        if (!mounted) return;
        clearTimeout(timeoutId);
        es.close();
        if (!gotMessageRef.current) {
          startFallback('connection error');
        } else {
          // SSE was working but dropped — EventSource auto-reconnects,
          // but if it keeps failing, start fallback after a delay
          timeoutId = setTimeout(() => {
            if (mounted && esRef.current?.readyState === EventSource.CLOSED) {
              startFallback('reconnect failed');
            }
          }, 5000);
        }
      };
    };

    connect();

    return () => {
      mounted = false;
      clearTimeout(timeoutId);
      esRef.current?.close();
      esRef.current = null;
      clearFallback();
    };
  }, [startFallback, clearFallback]);

  return data;
}
