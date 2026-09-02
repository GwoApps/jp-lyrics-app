export interface MatchTrack {
  id?: string;
  name: string;
  artist: string;
}

export interface MatchResult {
  id: string;
  title: string;
  artist: string;
  spotify_track_id?: string | null;
}

/** Server-side "now playing" match — returns only the winning candidate's
 *  summary, so the detail page never downloads the full public song list. */
export async function matchSong(
  track: MatchTrack,
  excludeId?: string,
): Promise<MatchResult | null> {
  if (!track?.name) return null;
  const params = new URLSearchParams({ title: track.name, artist: track.artist || '' });
  if (track.id) params.set('track_id', track.id);
  if (excludeId) params.set('exclude', excludeId);
  try {
    const res = await fetch(`/api/spotify/match-song?${params.toString()}`, { cache: 'no-store' });
    if (!res.ok) {
      console.warn('match-song request failed', res.status);
      return null;
    }
    const data = await res.json() as { match?: MatchResult | null };
    const match = data.match;
    if (!match) return null;
    if (excludeId && match.id === excludeId) return null;
    return match;
  } catch (error) {
    // Never let a failed match silently break the UI; keep it observable.
    console.warn('match-song request failed', error);
    return null;
  }
}
