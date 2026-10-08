'use client';

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { fmtMs } from '@/lib/lrc';

/** Gap kept between the card's left edge and the time labels (mirrors the CSS). */
const GAP_PX = 12;
/** Breathing room required between the labels and the viewport edge. */
const EDGE_PX = 8;
/**
 * While synced to Spotify, how many rows either side of the playing row stay
 * visible by default (spec: "上两行、下两行以及本行" → 5 labels total).
 */
const ACTIVE_CONTEXT_ROWS = 2;

interface LyricTimeAxisProps {
  /** The lyrics scroll container this axis mirrors (rows scroll inside it). */
  scrollRef: React.RefObject<HTMLDivElement | null>;
  /** Page-owned refs for each rendered lyric row (same array the sync loop uses). */
  lineRefs: React.RefObject<(HTMLDivElement | null)[]>;
  /** Line timestamps; rows without a timestamp render no label. */
  timestamps: (number | null)[];
  /** Row highlighted by playback. */
  activeLine: number;
  /** Only light the active label up while THIS page's track is the playing one. */
  isSynced: boolean;
}

/**
 * Desktop lyric time axis rendered in the page gutter OUTSIDE the lyrics card.
 *
 * `<main>` is capped at 860px, so the card only has a left gutter on wide
 * viewports: the axis measures that gutter and stays `visibility: hidden`
 * unless the labels + 12px gap + 8px edge margin genuinely fit — the spec is
 * to show the axis outside the container only when there is enough space.
 *
 * Geometry contract (all measured, no assumptions about padding):
 * - The clipping window equals the lyrics scroller's box, expressed in the
 *   shell's coordinate space, so labels are cut exactly where the card cuts
 *   its own rows.
 * - Each label's `top` is the vertical centre of its `.lyric-line` in the
 *   scroller's *content* space (scroll-invariant), so labels stay centred on
 *   their lyric line wherever the container is scrolled.
 * - Scroll following is a single `translate3d` on the track, written from a
 *   passive scroll listener — compositor-only, so it rides the manual
 *   easeOutQuart follow animation with no layout work per frame.
 */
