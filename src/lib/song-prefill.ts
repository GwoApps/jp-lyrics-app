export interface SongPrefill {
  title: string;
  artist: string;
  spotifyTrackId?: string;
  spotifyUri?: string;
  spotifyAlbum?: string;
  spotifyDurationMs?: number;
  coverUrl?: string;
}

function appendText(params: URLSearchParams, key: string, value?: string | null) {
  const normalized = value?.trim();
  if (normalized) params.set(key, normalized);
}

export function buildNewSongUrl(prefill: SongPrefill): string {
  const params = new URLSearchParams();
  appendText(params, 'title', prefill.title);
  appendText(params, 'artist', prefill.artist);
  appendText(params, 'spotify_track_id', prefill.spotifyTrackId);
  appendText(params, 'spotify_uri', prefill.spotifyUri);
  appendText(params, 'spotify_album', prefill.spotifyAlbum);
  if (Number.isFinite(prefill.spotifyDurationMs) && (prefill.spotifyDurationMs ?? 0) > 0) {
    params.set('spotify_duration_ms', String(Math.round(prefill.spotifyDurationMs!)));
  }
  appendText(params, 'cover_url', prefill.coverUrl);
  const query = params.toString();
  return query ? `/songs/new?${query}` : '/songs/new';
}

export function readSongPrefill(params: { get(name: string): string | null }): SongPrefill {
  const duration = Number(params.get('spotify_duration_ms'));
  return {
    title: params.get('title')?.trim() || '',
    artist: params.get('artist')?.trim() || '',
    spotifyTrackId: params.get('spotify_track_id')?.trim() || undefined,
    spotifyUri: params.get('spotify_uri')?.trim() || undefined,
    spotifyAlbum: params.get('spotify_album')?.trim() || undefined,
    spotifyDurationMs: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : undefined,
    coverUrl: params.get('cover_url')?.trim() || undefined,
  };
}
