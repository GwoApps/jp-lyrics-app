'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { FuriganaLine } from '@/lib/types';
import type { SyncLine } from '@/lib/lrc';
import { isTitleMatch, findBestMatch } from '@/lib/match';
import { useNowPlaying } from './useNowPlaying';
import type { NowPlayingData } from './useNowPlaying';

export interface SpotifyState {
  connected: boolean;
  is_playing: boolean;
  progress_ms: number;
  duration_ms: number;
  track: { id: string; uri: string; name: string; artist: string; album: string; cover_url?: string | null } | null;
  error?: number;
}

interface InterpAnchor {
  progressMs: number;
  pollTime: number;
  isPlaying: boolean;
  trackName: string;
  durationMs: number;
}

/**
 * Mutable ref bag the page keeps in sync via separate effects.
 * The rAF loop reads from these refs to avoid stale closures.
 */
export interface SyncRefs {
  songTitle: string;
  furiganaLines: FuriganaLine[];
  lineTimestamps: (number | null)[];
  debug: boolean;
  followPlaying: boolean;
  allSongs: { id: string; title: string; artist: string; created_by: string; is_public: number }[];
  currentSongId: string;
  currentUserEmail: string;
  pipWindow: Window | null;
  lineRefs: React.RefObject<(HTMLDivElement | null)[]>;
  lyricsRef: React.RefObject<HTMLDivElement | null>;
}

export interface UseSpotifySyncReturn {
  spotify: SpotifyState | null;
  activeLine: number;
  followPlaying: boolean;
  setFollowPlaying: React.Dispatch<React.SetStateAction<boolean>>;
  pipWindowRef: React.MutableRefObject<Window | null>;
  highlightRef: React.MutableRefObject<number>;
}

export function useSpotifySync(syncRefs: React.MutableRefObject<SyncRefs>, enabled = true): UseSpotifySyncReturn {
  const nowPlayingData = useNowPlaying(enabled);
  const [spotify, setSpotify] = useState<SpotifyState | null>(null);
  const [activeLine, setActiveLine] = useState(-1);
  const [followPlaying, setFollowPlaying] = useState(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('jplrc-follow-playing') !== 'false';
    return true;
  });

  const interpRef = useRef<InterpAnchor>({ progressMs: 0, pollTime: 0, isPlaying: false, trackName: '', durationMs: 0 });
  const rafRef = useRef<number>(0);
  const highlightRef = useRef(-1);
  const prevTrackRef = useRef<string>('');
  const navigatingRef = useRef(false);
  const pipWindowRef = useRef<Window | null>(null);

  // Persist follow-playing preference
  useEffect(() => { localStorage.setItem('jplrc-follow-playing', String(followPlaying)); }, [followPlaying]);

  // Close PiP on unmount
  useEffect(() => {
    return () => {
      try { pipWindowRef.current?.close(); } catch { /* */ }
    };
  }, []);

  // React to SSE/polling data from useNowPlaying
  useEffect(() => {
    if (!nowPlayingData) return;

    setSpotify(nowPlayingData as SpotifyState);

    const refs = syncRefs.current;

    if (nowPlayingData.is_playing && nowPlayingData.track) {
      interpRef.current = {
        progressMs: nowPlayingData.progress_ms,
        pollTime: performance.now(),
        isPlaying: true,
        trackName: nowPlayingData.track.name,
        durationMs: nowPlayingData.duration_ms || 0,
      };

      // Follow now-playing: detect track change and auto-navigate
      const trackKey = nowPlayingData.track.name;
      if (
        refs.followPlaying &&
        !navigatingRef.current &&
        prevTrackRef.current &&
        prevTrackRef.current !== trackKey
      ) {
        const match = findBestMatch(refs.allSongs, nowPlayingData.track, refs.currentUserEmail);
        if (match && match.id !== refs.currentSongId) {
          navigatingRef.current = true;
          window.location.assign(`/songs/${match.id}`);
          return;
        }
      }
      prevTrackRef.current = trackKey;
    } else {
      interpRef.current.isPlaying = false;
      if (!nowPlayingData.track) prevTrackRef.current = '';
    }
  }, [nowPlayingData, syncRefs]);

  // Smooth rAF interpolation loop — runs at display refresh rate between polls
  // Reads from refs to avoid stale closures; no React re-render per frame
  useEffect(() => {
    const tick = () => {
      const { progressMs, pollTime, isPlaying, trackName, durationMs } = interpRef.current;
      const refs = syncRefs.current;
      const songTitle = refs.songTitle;

      // Not playing or song mismatch → clear highlight
      if (!isPlaying || !songTitle || !isTitleMatch(trackName, songTitle)) {
        if (highlightRef.current !== -1) {
          highlightRef.current = -1;
          setActiveLine(-1);
        }
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      // Interpolate progress since last poll
      const elapsed = performance.now() - pollTime;
      const currentMs = progressMs + Math.max(0, elapsed);

      // Find active line
      const lts = refs.lineTimestamps;
      const fls = refs.furiganaLines;
      let newActive = -1;

      if (lts.length > 0) {
        // Timestamp-based: scan from end
        for (let i = lts.length - 1; i >= 0; i--) {
          if (lts[i] != null && currentMs >= lts[i]!) {
            newActive = i;
            break;
          }
        }
      }
      // No timestamps → newActive stays -1 (no follow)

      // Update highlight + scroll only when line actually changes
      if (newActive !== highlightRef.current) {
        highlightRef.current = newActive;
        setActiveLine(newActive);
        if (!refs.debug && refs.lineRefs.current?.[newActive]) {
          const lineEl = refs.lineRefs.current[newActive];
          const container = refs.lyricsRef.current;
          if (lineEl && container) {
            const lineTop = lineEl.offsetTop - container.offsetTop;
            container.scrollTo({ top: lineTop - container.clientHeight / 2 + lineEl.offsetHeight / 2, behavior: 'smooth' });
          }
        }
        // Update PiP window if open
        try {
          const pipWin = pipWindowRef.current;
          if (pipWin && !pipWin.closed) {
            const pipLines = pipWin.document.querySelectorAll('.line');
            pipLines.forEach((el: Element, i: number) => {
              if (i === newActive) {
                (el as HTMLElement).classList.add('active');
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
              } else {
                (el as HTMLElement).classList.remove('active');
              }
            });
          }
        } catch { /* PiP window closed */ }
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []); // Run once — reads from refs that stay in sync via page effects

  return {
    spotify,
    activeLine,
    followPlaying,
    setFollowPlaying,
    pipWindowRef,
    highlightRef,
  };
}
