import type { SongItem } from './types';

export const SONGS_REQUEST_ABORT_DELAY_MS = 8000;

/** The list endpoint only ever returns arrays; anything else is treated as an unrecoverable response. */
function parseSongList(json: unknown): SongItem[] | null {
  return Array.isArray(json) ? (json as SongItem[]) : null;
}

/** A single retryable /api/songs request. Never rejects: network/HTTP/invalid-body failures resolve to null. */
export async function fetchSongList(
  mode: 'all' | 'mine' = 'all',
  signal?: AbortSignal,
): Promise<SongItem[] | null> {
  const params = mode === 'mine' ? '?mine=1' : '';
  let res: Response;
  try {
    res = await fetch(`/api/songs${params}`, { signal });
  } catch {
    // Network failure / timeout (AbortError). Keep existing list & cache.
    return null;
  }
  if (!res.ok) return null;
  try {
    return parseSongList(await res.json());
  } catch {
    // Non-JSON / non-array body. Never let an invalid payload overwrite the list.
    return null;
  }
}

/**
 * Fetch the home song list with a bounded timeout so a hung request can be retried.
 * Returns { songs, ok } where `ok` is false when the request itself failed (network/HTTP/bad body).
 */
export async function requestSongList(
  mode: 'all' | 'mine' = 'all',
  signal?: AbortSignal,
): Promise<{ songs: SongItem[]; ok: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SONGS_REQUEST_ABORT_DELAY_MS);
  const onOuterAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onOuterAbort, { once: true });
  }
  try {
    const songs = await fetchSongList(mode, controller.signal);
    return songs === null ? { songs: [], ok: false } : { songs, ok: true };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onOuterAbort);
  }
}
