'use client';

import { useState, useEffect, useRef } from 'react';
import type { FuriganaLine } from '@/lib/types';
import { isSameSpotifyTrack } from '@/lib/match';
import { useNowPlaying, type SyncState } from './useNowPlaying';
import { animateSmoothScroll } from '@/lib/scroll-ease';

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
  trackId: string;
  trackArtist: string;
  durationMs: number;
}

/**
 * Mutable ref bag the page keeps in sync via separate effects.
 * The rAF loop reads from these refs to avoid stale closures.
 */
export interface SyncRefs {
  songTitle: string;
  songArtist: string;
  spotifyTrackId: string | null;
  furiganaLines: FuriganaLine[];
  lineTimestamps: (number | null)[];
  debug: boolean;
  followPlaying: boolean;
  /** Server-side "now playing" matcher supplied by the detail page hook. */
  matchSong: ((track: { id?: string; name: string; artist: string }, excludeId?: string) => Promise<{
    id: string; title: string; artist: string; spotify_track_id?: string | null;
  } | null>) | null;
  currentSongId: string;
  currentUserEmail: string;
}

export interface UseSpotifySyncReturn {
  spotify: SpotifyState | null;
  syncState: SyncState;
  resumeSync: () => void;
  activeLine: number;
  /** Whether the currently-playing Spotify track is the song rendered on this page. */
  isSameSong: boolean;
  followPlaying: boolean;
  setFollowPlaying: React.Dispatch<React.SetStateAction<boolean>>;
  pipWindowRef: React.MutableRefObject<Window | null>;
}

/** Shape used for identity checks against the song rendered on this page. */
function currentSongRef(refs: SyncRefs): {
  id: string;
  title: string;
  artist: string;
  spotify_track_id?: string | null;
} {
  return {
    id: refs.currentSongId,
    title: refs.songTitle,
    artist: refs.songArtist,
    spotify_track_id: refs.spotifyTrackId || undefined,
  };
}

export function useSpotifySync(
  syncRefs: React.MutableRefObject<SyncRefs>,
  lineRefs: React.RefObject<(HTMLDivElement | null)[]>,
  lyricsRef: React.RefObject<HTMLDivElement | null>,
  enabled = true,
): UseSpotifySyncReturn {
  const { data: nowPlayingData, syncState, resumeSync } = useNowPlaying(enabled);
  const spotify = nowPlayingData as SpotifyState | null;
  const [activeLine, setActiveLine] = useState(-1);
  const [followPlaying, setFollowPlaying] = useState(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('jplrc-follow-playing') !== 'false';
    return true;
  });

  // Derived identity: is the song rendered on this page the one currently
  // playing on Spotify? ID-authoritative when both sides have a Track ID;
  // falls back to title + artist scoring for legacy songs. The page badge,
  // seek, share and highlight all consume this single result.
  const isSameSong = !!spotify?.is_playing && !!spotify?.track
    && isSameSpotifyTrack(currentSongRef(syncRefs.current), spotify.track);

  const interpRef = useRef<InterpAnchor>({ progressMs: 0, pollTime: 0, isPlaying: false, trackName: '', trackId: '', trackArtist: '', durationMs: 0 });
  const rafRef = useRef<number>(0);
  const highlightRef = useRef(-1);
  const prevTrackKeyRef = useRef('');
  const navigatingRef = useRef(false);
  // Guards the async follow-playing match so a stale response (track changed
  // again, or the user navigated manually while the fetch was in flight) never
  // redirects to the wrong song.
  const matchTokenRef = useRef(0);
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

    const refs = syncRefs.current;
    const track = nowPlayingData.track;

    if (nowPlayingData.is_playing && track) {
      interpRef.current = {
        progressMs: nowPlayingData.progress_ms,
        pollTime: performance.now(),
        isPlaying: true,
        trackName: track.name,
        trackId: track.id || '',
        trackArtist: track.artist,
        durationMs: nowPlayingData.duration_ms || 0,
      };

      // Follow now-playing: detect track change and auto-navigate.
      // The key includes the Spotify ID/URI + title + artist, so switching to a
      // same-name track (different version / artist / cover) always triggers a move.
      const trackKey = track.id || track.uri || `${track.name}||${track.artist}`;
      if (
        refs.followPlaying &&
        !navigatingRef.current &&
        prevTrackKeyRef.current &&
        prevTrackKeyRef.current !== trackKey
      ) {
        // Ask the server for the best-matching *other* song (skip the one this
        // page already renders). Only the winning candidate is transferred.
        const token = ++matchTokenRef.current;
        void (async () => {
          const match = refs.matchSong
            ? await refs.matchSong(
                { id: track.id || undefined, name: track.name, artist: track.artist },
                refs.currentSongId,
              )
            : null;
          // Ignore stale responses: the track changed again or the user
          // navigated elsewhere while the fetch was in flight.
          if (token !== matchTokenRef.current) return;
          if (navigatingRef.current) return;
          if (match && match.id !== refs.currentSongId) {
            navigatingRef.current = true;
            window.location.assign(`/songs/${match.id}`);
          }
        })();
      }
      prevTrackKeyRef.current = trackKey;
    } else {
      interpRef.current.isPlaying = false;
      if (!track) {
        prevTrackKeyRef.current = '';
      }
    }
  }, [nowPlayingData, syncRefs]);

  // Smooth rAF interpolation loop — runs at display refresh rate between polls
  // Reads from refs to avoid stale closures; no React re-render per frame
  useEffect(() => {
    const tick = () => {
      const { progressMs, pollTime, isPlaying, trackName, trackId, trackArtist } = interpRef.current;
      const refs = syncRefs.current;
      const songTitle = refs.songTitle;

      // Not playing or song mismatch → clear highlight. Identity reuses the same
      // matching rule as the page badge / seek / share (ID-authoritative).
      if (!isPlaying || !songTitle || !isSameSpotifyTrack(
        currentSongRef(refs),
        { id: trackId || undefined, name: trackName, artist: trackArtist },
      )) {
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
        if (!refs.debug && lineRefs.current?.[newActive]) {
          const lineEl = lineRefs.current[newActive];
          const container = lyricsRef.current;
          if (lineEl && container) {
            const lineTop = lineEl.offsetTop - container.offsetTop;
            animateSmoothScroll(container, lineTop - container.clientHeight / 2 + lineEl.offsetHeight / 2);
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
  }, [lineRefs, lyricsRef, syncRefs]);

  return {
    spotify,
    syncState,
    resumeSync,
    activeLine,
    isSameSong,
    followPlaying,
    setFollowPlaying,
    pipWindowRef,
  };
}
