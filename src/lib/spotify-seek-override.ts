export interface SeekOverride {
  trackKey: string;
  positionMs: number;
  appliedAt: number; // monotonic browser time for interpolation
  clientAppliedAt: number; // browser wall clock for client polls
  serverAppliedAt: number; // Spotify seek route wall clock for SSE observations
}

export interface SeekObservation {
  startedAt: number;
  source: 'client' | 'server';
}

interface SeekPlaybackState {
  connected: boolean;
  is_playing: boolean;
  progress_ms: number;
  duration_ms: number;
  track: { id?: string; uri?: string; name: string; artist: string } | null;
}

const MAX_SEEK_OVERRIDE_MS = 6_000;

/** Prefer Spotify's stable ID/URI; match legacy tracks by title and artist. */
export function trackIdentity(track: SeekPlaybackState['track']): string {
  if (!track) return '';
  return track.id || track.uri || JSON.stringify([track.name, track.artist]);
}

/**
 * Show a confirmed local seek until a matching Spotify observation arrives.
 * Call with the raw server observation; never modify the SSE checksum base.
 */
export function reconcileSeek<T extends SeekPlaybackState>(
  data: T,
  pending: SeekOverride | null,
  now: number,
  observation: SeekObservation,
): { data: T; pending: SeekOverride | null } {
  if (!pending) return { data, pending: null };
  if (!data.connected || !data.track || trackIdentity(data.track) !== pending.trackKey) {
    return { data, pending: null };
  }

  const elapsed = Math.max(0, now - pending.appliedAt);
  const desired = Math.min(
    pending.positionMs + (data.is_playing ? elapsed : 0),
    data.duration_ms > 0 ? data.duration_ms : Infinity,
  );
  // An observation requested after the seek response can include a new seek
  // made in Spotify itself. Trust it even when its position is far from ours.
  const fresh = observation.source === 'server'
    ? observation.startedAt >= pending.serverAppliedAt
    : observation.startedAt >= pending.clientAppliedAt;
  if (fresh || elapsed >= MAX_SEEK_OVERRIDE_MS) {
    return { data, pending: null };
  }
  return { data: { ...data, progress_ms: desired }, pending };
}
