export interface SongPrefill {
  title: string;
  artist: string;
  spotifyTrackId?: string;
  spotifyUri?: string;
  spotifyAlbum?: string;
  spotifyDurationMs?: number;
  coverUrl?: string;
}

interface ImportErrorPayload {
  error?: unknown;
  manual_create?: {
    title?: unknown;
    artist?: unknown;
    spotify_track_id?: unknown;
    spotify_uri?: unknown;
    spotify_album?: unknown;
    spotify_duration_ms?: unknown;
    cover_url?: unknown;
  };
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

export function buildManualCreateUrl(payload: ImportErrorPayload): string | undefined {
  // No candidate at all, or the only candidate fell below the quality floor —
  // either way let the user create the song manually instead of being stuck.
  if ((payload.error !== 'lyrics_not_found' && payload.error !== 'lyrics_rejected') || !payload.manual_create) return undefined;
  const data = payload.manual_create;
  const title = typeof data.title === 'string' ? data.title.trim() : '';
  if (!title) return undefined;
  return buildNewSongUrl({
    title,
    artist: typeof data.artist === 'string' ? data.artist : '',
    spotifyTrackId: typeof data.spotify_track_id === 'string' ? data.spotify_track_id : undefined,
    spotifyUri: typeof data.spotify_uri === 'string' ? data.spotify_uri : undefined,
    spotifyAlbum: typeof data.spotify_album === 'string' ? data.spotify_album : undefined,
    spotifyDurationMs: typeof data.spotify_duration_ms === 'number' ? data.spotify_duration_ms : undefined,
    coverUrl: typeof data.cover_url === 'string' ? data.cover_url : undefined,
  });
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
