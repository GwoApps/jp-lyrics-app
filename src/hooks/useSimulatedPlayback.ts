'use client';

import { useEffect, useMemo, useState } from 'react';
import { clockPosition, type PlaybackClock } from '@/lib/simulated-playback';
import type { SongData } from '@/lib/types';
import type { SpotifyState } from './useSpotifySync';

/** A silent, page-scoped clock; no Audio, media permission, or Spotify writes. */
export function useSimulatedPlayback(song: SongData | null, enabled: boolean, durationMs: number) {
  const key = song?.id ?? '';
  const [clock, setClock] = useState<PlaybackClock & { key: string; enabled: boolean }>({
    key, enabled, positionMs: 0, startedAt: 0, playing: false,
  });
  // Reset when the source changes, not a frame later (which could resume an old preview).
  if (clock.key !== key || clock.enabled !== enabled) {
    setClock({ key, enabled, positionMs: 0, startedAt: 0, playing: false });
  }
  const playing = enabled && clock.enabled && clock.key === key && clock.playing;
  useEffect(() => {
    if (!playing) return;
    const remaining = durationMs - clockPosition(clock, performance.now(), durationMs);
    const timer = setTimeout(() => setClock((current) => current === clock
      ? { ...current, positionMs: durationMs, playing: false } : current), remaining);
    return () => clearTimeout(timer);
  }, [clock, playing, durationMs]);

  const toggle = () => {
    if (!enabled || !song) return;
    const now = performance.now();
    setClock((current) => {
      const positionMs = clockPosition(current, now, durationMs);
      return { ...current, positionMs: positionMs >= durationMs ? 0 : positionMs, startedAt: now, playing: !current.playing };
    });
  };
  const seek = (positionMs: number) => {
    if (!enabled || !song) return;
    setClock((current) => ({ ...current, positionMs: Math.max(0, Math.min(durationMs, positionMs)), startedAt: performance.now(),
      playing: current.playing && positionMs < durationMs }));
  };
  // Stable snapshot: the shared lyric controller interpolates between user actions.
  const playback = useMemo<SpotifyState | null>(() => enabled && song && clock.enabled && clock.key === song.id ? {
    connected: false, is_playing: clock.playing, progress_ms: clock.positionMs, duration_ms: durationMs,
    track: { id: song.spotify_track_id || '', uri: song.spotify_uri || '', name: song.title, artist: song.artist, album: song.spotify_album || '' },
  } : null, [enabled, song, clock, durationMs]);
  return { playback, toggle, seek };
}
