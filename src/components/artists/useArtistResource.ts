'use client';

import { useEffect, useState } from 'react';
import type { ArtistLibrary, LibraryArtist } from './types';

type ResourceState<T> =
  | { url: string; status: 'loading' }
  | { url: string; status: 'ready'; data: T }
  | { url: string; status: 'error'; notFound: boolean };

export const validArtistList = (value: unknown): value is { artists: LibraryArtist[] } => {
  if (!value || typeof value !== 'object' || !('artists' in value) || !Array.isArray(value.artists)) return false;
  return value.artists.every((artist) => artist && typeof artist.name === 'string'
    && typeof artist.songCount === 'number' && typeof artist.albumCount === 'number');
};
export const validArtistLibrary = (value: unknown): value is ArtistLibrary => {
  if (!value || typeof value !== 'object' || !('artist' in value) || !('songs' in value) || !('albums' in value)) return false;
  return validArtistList({ artists: [value.artist] }) && Array.isArray(value.songs) && Array.isArray(value.albums)
    && value.albums.every((album) => album && typeof album.key === 'string' && typeof album.title === 'string' && Array.isArray(album.songs));
};

export function useArtistResource<T>(url: string, validate: (value: unknown) => value is T) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ResourceState<T>>({ url, status: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    void fetch(url, { signal: controller.signal, cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) {
          if (!controller.signal.aborted) setState({ url, status: 'error', notFound: response.status === 404 });
          return;
        }
        const body: unknown = await response.json();
        if (!validate(body)) throw new Error('invalid_artist_response');
        if (!controller.signal.aborted) setState({ url, status: 'ready', data: body });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ url, status: 'error', notFound: false });
      });
    return () => controller.abort();
  }, [url, attempt, validate]);

  const retry = () => {
    setState({ url, status: 'loading' });
    setAttempt((value) => value + 1);
  };
  // Route changes may render once before the old request effect is cleaned up.
  const current: ResourceState<T> = state.url === url ? state : { url, status: 'loading' };
  return { state: current, retry };
}
