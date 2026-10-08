'use client';

import { memo, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { fmtMs } from '@/lib/lrc';

/** Gap kept between the card's left edge and the time labels (mirrors the CSS). */
const GAP_PX = 12;
/** Breathing room required between the labels and the viewport edge. */
const EDGE_PX = 8;

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

  const hasLabels = timestamps.some((time) => time != null);

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

    // ---- Write pass ----
    box.style.top = `${Math.round(scRect.top - shRect.top)}px`;
    box.style.height = `${Math.round(scRect.height)}px`;
    box.style.width = labelWidth > 0 ? `${Math.ceil(labelWidth)}px` : '';

    for (let i = 0; i < centres.length; i++) {
      const label = labels[i];
      if (!label) continue;
      label.style.visibility = detached[i] ? 'hidden' : 'visible';
      const centre = centres[i];
      if (centre === undefined) continue;
      // CSS keeps `translateY(-50%)` on the label, so `top` is its centre.
      label.style.top = `${Math.round(centre)}px`;
    }

    // Reveal only when the labels + gap + edge margin actually fit to the left
    // of the card (so it never shows on narrow/mobile layouts).
    const boxLeft = shRect.left - GAP_PX - labelWidth;
    box.style.visibility = labelWidth > 0 && boxLeft >= EDGE_PX ? 'visible' : 'hidden';

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
      const liveScroller = scrollRef.current;
      const track = trackRef.current;
      if (!liveScroller || !track) return;
      track.style.transform = `translate3d(0, ${-liveScroller.scrollTop}px, 0)`;
    };
    scroller?.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', scheduleMeasure);
    if (document.fonts) {
      document.fonts.ready.then(scheduleMeasure).catch(() => { /* metrics are best-effort */ });
    }

    const ro = new ResizeObserver(() => scheduleMeasure());
    roRef.current = ro;
    syncObservation();

    return () => {
      scroller?.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', scheduleMeasure);
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
      ro.disconnect();
      roRef.current = null;
      observedRef.current = [];
    };
  }, [scheduleMeasure, scrollRef, syncObservation]);

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
