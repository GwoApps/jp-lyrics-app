/**
 * Import error handling for the song list (single Spotify import + playlist).
 */

const importErrorKeyMap: Record<string, string> = {
  title_required: 'home.importTitleRequired',
  lyrics_not_found: 'home.importLyricsNotFound',
  login_required: 'home.importLoginRequired',
  invalid_playlist_url: 'home.importInvalidPlaylistUrl',
  spotify_not_connected: 'home.importSpotifyNotConnected',
  playlist_fetch_failed: 'home.importPlaylistFetchFailed',
  playlist_empty: 'home.importPlaylistEmpty',
};

export function importErrorMsg(t: (k: string) => string, error?: string, fallbackKey?: string): string {
  if (!error) return fallbackKey ? t(fallbackKey) : error || '';
  const key = importErrorKeyMap[error];
  return key ? t(key) : t(fallbackKey || 'home.importFailed');
}
