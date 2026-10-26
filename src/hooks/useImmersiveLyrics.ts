'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { animateSmoothScroll, cancelSmoothScroll } from '@/lib/scroll-ease';
import {
  centeredLyricScrollTop, isLyricsView, lyricsViewUrl,
  LYRIC_FOLLOW_RESUME_MS, shouldFollowImmersiveLyrics,
} from '@/lib/immersive-lyrics';

/** The native browser fullscreen and the lyric-reading view are intentionally independent. */
export function useImmersiveLyrics(
  lyricsRef: React.RefObject<HTMLDivElement | null>,
  lineRefs: React.RefObject<(HTMLDivElement | null)[]>,
  activeLine: number,
  debug: boolean,
) {
  const [active, setActive] = useState(false);
  const [browserFullscreen, setBrowserFullscreen] = useState(false);
  const activeRef = useRef(false);
  const ownedFullscreen = useRef(false);
  const manualUntil = useRef(0);
  const returnTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentLine = useRef(activeLine);
  const debugRef = useRef(debug);
  useEffect(() => { currentLine.current = activeLine; }, [activeLine]);
  useEffect(() => { debugRef.current = debug; }, [debug]);
  const shouldFollow = useCallback(() => !activeRef.current || shouldFollowImmersiveLyrics(performance.now(), manualUntil.current), []);

  const centerCurrent = useCallback(() => {
    if (!activeRef.current || debugRef.current || !shouldFollowImmersiveLyrics(performance.now(), manualUntil.current)) return;
    const container = lyricsRef.current;
    if (!container) return;
    const line = lineRefs.current[currentLine.current];
    if (!line) {
      if (currentLine.current === -1) animateSmoothScroll(container, 0);
      return;
    }
    const box = line.getBoundingClientRect();
    const viewport = container.getBoundingClientRect();
    animateSmoothScroll(container, centeredLyricScrollTop(
      container.scrollTop, container.clientHeight, box.top - viewport.top, box.height,
    ));
  }, [lineRefs, lyricsRef]);

  // The active row can change while a user is browsing. When browsing expires,
  // follow the latest committed row rather than the row from the previous render.
  useEffect(() => {
    if (!active || !shouldFollow()) return;
    const raf = requestAnimationFrame(centerCurrent);
    return () => cancelAnimationFrame(raf);
  }, [active, activeLine, centerCurrent, shouldFollow]);

  const clearManualScroll = useCallback(() => {
    manualUntil.current = 0;
    if (returnTimer.current) clearTimeout(returnTimer.current);
    returnTimer.current = null;
  }, []);

  const noteManualScroll = useCallback(() => {
    if (!activeRef.current) return;
    if (lyricsRef.current) cancelSmoothScroll(lyricsRef.current);
    manualUntil.current = performance.now() + LYRIC_FOLLOW_RESUME_MS;
    if (returnTimer.current) clearTimeout(returnTimer.current);
    returnTimer.current = setTimeout(() => {
      returnTimer.current = null;
      manualUntil.current = 0;
      if (currentLine.current >= 0) centerCurrent();
    }, LYRIC_FOLLOW_RESUME_MS);
  }, [centerCurrent, lyricsRef]);

  const leaveBrowserFullscreen = useCallback(() => {
    if (ownedFullscreen.current && document.fullscreenElement === document.documentElement) {
      void document.exitFullscreen().catch(() => {});
    }
    ownedFullscreen.current = false;
  }, []);

  // Call synchronously inside the user's click: delaying to an effect loses
  // the transient activation required by the browser Fullscreen API.
  const requestBrowserFullscreen = useCallback(() => {
    if (document.fullscreenElement || !document.documentElement.requestFullscreen) return;
    void document.documentElement.requestFullscreen().then(() => {
      if (!activeRef.current && document.fullscreenElement === document.documentElement) {
        void document.exitFullscreen().catch(() => {});
        return;
      }
      ownedFullscreen.current = document.fullscreenElement === document.documentElement;
      setBrowserFullscreen(!!document.fullscreenElement);
    }).catch(() => {
      // Unsupported/denied native fullscreen still leaves the app in its own view.
      setBrowserFullscreen(!!document.fullscreenElement);
    });
  }, []);

  const enter = useCallback(() => {
    if (activeRef.current) return;
    activeRef.current = true;
    requestBrowserFullscreen();
    window.history.pushState(null, '', lyricsViewUrl(window.location.href, true));
    clearManualScroll();
    setActive(true);
  }, [clearManualScroll, requestBrowserFullscreen]);

  const leave = useCallback(() => {
    if (!activeRef.current) return;
    activeRef.current = false;
    clearManualScroll();
    if (lyricsRef.current) cancelSmoothScroll(lyricsRef.current);
    leaveBrowserFullscreen();
    setActive(false);
    // Back during reading still closes via popstate. The explicit close action
    // replaces the view address: history.back() can suspend the resumed page's
    // animation frames, leaving normal lyric follow frozen.
    window.history.replaceState(null, '', lyricsViewUrl(window.location.href, false));
  }, [clearManualScroll, leaveBrowserFullscreen, lyricsRef]);

  useEffect(() => {
    const updateFromUrl = () => {
      const enabled = isLyricsView(window.location.href);
      activeRef.current = enabled;
      setActive(enabled);
      if (!enabled) {
        clearManualScroll();
        leaveBrowserFullscreen();
      }
    };
    const updateBrowserFullscreen = () => {
      setBrowserFullscreen(!!document.fullscreenElement);
      if (!document.fullscreenElement) ownedFullscreen.current = false;
      // A changed viewport (native fullscreen, Esc) needs fresh centering.
      requestAnimationFrame(centerCurrent);
    };
    updateFromUrl();
    updateBrowserFullscreen();
    window.addEventListener('popstate', updateFromUrl);
    document.addEventListener('fullscreenchange', updateBrowserFullscreen);
    return () => {
      window.removeEventListener('popstate', updateFromUrl);
      document.removeEventListener('fullscreenchange', updateBrowserFullscreen);
      clearManualScroll();
      leaveBrowserFullscreen();
    };
  }, [centerCurrent, clearManualScroll, leaveBrowserFullscreen]);

  useEffect(() => {
    if (!active) return;
    const prior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const nav = document.querySelector<HTMLElement>('.app-topbar');
    const priorNavVisibility = nav?.style.visibility;
    const priorNavInert = nav?.inert;
    if (nav) { nav.inert = true; nav.style.visibility = 'hidden'; }
    const onResize = () => requestAnimationFrame(centerCurrent);
    window.addEventListener('resize', onResize);
    return () => {
      document.body.style.overflow = prior;
      if (nav) { nav.inert = priorNavInert ?? false; nav.style.visibility = priorNavVisibility ?? ''; }
      window.removeEventListener('resize', onResize);
    };
  }, [active, centerCurrent]);

  return {
    active, browserFullscreen,
    canRequestFullscreen: typeof document !== 'undefined' && !!document.documentElement.requestFullscreen,
    enter, leave, requestBrowserFullscreen, noteManualScroll, clearManualScroll, centerCurrent,
    shouldFollow,
  };
}
