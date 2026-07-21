const SONG_COVER_CACHE_PREFIX = 'jplrc:song-cover:';

function storageKey(songId: string) {
  return `${SONG_COVER_CACHE_PREFIX}${songId}`;
}

export function getCachedSongCover(songId: string | null | undefined): string | null {
  if (!songId || typeof window === 'undefined') return null;
  try {
    const value = window.localStorage.getItem(storageKey(songId));
    return value || null;
  } catch {
    return null;
  }
}

export function cacheSongCover(songId: string, coverUrl: string | null | undefined) {
  if (!songId || typeof window === 'undefined') return;
  try {
    if (coverUrl) window.localStorage.setItem(storageKey(songId), coverUrl);
    else window.localStorage.removeItem(storageKey(songId));
  } catch {
    // Storage can be unavailable or full; the network path remains authoritative.
  }
}

export function cacheSongCovers(songs: Array<{ id: string; cover_url?: string | null }>) {
  songs.forEach((song) => cacheSongCover(song.id, song.cover_url));
}