function LyricTimeAxis({
  scrollRef,
  lineRefs,
  timestamps,
  activeLine,
  isSynced,
}: LyricTimeAxisProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const labelRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const roRef = useRef<ResizeObserver | null>(null);
  const observedRef = useRef<Element[]>([]);
  const frameRef = useRef(0);
  const tickRef = useRef(0);
  const idleRef = useRef(0);
  const syncedTopRef = useRef<number | null>(null);

  // Reveal rule (spec):
  //  - Not synced → hidden until the pointer is over the lyrics; then ALL rows.
  //  - Synced     → only the playing row ± ACTIVE_CONTEXT_ROWS by default;
  //                 hovering the lyrics reveals ALL rows.
  // The gutter fit measured in measure() still gates everything, so
  // narrow/mobile layouts never reveal.
  const [hovered, setHovered] = useState(false);
  const hasLabels = timestamps.some((time) => time != null);
  // Mirror of the render-driven visibility inputs for measure(), which is a
  // stable useCallback and must not be re-created on every hover change.
  const viewRef = useRef({ hovered: false, isSynced: false, activeLine: -1 });

  // Write the scroll-follow transform, returning false when nothing changed.
  // A `scroll` event for a programmatic `scrollTop` write only fires on the
  // NEXT frame's scroll steps, so the listener alone would make the labels
  // trail the rows for the whole of animateSmoothScroll's follow animation.
  // `kick()` therefore keeps a rAF ticker alive for a couple of frames after
  // each scroll, which picks up those same-frame writes — and goes idle again
  // as soon as the position settles.
  const applyScroll = useCallback(() => {
    const scroller = scrollRef.current;
    const track = trackRef.current;
    if (!scroller || !track) return false;
    const top = scroller.scrollTop;
    if (syncedTopRef.current === top) return false;
    syncedTopRef.current = top;
    track.style.transform = `translate3d(0, ${-top}px, 0)`;
    return true;
  }, [scrollRef]);

  const tick = useCallback(() => {
    idleRef.current = 0; // a fresh scroll arrived: extend the ticker's lease
    if (tickRef.current) return;
    // Local (non-self-referential) loop: runs one rAF per frame while the
    // position keeps changing, then stops two frames after it settles.
    const frame = () => {
      tickRef.current = 0;
      idleRef.current = applyScroll() ? 0 : idleRef.current + 1;
      if (idleRef.current < 2) tickRef.current = requestAnimationFrame(frame);
    };
    tickRef.current = requestAnimationFrame(frame);
  }, [applyScroll]);

  const measure = useCallback(() => {
    const scroller = scrollRef.current;
    const box = boxRef.current;
    const track = trackRef.current;
    const shell = box?.parentElement;
    if (!scroller || !box || !track || !shell) return;

    // ---- Read pass (all reads before any write → one reflow, not one per row) ----
    const scRect = scroller.getBoundingClientRect();
    const shRect = shell.getBoundingClientRect();
    const scrollTop = scroller.scrollTop;
    const rows = lineRefs.current ?? [];
    const labels = labelRefs.current;

    // Label centre in the scroller's content space: scroll-invariant, so the
    // track's translate3d is the only thing that has to change on scroll.
    const centres: (number | undefined)[] = [];
    const detached: boolean[] = [];
    let labelWidth = 0;
    for (let i = 0; i < labels.length; i++) {
      const label = labels[i];
      if (!label) continue;
      const row = rows[i];
      if (!row) {
        // Label rendered for an index the page has no row for — keep it out of sight.
        detached[i] = true;
        continue;
      }
      const line = row.querySelector<HTMLElement>('.lyric-line') ?? row;
      const rect = line.getBoundingClientRect();
      centres[i] = rect.top - scRect.top + scrollTop + rect.height / 2;
      labelWidth = Math.max(labelWidth, label.getBoundingClientRect().width);
    }

    // ---- Reveal policy (spec) -------------------------------------
    // All rows when hovering; otherwise only playingRow ± ACTIVE_CONTEXT_ROWS
    // while synced, and nothing at all while not synced.
    const { hovered, isSynced, activeLine } = viewRef.current;
    const showAll = hovered;
    const showWindow = !hovered && isSynced && activeLine >= 0;
    const rowVisible = (i: number) =>
      !detached[i] && (showAll || (showWindow && Math.abs(i - activeLine) <= ACTIVE_CONTEXT_ROWS));

    // Reveal only when (a) the labels + gap + edge margin actually fit to the
    // left of the card (never on narrow/mobile layouts) AND (b) the reveal
    // policy above says there is something to show.
    //
    // `visibility` inherits, but a child can opt back in with `visible` — so the
    // per-label write MUST be gated on showBox too, otherwise hiding the box
    // would still leave `visible` labels painted (visible in the 768px gutter).
    const boxLeft = shRect.left - GAP_PX - labelWidth;
    let hasVisible = false;
    for (let i = 0; i < centres.length; i++) {
      if (rowVisible(i)) { hasVisible = true; break; }
    }
    const showBox = labelWidth > 0 && boxLeft >= EDGE_PX && hasVisible;

    // ---- Write pass ----
    box.style.top = `${Math.round(scRect.top - shRect.top)}px`;
    box.style.height = `${Math.round(scRect.height)}px`;
    box.style.width = labelWidth > 0 ? `${Math.ceil(labelWidth)}px` : '';

    for (let i = 0; i < centres.length; i++) {
      const label = labels[i];
      if (!label) continue;
      label.style.visibility = showBox && rowVisible(i) ? 'visible' : 'hidden';
      const centre = centres[i];
      if (centre === undefined) continue;
      // CSS keeps `translateY(-50%)` on the label, so `top` is its centre.
      label.style.top = `${Math.round(centre)}px`;
    }

    box.style.visibility = showBox ? 'visible' : 'hidden';

    syncedTopRef.current = scrollTop;
    track.style.transform = `translate3d(0, ${-scrollTop}px, 0)`;
  }, [lineRefs, scrollRef]);

  const scheduleMeasure = useCallback(() => {
    if (frameRef.current) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0;
      measure();
    });
  }, [measure]);

  const syncObservation = useCallback(() => {
    const ro = roRef.current;
    const scroller = scrollRef.current;
    if (!ro || !scroller) return;
    const targets: Element[] = [scroller];
    for (const el of lineRefs.current ?? []) if (el) targets.push(el);
    const observed = observedRef.current;
    if (observed.length === targets.length && observed.every((el, i) => el === targets[i])) return;
    for (const el of observed) ro.unobserve(el);
    for (const el of targets) ro.observe(el);
    observedRef.current = targets;
  }, [lineRefs, scrollRef]);

  // Mirror the reveal inputs for measure(). Declared before the measuring
  // layout effect so the values are current in the same commit.
  useLayoutEffect(() => {
    viewRef.current = { hovered, isSynced, activeLine };
  });

  // Re-measure after every commit: rows move when font size, reading mode,
  // romanization or translations change, and those are all renders.
  useLayoutEffect(() => {
    measure();
    syncObservation();
    // No dep array on purpose: rows can be added (furigana/translations load)
    // without any prop of ours changing identity.
  });

  // One-time wiring: scroll following (reads trackRef live so it starts working
  // as soon as labels mount), plus resize/font re-measure triggers.
  useEffect(() => {
    const scroller = scrollRef.current;
    const onScroll = () => {
      applyScroll();
      // Keep a short rAF ticker alive: a programmatic scrollTop write made
      // after this frame's scroll steps would otherwise only be picked up on
      // the NEXT scroll event — one frame of visible lag behind the rows.
      tick();
    };
    scroller?.addEventListener('scroll', onScroll, { passive: true });
    // Reveal while the pointer is over the lyrics themselves. The axis sits
    // OUTSIDE the card and is `pointer-events: none`, so pointing at the
    // labels never counts as a hover — only the lyrics do (spec).
    const onEnter = () => setHovered(true);
    const onLeave = () => setHovered(false);
    scroller?.addEventListener('mouseenter', onEnter);
    scroller?.addEventListener('mouseleave', onLeave);
    window.addEventListener('resize', scheduleMeasure);
    if (document.fonts) {
      document.fonts.ready.then(scheduleMeasure).catch(() => { /* metrics are best-effort */ });
    }

    const ro = new ResizeObserver(() => scheduleMeasure());
    roRef.current = ro;
    syncObservation();

    return () => {
      scroller?.removeEventListener('scroll', onScroll);
      scroller?.removeEventListener('mouseenter', onEnter);
      scroller?.removeEventListener('mouseleave', onLeave);
      window.removeEventListener('resize', scheduleMeasure);
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
      if (tickRef.current) cancelAnimationFrame(tickRef.current);
      tickRef.current = 0;
      ro.disconnect();
      roRef.current = null;
      observedRef.current = [];
    };
  }, [applyScroll, scheduleMeasure, scrollRef, syncObservation, tick]);

  if (!hasLabels) return null;

  return (
    <div ref={boxRef} aria-hidden="true" className="lyric-time-axis">
      <div ref={trackRef} className="lyric-time-axis__track">
        {timestamps.map((time, i) =>
          time == null ? null : (
            <span
              key={i}
              ref={(el) => { labelRefs.current[i] = el; }}
              className={`lyric-time-axis__label${isSynced && i === activeLine ? ' lyric-time-axis__label--active' : ''}`}
            >
              {fmtMs(time)}
            </span>
          ),
        )}
      </div>
    </div>
  );
}

export default memo(LyricTimeAxis);
