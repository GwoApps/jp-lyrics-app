'use client';

import { memo, useEffect, useRef } from 'react';
import {
  getDicePips,
  isInMeterGlowWindow,
  type MeterGlowWindow,
  getMeterFrame,
  getMeterBpm,
  isValidMeterMap,
  meterPlaybackMs,
  shouldRotateMeterDice,
  type MeterFrame,
  type MeterMap,
  type MeterPlayback,
} from '@/lib/meter-dice';
import { MeterMetronome, type MeterSoundStatus } from '@/lib/meter-metronome';
import styles from './MeterDice.module.css';

export interface MeterDiceProps {
  /** The parent must select the exact song/version; this component never guesses. */
  map: MeterMap;
  /** Already in playback coordinates; absent means no song-specific effect. */
  glowWindows?: readonly MeterGlowWindow[];
  /** Optional song-specific BPM intensity; absent preserves full-strength glow. */
  getGlowIntensity?: (bpm: number | null) => number;
  playbackMsRef: React.RefObject<number | null>;
  playback: MeterPlayback | null;
  matching: boolean;
  /** A localized, stable description supplied by the parent (not a live region). */
  label: string;
  soundLabels: { start: string; stop: string; unlock: string; unavailable: string };
}

interface DiceView {
  map: MeterMap | null;
  frame: MeterFrame | null;
  ms: number | null;
  sampledAt: number | null;
  wasPlaying: boolean;
  pips: SVGGElement[];
  animation: Animation | null;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * A header-sized, local DOM subscriber to useSpotifySync's authoritative ref.
 * No React frame state, independent timer, BPM inference or poll extrapolation.
 */
function MeterDice({ map, playbackMsRef, playback, matching, label, soundLabels, glowWindows, getGlowIntensity }: MeterDiceProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const hintRef = useRef<HTMLSpanElement>(null);
  const soundRef = useRef<MeterMetronome | null>(null);
  const modeRef = useRef<'off' | 'hover' | 'touch' | 'keyboard'>('off');
  const pointerRef = useRef('');
  const statusRef = useRef<MeterSoundStatus>('off');
  const labelsRef = useRef(soundLabels);
  const updateStatus = (status: MeterSoundStatus) => {
    statusRef.current = status;
    const active = modeRef.current !== 'off';
    const labels = labelsRef.current;
    const hint = status === 'blocked' ? labels.unlock : status === 'unavailable' ? labels.unavailable : '';
    buttonRef.current?.setAttribute('aria-pressed', String(active));
    buttonRef.current?.setAttribute('aria-label', hint || (active ? labels.stop : labels.start));
    if (buttonRef.current) buttonRef.current.dataset.active = String(active);
    if (hintRef.current) hintRef.current.textContent = hint;
  };
  const deactivate = () => {
    modeRef.current = 'off';
    soundRef.current?.disable();
    updateStatus('off');
  };
  const activate = (mode: 'hover' | 'touch' | 'keyboard') => {
    modeRef.current = mode;
    soundRef.current ??= new MeterMetronome(() => new AudioContext(), updateStatus);
    const ms = meterPlaybackMs(matching, playback, playbackMsRef.current);
    soundRef.current.enable(ms == null || !isValidMeterMap(map) ? null : getMeterFrame(map, ms));
  };
  const rootRef = useRef<HTMLDivElement>(null);
  const faceRef = useRef<SVGSVGElement>(null);
  const pipsRef = useRef<SVGGElement>(null);
  const glowRef = useRef<HTMLSpanElement>(null);
  const glowInitializedRef = useRef(false);
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
    const glowElement = glowRef.current;
    if (!root || !face || !group || !meter || !glowElement) return;
    const view = viewRef.current;
    if (validationRef.current?.map !== map) validationRef.current = { map, valid: isValidMeterMap(map) };
    const valid = validationRef.current.valid;
    const playing = !!playback?.is_playing;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let raf = 0;
    // These handles mark only real new lamp ignitions, never all lit pips.
    const ignitions = new Map<SVGGElement, Animation[]>();
    const cancelIgnition = (pip: SVGGElement) => {
      ignitions.get(pip)?.forEach((animation) => {
        animation.onfinish = null;
        animation.cancel();
      });
      ignitions.delete(pip);
    };
    const ignite = (pip: SVGGElement) => {
      cancelIgnition(pip);
      const levels = [[0.32, 0.08], [0.48, 0.16], [1, 0.85], [1, 0.9]];
      const animations = Array.from(pip.children).slice(1).flatMap((layer, index) => {
        if (typeof layer.animate !== 'function') return [];
        const [peak, steady] = levels[index];
        return [layer.animate([
          { opacity: 0, offset: 0 },
          { opacity: peak, offset: 40 / 140 },
          { opacity: steady, offset: 1 },
        ], { duration: 140, easing: 'linear' })];
      });
      if (animations.length) {
        ignitions.set(pip, animations);
        animations[animations.length - 1].onfinish = () => cancelIgnition(pip);
      }
    };
    if (!glowInitializedRef.current) {
      glowElement.style.opacity = '0';
      // Commit the first 0 before paint sets the BPM target. Never reset on re-entry.
      if (!reducedMotion.matches) void window.getComputedStyle(glowElement).opacity;
      glowInitializedRef.current = true;
    }

    const setGlowIntensity = (value: number) => {
      const opacity = String(Number((Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0).toFixed(4)));
      if (glowElement.style.opacity !== opacity) glowElement.style.opacity = opacity;
    };
    const setGlowMotion = (active: boolean) => {
      const motion = reducedMotion.matches ? 'static'
        : active && playing && !document.hidden ? 'running' : 'paused';
      if (root.dataset.glowMotion !== motion) root.dataset.glowMotion = motion;
    };
    const cancelTurn = () => {
      view.animation?.cancel();
      view.animation = null;
    };
    const settleLights = () => {
      ignitions.forEach((_, pip) => cancelIgnition(pip));
      root.dataset.motion = 'snap';
      // Commit the stable opacity before a later rAF can enable transitions.
      // Only lifecycle/discontinuity paths read style, never the steady tick.
      view.pips.forEach((pip) => {
        if (pip.lastElementChild) void window.getComputedStyle(pip.lastElementChild).opacity;
      });
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
      const bpm = ms == null || !next ? null : getMeterBpm(map, ms);
      const glow = next && isInMeterGlowWindow(glowWindows, ms) ? 'active' : 'off';
      if (root.dataset.glow !== glow) root.dataset.glow = glow;
      setGlowIntensity(glow === 'active' ? (getGlowIntensity ? getGlowIntensity(bpm) : 1) : 0);
      setGlowMotion(glow === 'active');
      const previous = view.frame;
      const elapsed = view.sampledAt == null ? Infinity : now - view.sampledAt;
      const delta = ms == null || view.ms == null ? null : ms - view.ms;
      const discontinuity = delta != null && (
        delta < 0 || (!playing && delta !== 0 && (!view.wasPlaying || Math.abs(delta - elapsed) > 50))
        || (playing && view.wasPlaying && (elapsed > 250 || Math.abs(delta - elapsed) > 50))
      );
      const audioContinuous = animate && playing && view.wasPlaying && !document.hidden
        && !discontinuity && elapsed <= 250 && delta != null && delta >= 0
        && Math.abs(delta - elapsed) <= 50;
      soundRef.current?.sample(next, audioContinuous);
      const continuous = audioContinuous && !reducedMotion.matches;
      const wasContinuous = root.dataset.motion === 'continuous';
      const motion = continuous ? 'continuous' : 'snap';
      if (root.dataset.motion !== motion) root.dataset.motion = motion;
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
          const pip = document.createElementNS(SVG_NS, 'g');
          pip.setAttribute('class', styles.pip);
          const layers = [
            [styles.socket, radius], [styles.haloOuter, radius * 1.65],
            [styles.haloInner, radius * 1.3], [styles.filament, radius],
            [styles.core, radius * 0.55],
          ] as const;
          pip.replaceChildren(...layers.map(([className, r]) => {
            const circle = document.createElementNS(SVG_NS, 'circle');
            circle.setAttribute('cx', String(x));
            circle.setAttribute('cy', String(y));
            circle.setAttribute('r', String(r));
            circle.setAttribute('class', className);
            return circle;
          }));
          return pip;
        });
        group.replaceChildren(...view.pips);
        // A new signature needs a committed dark baseline before lighting.
        settleLights();
        root.dataset.motion = continuous ? 'continuous' : 'snap';
      } else if (next && barChanged && continuous) {
        // Reuse the face, but commit a dark first core before this downbeat.
        // Keep the other pips lit until continuous motion resumes so they fade.
        const first = view.pips[0];
        root.dataset.motion = 'snap';
        cancelIgnition(first);
        first.dataset.lit = 'false';
        if (first.lastElementChild) void window.getComputedStyle(first.lastElementChild).opacity;
        root.dataset.motion = 'continuous';
      }
      if (next && beatChanged) {
        view.pips.forEach((pip, index) => {
          const lit = String(index < next.litCount);
          if (pip.dataset.lit !== lit) {
            pip.dataset.lit = lit;
            if (lit === 'true' && continuous && index === next.beatIndex) ignite(pip);
            else cancelIgnition(pip);
          }
        });
      }
      if (!continuous && (wasContinuous || beatChanged || !animate)) settleLights();
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
        soundRef.current?.sample(null, false);
        setGlowMotion(root.dataset.glow === 'active');
        if (!valid || !matching || !playback || !view.frame || !isInMeterGlowWindow(glowWindows, view.ms)) {
          if (root.dataset.glow !== 'off') root.dataset.glow = 'off';
          setGlowIntensity(0);
        }
        cancelTurn();
        settleLights();
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
      setGlowMotion(root.dataset.glow === 'active');
      if (reducedMotion.matches) cancelTurn();
      sync();
    };
    sync();
    document.addEventListener('visibilitychange', onVisibility);
    reducedMotion.addEventListener('change', onMotionPreference);
    return () => {
      soundRef.current?.sample(null, false);
      stop();
      if (root.dataset.glowMotion !== 'paused') root.dataset.glowMotion = 'paused';
      settleLights();
      document.removeEventListener('visibilitychange', onVisibility);
      reducedMotion.removeEventListener('change', onMotionPreference);
    };
  }, [map, playbackMsRef, playback, matching, glowWindows, getGlowIntensity]);

  useEffect(() => {
    const view = viewRef.current;
    return () => {
      view.animation?.cancel();
      view.animation = null;
      soundRef.current?.dispose();
      soundRef.current = null;
    };
  }, []);

  useEffect(() => { labelsRef.current = soundLabels; updateStatus(statusRef.current); }, [soundLabels]);

  return (
    <button ref={buttonRef} type="button" className={styles.trigger} data-meter-trigger="" data-active="false"
      aria-pressed={false} aria-label={soundLabels.start}
      onPointerEnter={(event) => {
        if (event.pointerType === 'mouse' && window.matchMedia('(hover: hover) and (pointer: fine)').matches
          && modeRef.current === 'off') activate('hover');
      }}
      onPointerLeave={() => { if (modeRef.current === 'hover') deactivate(); }}
      onPointerDown={(event) => { pointerRef.current = event.pointerType; }}
      onClick={(event) => {
        if (event.detail === 0) {
          if (modeRef.current === 'keyboard') deactivate(); else activate('keyboard');
        } else if (pointerRef.current === 'touch' || pointerRef.current === 'pen') {
          if (modeRef.current === 'touch') deactivate(); else activate('touch');
        } else activate('hover');
      }}
      onKeyDown={(event) => { if (event.key === 'Escape') deactivate(); }}
      onBlur={() => { if (modeRef.current === 'keyboard') deactivate(); }}>
    <div ref={rootRef} className={styles.dice} role="img" aria-label={label} data-glow="off" data-glow-motion="paused" data-state={playback == null ? 'loading' : 'unavailable'}>
      <span className={styles.visual} data-meter-visual="">
      <span data-meter-glow="" ref={glowRef} className={styles.glow} aria-hidden="true"><span className={styles.glowBreath} /></span>
      <svg data-meter-face="" ref={faceRef} className={styles.face} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
        <rect className={styles.outline} x="2" y="2" width="96" height="96" rx="22" />
        <g ref={pipsRef} />
      </svg>
      </span>
      <span data-meter-caption="" ref={meterRef} className={styles.meter} aria-hidden="true" />
    </div>
    <span ref={hintRef} className={styles.hint} data-meter-hint="" />
    </button>
  );
}

export default memo(MeterDice);
