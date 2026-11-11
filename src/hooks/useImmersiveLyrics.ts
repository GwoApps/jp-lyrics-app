'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { animateSmoothScroll, cancelSmoothScroll } from '@/lib/scroll-ease';
import {
  centeredLyricScrollTop, isLyricsView, lyricsViewUrl,
  LYRIC_FOLLOW_RESUME_MS, shouldFollowImmersiveLyrics,
  IMMERSIVE_FONT_SIZES, IMMERSIVE_FONT_STORAGE_KEY, parseImmersiveFontStep,
  shouldExitImmersiveOnEscape,
} from '@/lib/immersive-lyrics';

/** Layers opened above the lyrics view: their own Escape handling owns the key. */
const OVERLAY_SELECTOR = '[role="dialog"], [role="menu"], [role="listbox"], [data-state="open"]';

/** The native browser fullscreen and the lyric-reading view are intentionally independent. */
export function useImmersiveLyrics(
  lyricsRef: React.RefObject<HTMLDivElement | null>,
  lineRefs: React.RefObject<(HTMLDivElement | null)[]>,
  activeLine: number,
  debug: boolean,
  followEnabled: boolean,
  /** Element that opened the view; focus returns here when the view closes. */
  triggerRef?: React.RefObject<HTMLElement | null>,
) {
  const [active, setActive] = useState(false);
  const [browserFullscreen, setBrowserFullscreen] = useState(false);
  const [manualBrowsing, setManualBrowsing] = useState(false);
  const [fontStep, setFontStep] = useState(() => {
    try {
      return parseImmersiveFontStep(typeof window === 'undefined' ? null : localStorage.getItem(IMMERSIVE_FONT_STORAGE_KEY));
    } catch {
      return parseImmersiveFontStep(null);
    }
  });
  useEffect(() => {
    try { localStorage.setItem(IMMERSIVE_FONT_STORAGE_KEY, String(fontStep)); } catch { /* Storage may be unavailable. */ }
  }, [fontStep]);
  const changeFontStep = useCallback((direction: -1 | 1) => {
    setFontStep((step) => Math.max(0, Math.min(IMMERSIVE_FONT_SIZES.length - 1, step + direction)));
  }, []);
  const activeRef = useRef(false);
  const ownedFullscreen = useRef(false);
  const manualUntil = useRef(0);
  const returnTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  /** Whether this view still owns focus, so a user's own focus choice survives. */
  const ownsFocus = useRef(false);
  const currentLine = useRef(activeLine);
  const debugRef = useRef(debug);
  const followEnabledRef = useRef(followEnabled);
  useEffect(() => { currentLine.current = activeLine; }, [activeLine]);
  useEffect(() => { debugRef.current = debug; }, [debug]);
  useEffect(() => { followEnabledRef.current = followEnabled; }, [followEnabled]);
  const shouldFollow = useCallback(() => !activeRef.current || shouldFollowImmersiveLyrics(performance.now(), manualUntil.current), []);

  const centerCurrent = useCallback(() => {
    if (!activeRef.current || debugRef.current || !followEnabledRef.current || !shouldFollowImmersiveLyrics(performance.now(), manualUntil.current)) return;
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
  }, [active, activeLine, followEnabled, centerCurrent, shouldFollow]);

  const clearManualScroll = useCallback(() => {
    manualUntil.current = 0;
    setManualBrowsing(false);
    if (returnTimer.current) clearTimeout(returnTimer.current);
    returnTimer.current = null;
  }, []);

  const resumeFollowing = useCallback(() => {
    clearManualScroll();
    centerCurrent();
    lyricsRef.current?.focus({ preventScroll: true });
  }, [clearManualScroll, centerCurrent, lyricsRef]);

  const noteManualScroll = useCallback(() => {
    if (!activeRef.current) return;
    if (lyricsRef.current) cancelSmoothScroll(lyricsRef.current);
    setManualBrowsing(true);
    manualUntil.current = performance.now() + LYRIC_FOLLOW_RESUME_MS;
    if (returnTimer.current) clearTimeout(returnTimer.current);
    returnTimer.current = setTimeout(() => {
      returnTimer.current = null;
      manualUntil.current = 0;
      setManualBrowsing(false);
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
    // Snapshot before the click handler returns: once the view covers the page,
    // the covered header (which holds the trigger) is display:none and the
    // browser would already have dropped focus to <body>.
    if (!trigger.current) {
      const active = document.activeElement;
      trigger.current = triggerRef?.current
        ?? (active instanceof HTMLElement && active !== document.body ? active : null);
    }
    ownsFocus.current = true;
    requestBrowserFullscreen();
    window.history.pushState(null, '', lyricsViewUrl(window.location.href, true));
    clearManualScroll();
    setActive(true);
    // The lyrics container only becomes focusable in the immersive state, so
    // wait for that commit instead of focusing a still uninhabitable element.
    requestAnimationFrame(() => {
      if (!activeRef.current) return;
      const active = document.activeElement;
      if (active && active !== document.body && active !== lyricsRef.current) return;
      lyricsRef.current?.focus({ preventScroll: true });
    });
  // triggerRef is read once at entry; re-running enter() on its identity is meaningless.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearManualScroll, lyricsRef, requestBrowserFullscreen]);

  const handBackFocus = useCallback(() => {
    if (!ownsFocus.current) return;
    ownsFocus.current = false;
    const target = trigger.current;
    trigger.current = null;
    if (target?.isConnected) target.focus({ preventScroll: true });
  }, []);

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
    handBackFocus();
  }, [clearManualScroll, handBackFocus, leaveBrowserFullscreen, lyricsRef]);

  const leaveRef = useRef(leave);
  useEffect(() => { leaveRef.current = leave; }, [leave]);

  useEffect(() => {
    const updateFromUrl = () => {
      const enabled = isLyricsView(window.location.href);
      activeRef.current = enabled;
      setActive(enabled);
      if (!enabled) {
        clearManualScroll();
        leaveBrowserFullscreen();
        handBackFocus();
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
  }, [centerCurrent, clearManualScroll, handBackFocus, leaveBrowserFullscreen]);

  useEffect(() => {
    if (!active) return;
    const prior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const nav = document.querySelector<HTMLElement>('.app-topbar');
    const priorNavVisibility = nav?.style.visibility;
    const priorNavInert = nav?.inert;
    if (nav) { nav.inert = true; nav.style.visibility = 'hidden'; }
    const onResize = () => requestAnimationFrame(centerCurrent);
    // Esc closes full-screen reading, but only when no layer above it (dialog,
    // menu) already claimed the key. Native fullscreen keeps its own Esc.
    const onKeyDown = (event: KeyboardEvent) => {
      if (!shouldExitImmersiveOnEscape(event.key, event.defaultPrevented, !!document.querySelector(OVERLAY_SELECTOR))) return;
      event.preventDefault();
      leaveRef.current();
    };
    window.addEventListener('resize', onResize);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = prior;
      if (nav) { nav.inert = priorNavInert ?? false; nav.style.visibility = priorNavVisibility ?? ''; }
      window.removeEventListener('resize', onResize);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [active, centerCurrent]);

  return {
    active, browserFullscreen, manualBrowsing, resumeFollowing,
    fontStep, fontSize: IMMERSIVE_FONT_SIZES[fontStep], changeFontStep,
    canRequestFullscreen: typeof document !== 'undefined' && !!document.documentElement.requestFullscreen,
    enter, leave, requestBrowserFullscreen, noteManualScroll, clearManualScroll, centerCurrent,
    shouldFollow,
  };
}
