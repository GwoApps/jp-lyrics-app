'use client';

import { memo, useEffect, useRef } from 'react';
import {
  getDicePips,
  getMeterFrame,
  getMeterBpm,
  isValidMeterMap,
  meterPlaybackMs,
  shouldRotateMeterDice,
  type MeterFrame,
  type MeterMap,
  type MeterPlayback,
} from '@/lib/meter-dice';
import styles from './MeterDice.module.css';

export interface MeterDiceProps {
  /** The parent must select the exact song/version; this component never guesses. */
  map: MeterMap;
  playbackMsRef: React.RefObject<number | null>;
  playback: MeterPlayback | null;
  matching: boolean;
  /** A localized, stable description supplied by the parent (not a live region). */
  label: string;
}

interface DiceView {
  map: MeterMap | null;
  frame: MeterFrame | null;
  ms: number | null;
  sampledAt: number | null;
  wasPlaying: boolean;
  pips: SVGCircleElement[];
  animation: Animation | null;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * A header-sized, local DOM subscriber to useSpotifySync's authoritative ref.
 * No React frame state, independent timer, BPM inference or poll extrapolation.
 */
function MeterDice({ map, playbackMsRef, playback, matching, label }: MeterDiceProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const faceRef = useRef<SVGSVGElement>(null);
  const pipsRef = useRef<SVGGElement>(null);
  const meterRef = useRef<HTMLSpanElement>(null);
  const viewRef = useRef<DiceView>({
    map: null, frame: null, ms: null, sampledAt: null,
    wasPlaying: false, pips: [], animation: null,
  });
  // Chart validation is linear, but cached per immutable map, not done per tick.
  const validationRef = useRef<{ map: MeterMap; valid: boolean } | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    const face = faceRef.current;
    const group = pipsRef.current;
    const meter = meterRef.current;
    if (!root || !face || !group || !meter) return;
    const view = viewRef.current;
    if (validationRef.current?.map !== map) validationRef.current = { map, valid: isValidMeterMap(map) };
    const valid = validationRef.current.valid;
    const playing = !!playback?.is_playing;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let raf = 0;

    const cancelTurn = () => {
      view.animation?.cancel();
      view.animation = null;
    };
    if (view.map !== map) {
      cancelTurn();
      view.map = map;
      view.frame = null;
      view.ms = null;
      view.sampledAt = null;
      view.pips = [];
      group.replaceChildren();
      meter.textContent = '';
    }

    const paint = (animate: boolean) => {
      const now = performance.now();
      const ms = valid ? meterPlaybackMs(matching, playback, playbackMsRef.current) : null;
      const next = ms == null ? null : getMeterFrame(map, ms);
      const previous = view.frame;
      const elapsed = view.sampledAt == null ? Infinity : now - view.sampledAt;
      const delta = ms == null || view.ms == null ? null : ms - view.ms;
      const discontinuity = delta != null && (
        delta < 0 || (!playing && delta !== 0 && (!view.wasPlaying || Math.abs(delta - elapsed) > 50))
        || (playing && view.wasPlaying && (elapsed > 250 || Math.abs(delta - elapsed) > 50))
      );
      const rotate = animate && playing && !reducedMotion.matches && !discontinuity
        && shouldRotateMeterDice(previous, next, view.ms, ms, elapsed);
      const barChanged = previous?.barIndex !== next?.barIndex;
      const beatChanged = barChanged || previous?.beatIndex !== next?.beatIndex;

      if (!next || discontinuity || (barChanged && !rotate)) cancelTurn();
      if (next && (view.pips.length !== next.numerator || !previous)) {
        // React owns the empty <g>; only this effect owns its SVG children.
        const positions = getDicePips(next.numerator);
        const radius = next.numerator <= 6 ? 7 : Math.min(7, 20 / Math.ceil(Math.sqrt(next.numerator)));
        view.pips = positions.map(({ x, y }) => {
          const pip = document.createElementNS(SVG_NS, 'circle');
          pip.setAttribute('cx', String(x));
          pip.setAttribute('cy', String(y));
          pip.setAttribute('r', String(radius));
          pip.setAttribute('class', styles.pip);
          return pip;
        });
        group.replaceChildren(...view.pips);
      }
      if (next && beatChanged) {
        view.pips.forEach((pip, index) => {
          const lit = String(index < next.litCount);
          const current = String(index === next.beatIndex);
          if (pip.dataset.lit !== lit) pip.dataset.lit = lit;
          if (pip.dataset.current !== current) pip.dataset.current = current;
        });
      }
      const bpm = ms == null || !next ? null : getMeterBpm(map, ms);
      const text = bpm == null ? '' : `${Math.round(bpm)} BPM`;
      if (meter.textContent !== text) meter.textContent = text;
      if (!next && view.pips.length) {
        group.replaceChildren();
        view.pips = [];
      }
      const state = playback == null ? 'loading' : !matching ? 'inactive'
        : !valid ? 'invalid' : ms == null ? 'unavailable' : !next ? 'outside'
          : playing ? 'playing' : 'paused';
      if (root.dataset.state !== state) root.dataset.state = state;
      const bar = next ? String(next.barIndex) : '';
      const beat = next ? String(next.beatIndex) : '';
      if (root.dataset.bar !== bar) root.dataset.bar = bar;
      if (root.dataset.beat !== beat) root.dataset.beat = beat;

      if (rotate && typeof face.animate === 'function') {
        cancelTurn();
        // State indication, not a roll every bar: only a real signature change.
        // The new face is already exact; no queued/imagined intermediate meters.
        view.animation = face.animate(
          [{ transform: 'rotate(-90deg)' }, { transform: 'rotate(0deg)' }],
          { duration: 200, easing: 'cubic-bezier(0.77, 0, 0.175, 1)' },
        );
      }
      if (!playing || document.hidden) view.animation?.pause();
      else if (view.animation?.playState === 'paused') view.animation.play();
      view.frame = next;
      view.ms = ms;
      view.sampledAt = now;
      view.wasPlaying = playing;
    };

    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };
    const tick = () => {
      raf = 0;
      if (document.hidden) return;
      paint(true);
      if (valid && matching && playing) raf = requestAnimationFrame(tick);
    };
    const sync = () => {
      stop();
      if (document.hidden) {
        view.animation?.pause();
        return;
      }
      // Snapshot updates and visibility restores snap directly, never replay.
      paint(false);
      if (valid && matching && playing) raf = requestAnimationFrame(tick);
    };
    const onVisibility = () => {
      view.sampledAt = null;
      sync();
    };
    const onMotionPreference = () => {
      if (reducedMotion.matches) cancelTurn();
    };
    sync();
    document.addEventListener('visibilitychange', onVisibility);
    reducedMotion.addEventListener('change', onMotionPreference);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      reducedMotion.removeEventListener('change', onMotionPreference);
    };
  }, [map, playbackMsRef, playback, matching]);

  useEffect(() => {
    const view = viewRef.current;
    return () => {
      view.animation?.cancel();
      view.animation = null;
    };
  }, []);

  return (
    <div ref={rootRef} className={styles.dice} role="img" aria-label={label} data-state={playback == null ? 'loading' : 'unavailable'}>
      <svg ref={faceRef} className={styles.face} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
        <rect className={styles.outline} x="2" y="2" width="96" height="96" rx="22" />
        <g ref={pipsRef} />
      </svg>
      <span ref={meterRef} className={styles.meter} aria-hidden="true" />
    </div>
  );
}

export default memo(MeterDice);
