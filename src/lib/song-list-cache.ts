'use client';

import { useMemo, useSyncExternalStore } from 'react';

export interface CachedSongListItem {
  id: string;
  title: string;
  artist: string;
  cover_url?: string | null;
}

const SONGS_CACHE_KEY = 'jplrc:songs:list';
const SONGS_CACHE_TTL = 5 * 60 * 1000;

function readRaw(): string | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    return sessionStorage.getItem(SONGS_CACHE_KEY);
  } catch {
    return null;
  }
}

function parseCache<T extends CachedSongListItem>(raw: string | null): T[] | null {
  if (!raw) return null;
  try {
    const { data, timestamp } = JSON.parse(raw) as { data?: T[]; timestamp?: number };
    if (!Array.isArray(data) || typeof timestamp !== 'number' || Date.now() - timestamp > SONGS_CACHE_TTL) return null;
    return data;
  } catch {
    return null;
  }
}

export function getCachedSongs<T extends CachedSongListItem = CachedSongListItem>(): T[] | null {
  return parseCache<T>(readRaw());
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

/** Nothing ever changes, so React re-reads the snapshot once, after hydration. */
const subscribe = () => () => {};

/**
 * The session-cached song list as a render-safe value: `null` on the server and
 * during the hydration render, then the cache. `sessionStorage` is invisible to
 * the server, so reading it during render would make the trees disagree and
 * React would throw the server markup away (issue #419).
 */
export function useCachedSongs<T extends CachedSongListItem = CachedSongListItem>(): T[] | null {
  // The snapshot is the raw string — a primitive, so React's comparison is
  // stable — and parsing happens in a memo to keep the array reference stable.
  const raw = useSyncExternalStore(subscribe, readRaw, () => null);
  return useMemo(() => parseCache<T>(raw), [raw]);
}

/** A single cached song from the cached list, resolved after hydration. */
export function useCachedSong(id: string): CachedSongListItem | null {
  const songs = useCachedSongs();
  return useMemo(() => findCachedSong(songs, id), [songs, id]);
}
