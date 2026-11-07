'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { animateArtistSongArrival, artistRouteTransitionFinished, createArtistTabMotion, type LibraryTab } from './detail-motion';
import type { ArtistLibrary } from './types';

export function useArtistDetailMotion(data: ArtistLibrary | null) {
  const panelsRef = useRef<HTMLDivElement>(null);
  const [motion] = useState(createArtistTabMotion);
  const arrivalCleanup = useRef<(() => void) | null>(null);
  const [selection, setSelection] = useState<{ active: LibraryTab; outgoing: LibraryTab | null; direction: 1 | -1; revision: number }>({ active: 'songs', outgoing: null, direction: 1, revision: 0 });
  const selectTab = (active: LibraryTab) => {
    setSelection((previous) => previous.active === active ? previous : {
      active, outgoing: previous.active, direction: active === 'albums' ? 1 : -1, revision: previous.revision + 1,
    });
  };

  useLayoutEffect(() => {
    if (!data || !selection.outgoing) {
      motion.cancel();
      return;
    }
    const incoming = panelsRef.current?.querySelector<HTMLElement>(`[data-artist-panel="${selection.active}"]`);
    const outgoing = panelsRef.current?.querySelector<HTMLElement>(`[data-artist-panel="${selection.outgoing}"]`);
    if (!incoming || !outgoing) return;
    motion.transition(incoming, outgoing, selection.direction, window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false, () => {
      setSelection((current) => current.revision === selection.revision ? { ...current, outgoing: null } : current);
    });
    // Do not cancel in this effect's cleanup: the next transition samples the current frame first.
  }, [data, motion, selection]);

  useLayoutEffect(() => {
    if (!data) return;
    const rows = panelsRef.current?.querySelectorAll<HTMLElement>('[data-artist-panel="songs"] > .artist-songs > .artist-song') ?? [];
    const cancel = animateArtistSongArrival(rows, window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false, artistRouteTransitionFinished(document));
    arrivalCleanup.current = cancel;
    return () => { cancel(); arrivalCleanup.current = null; };
    // Success arrival belongs to this fetched result, never to tab selection.
  }, [data]);

  useLayoutEffect(() => {
    const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const reduce = () => {
      if (!preference?.matches) return;
      motion.cancel();
      arrivalCleanup.current?.();
      setSelection((current) => current.outgoing ? { ...current, outgoing: null } : current);
    };
    preference?.addEventListener('change', reduce);
    return () => {
      preference?.removeEventListener('change', reduce);
      motion.cancel();
      arrivalCleanup.current?.();
    };
  }, [motion]);

  return { tab: selection.active, outgoingTab: selection.outgoing, selectTab, panelsRef };
}
