export interface CachedSongListItem {
  id: string;
  title: string;
  artist: string;
  cover_url?: string | null;
}

const SONGS_CACHE_KEY = 'jplrc:songs:list';
const SONGS_CACHE_TTL = 5 * 60 * 1000;

export function getCachedSongs<T extends CachedSongListItem = CachedSongListItem>(): T[] | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(SONGS_CACHE_KEY);
    if (!raw) return null;
    const { data, timestamp } = JSON.parse(raw) as { data?: T[]; timestamp?: number };
    if (!Array.isArray(data) || typeof timestamp !== 'number' || Date.now() - timestamp > SONGS_CACHE_TTL) return null;
    return data;
  } catch {
    return null;
  }
}

export function setCachedSongs<T extends CachedSongListItem>(data: T[]) {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(SONGS_CACHE_KEY, JSON.stringify({ data, timestamp: Date.now() }));
  } catch {}
}

export function findCachedSong<T extends CachedSongListItem>(songs: T[] | null, id: string): T | null {
  return songs?.find((song) => song.id === id) ?? null;
}

export function getCachedSong(id: string): CachedSongListItem | null {
  return findCachedSong(getCachedSongs(), id);
}
