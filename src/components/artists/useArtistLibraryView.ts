'use client';

import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { createArtistLibraryHistory, type LibraryHistoryPort } from './artist-library-history';
import type { LibraryView } from './artist-library-model';

const browserPort: LibraryHistoryPort = {
  read: () => typeof window === 'undefined' ? { pathname: '', state: null, scrollY: 0 } : { pathname: window.location.pathname, state: window.history.state, scrollY: window.scrollY },
  replace: (state) => window.history.replaceState(state, ''),
};
const newOwner = (route: string) => createArtistLibraryHistory(browserPort, route, typeof window === 'undefined' ? 'server' : window.crypto.randomUUID());

export function useArtistLibraryView(name: string, ready: boolean) {
  const route = `/artists/${encodeURIComponent(name)}`;
  const [owner, setOwner] = useState(() => newOwner(route));
  const [view, setView] = useState(owner.initialView);
  const latest = useRef(view);
  const restoring = useRef(true);

  const updateView = useCallback((change: Partial<LibraryView>) => {
    const next = { ...latest.current, ...change };
    latest.current = next;
    setView(next);
    owner.save(next, window.scrollY);
  }, [owner]);
  const saveBeforeNavigation = useCallback(() => { owner.save(latest.current, window.scrollY); }, [owner]);

  useLayoutEffect(() => {
    owner.attach();
    restoring.current = true;
    let frame = 0;
    const saveScroll = () => {
      if (restoring.current || frame) return;
      frame = window.requestAnimationFrame(() => { frame = 0; owner.save(latest.current, window.scrollY); });
    };
    const onPopState = () => {
      if (window.location.pathname !== route) return;
      const next = newOwner(route);
      latest.current = next.initialView;
      setView(next.initialView);
      setOwner(next);
    };
    window.addEventListener('scroll', saveScroll, { passive: true });
    window.addEventListener('popstate', onPopState);
    window.addEventListener('pagehide', saveBeforeNavigation);
    return () => {
      window.removeEventListener('scroll', saveScroll);
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('pagehide', saveBeforeNavigation);
      window.cancelAnimationFrame(frame);
      // Never save in cleanup: Next may already have pushed the destination entry.
    };
  }, [owner, route, saveBeforeNavigation]);

  useLayoutEffect(() => {
    if (!ready) return;
    // Wait for the fetched rows, restored album expansions, and Next's own scroll
    // handling to commit. Only the coordinates are retained, not the song response.
    let second = 0;
    const first = window.requestAnimationFrame(() => {
      second = window.requestAnimationFrame(() => {
        if (!owner.isCurrent()) return;
        window.scrollTo({ top: owner.initialScroll, behavior: 'instant' });
        restoring.current = false;
      });
    });
    return () => { window.cancelAnimationFrame(first); window.cancelAnimationFrame(second); };
  }, [owner, ready]);

  return { view, updateView, saveBeforeNavigation };
}
