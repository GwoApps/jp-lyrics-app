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

/* ---- Cover palette cache (client-extracted Material palette per song) ---- */

const SONG_PALETTE_CACHE_PREFIX = 'jplrc:song-palette:';

interface PaletteCacheEntry {
  url: string;
  palette: { primary: { r: number; g: number; b: number }; secondary: { r: number; g: number; b: number }; tertiary: { r: number; g: number; b: number } } | null;
}

function paletteKey(songId: string) {
  return `${SONG_PALETTE_CACHE_PREFIX}${songId}`;
}

/** Read the cached palette for a song; only valid when it matches the current cover URL. */
export function getCachedSongPalette(
  songId: string | null | undefined,
  coverUrl: string | null | undefined,
): PaletteCacheEntry['palette'] | null {
  if (!songId || !coverUrl || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(paletteKey(songId));
    if (!raw) return null;
    const entry = JSON.parse(raw) as PaletteCacheEntry;
    if (entry && entry.url === coverUrl && entry.palette) return entry.palette;
  } catch { /* ignore malformed cache */ }
  return null;
}

export function cacheSongPalette(
  songId: string,
  coverUrl: string | null | undefined,
  palette: PaletteCacheEntry['palette'],
) {
  if (!songId || !coverUrl || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(paletteKey(songId), JSON.stringify({ url: coverUrl, palette }));
  } catch { /* storage full/unavailable — server cache remains authoritative */ }
}

export function clearCachedSongPalette(songId: string | null | undefined) {
  if (!songId || typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(paletteKey(songId));
  } catch { /* ignore */ }
}
