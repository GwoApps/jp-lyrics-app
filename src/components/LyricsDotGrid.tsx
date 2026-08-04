'use client';

import { useEffect, useRef } from 'react';

/** Tunable dot-grid parameters (debug panel drives these live). */
export interface DotGridParams {
  /** Dot spacing in px. */
  spacing: number;
  /** Base dot radius in px. */
  dot: number;
  /** Spotlight radius in px. */
  radius: number;
  /** Dim base-dot opacity. */
  base: number;
  /** Peak size multiplier for lit dots. */
  scale: number;
  /** Pointer follow easing (0..1; 1 = instant). */
  ease: number;
  /** Bloom glow on lit dots. */
  glow: boolean;
  /** Dots get pulled slightly toward the pointer. */
  mag: boolean;
  /** Overall opacity multiplier for the accent-lit dots. */
  alpha: number;
}

export const DEFAULT_DOT_GRID_PARAMS: DotGridParams = {
  spacing: 30,
  dot: 1.6,
  radius: 150,
  base: 0.04,
  scale: 1.2,
  ease: 0.18,
  glow: true,
  mag: false,
  alpha: 0.35,
};

/**
 * Interactive dot-grid highlight for the lyrics panel.
 *
 * Port of the Canvas technique from the reference demo:
 * - A fixed-spacing dot grid covers the container; the dim base layer is
 *   pre-rendered once to an offscreen canvas and blitted each frame.
 * - A pointer spotlight follows the cursor with eased lag; dots within the
 *   radius get a smoothstep-falloff brightness/size boost tinted with the
 *   song's cover accent color.
 * - Only dots inside the spotlight's bounding box are redrawn per frame.
 * - HiDPI-aware (dpr capped at 2); honours prefers-reduced-motion by
 *   disabling easing.
 * - Hover-only: on touch devices the canvas stays empty (never blocks
 *   scrolling, pointer-events: none).
 */
interface LyricsDotGridProps {
  /** Accent as 'r g b' (cover palette primary). Falls back to white. */
  accent?: string;
  /** Live parameter overrides (debug panel). */
  params?: Partial<DotGridParams>;
  /**
   * Optional live microphone spectrum (Uint8Array of byte frequency data,
   * written in place each frame by the caller). When non-null, the bottom
   * rows of the dot grid light up as a spectrum wave — using the same
   * per-dot glow as the pointer spotlight, no extra light sources. The
   * tallest peak never exceeds one third of the panel height.
   */
  spectrumRef?: { current: Uint8Array | null };
}

export default function LyricsDotGrid({ accent, params, spectrumRef }: LyricsDotGridProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const accentRef = useRef('255 255 255');
  const paramsRef = useRef<DotGridParams>(DEFAULT_DOT_GRID_PARAMS);
  const resizeRef = useRef<(() => void) | null>(null);
  const syncRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (accent) accentRef.current = accent;
  }, [accent]);

  useEffect(() => {
    const next = { ...DEFAULT_DOT_GRID_PARAMS, ...params };
    const prev = paramsRef.current;
    // These alter the cached dim layer, so the grid must be rebuilt.
    const needsRebuild = next.spacing !== prev.spacing || next.dot !== prev.dot || next.base !== prev.base;
    paramsRef.current = next;
    syncRef.current?.();
    if (needsRebuild) resizeRef.current?.();
  }, [params]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;
    // Pointer-spotlight effects are a mouse affair; skip touch-only devices.
    if (!window.matchMedia('(hover: hover)').matches) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const S = {
      spacing: 22,
      dot: 1.6,
      radius: 150,
      base: 0.14,
      scale: 1.6,
      ease: reduced ? 1 : 0.18,
      glow: true,
      mag: false,
      alpha: 1,
    };
    const syncParams = () => {
      const p = paramsRef.current;
      S.spacing = p.spacing;
      S.dot = p.dot;
      S.radius = p.radius;
      S.base = p.base;
      S.scale = p.scale;
      S.ease = reduced ? 1 : p.ease;
      S.glow = p.glow;
      S.mag = p.mag;
      S.alpha = p.alpha;
    };
    syncParams();
    syncRef.current = syncParams;

    let W = 0;
    let H = 0;
    let dpr = 1;
    let dots: { x: number; y: number }[] = [];
    let baseLayer: HTMLCanvasElement | null = null;
    const pointer = { x: -9999, y: -9999, tx: -9999, ty: -9999, inside: false, power: 0, tpower: 0 };

    const falloffSmooth = (t: number) => {
      const s = t * t * (3 - 2 * t);
      return 1 - s;
    };

    const buildGrid = () => {
      dots = [];
      const sp = S.spacing;
      const cols = Math.floor(W / sp);
      const rows = Math.floor(H / sp);
      const ox = (W - (cols - 1) * sp) / 2;
      const oy = (H - (rows - 1) * sp) / 2;
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          dots.push({ x: ox + i * sp, y: oy + j * sp });
        }
      }
      renderBase();
    };

    /** Dim base dots rendered once, cached offscreen. */
    const renderBase = () => {
      baseLayer = document.createElement('canvas');
      baseLayer.width = canvas.width;
      baseLayer.height = canvas.height;
      const b = baseLayer.getContext('2d');
      if (!b) return;
      b.setTransform(dpr, 0, 0, dpr, 0, 0);
      b.fillStyle = `rgba(255,255,255,${S.base})`;
      for (const d of dots) {
        b.beginPath();
        b.arc(d.x, d.y, S.dot * 0.72, 0, Math.PI * 2);
        b.fill();
      }
    };

    const resize = () => {
      const r = parent.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = r.width;
      H = r.height;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      buildGrid();
    };
    resizeRef.current = resize;

    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      if (baseLayer) ctx.drawImage(baseLayer, 0, 0, W, H);

      // Microphone spectrum: light up the bottom rows of the grid only —
      // the dots themselves glow (same shadowBlur technique as the pointer
      // spotlight); no extra light sources are drawn.
      const spec = spectrumRef?.current;
      if (spec && spec.length > 1) {
        const sp = S.spacing;
        const cols = Math.max(1, Math.floor(W / sp));
        const rows = Math.max(1, Math.floor(H / sp));
        // Hard cap: the tallest peak reaches one third of the panel.
        const maxRows = Math.max(1, Math.floor(rows / 3));
        const [cr, cg, cb] = accentRef.current.split(' ').map(Number);
        ctx.shadowColor = S.glow ? `rgba(${cr},${cg},${cb},.85)` : 'transparent';
        const N = spec.length;
        const binsPerCol = N / cols;
        for (let i = 0; i < cols; i++) {
          const b0 = Math.floor(i * binsPerCol);
          const b1 = Math.max(b0 + 1, Math.floor((i + 1) * binsPerCol));
          let sum = 0;
          for (let b = b0; b < b1; b++) sum += spec[b] ?? 0;
          const v = Math.min(1, (sum / (b1 - b0)) / 255);
          if (v < 0.03) continue;
          const lit = Math.max(1, Math.round(v * maxRows));
          for (let k = 0; k < lit; k++) {
            const d = dots[(rows - 1 - k) * cols + i];
            if (!d) continue;
            // Base of the wave is brightest; the tip fades.
            const strength = 0.3 + 0.7 * v * (1 - k / maxRows);
            ctx.shadowBlur = S.glow ? 12 * strength : 0;
            ctx.fillStyle = `rgba(${cr},${cg},${cb},${(0.15 + 0.85 * strength) * S.alpha})`;
            ctx.beginPath();
            ctx.arc(d.x, d.y, S.dot * (0.72 + (S.scale - 0.72) * strength), 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.shadowBlur = 0;
      }

      const p = pointer.power;
      if (p < 0.002) return;

      const R = S.radius;
      const [cr, cg, cb] = accentRef.current.split(' ').map(Number);
      const minX = pointer.x - R;
      const maxX = pointer.x + R;
      const minY = pointer.y - R;
      const maxY = pointer.y + R;

      ctx.shadowColor = S.glow ? `rgba(${cr},${cg},${cb},.85)` : 'transparent';
      for (const d of dots) {
        if (d.x < minX || d.x > maxX || d.y < minY || d.y > maxY) continue;
        const dx = d.x - pointer.x;
        const dy = d.y - pointer.y;
        const dist = Math.hypot(dx, dy);
        if (dist > R) continue;

        let v = falloffSmooth(dist / R);
        v = Math.max(0, Math.min(1, v)) * p;
        if (v < 0.012) continue;

        // Magnet pull: lit dots get drawn slightly toward the pointer.
        let px = d.x;
        let py = d.y;
        if (S.mag && dist > 0.01) {
          const pull = v * S.spacing * 0.32;
          px -= (dx / dist) * pull;
          py -= (dy / dist) * pull;
        }

        const r = S.dot * (0.72 + (S.scale - 0.72) * v);
        ctx.shadowBlur = S.glow ? 10 * v : 0;
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${(0.10 + 0.9 * v) * S.alpha})`;
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
    };

    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min((now - last) / 16.667, 3);
      last = now;
      const e = 1 - Math.pow(1 - S.ease, dt);
      pointer.x += (pointer.tx - pointer.x) * e;
      pointer.y += (pointer.ty - pointer.y) * e;
      pointer.power += (pointer.tpower - pointer.power) * (1 - Math.pow(1 - 0.09, dt));
      draw();
      raf = requestAnimationFrame(frame);
    };

    const movePointer = (clientX: number, clientY: number) => {
      const r = parent.getBoundingClientRect();
      pointer.tx = clientX - r.left;
      pointer.ty = clientY - r.top;
      if (!pointer.inside) {
        pointer.x = pointer.tx;
        pointer.y = pointer.ty;
      }
      pointer.inside = true;
      pointer.tpower = 1;
    };
    const onMove = (e: PointerEvent) => movePointer(e.clientX, e.clientY);
    const onLeave = () => {
      pointer.inside = false;
      pointer.tpower = 0;
    };

    parent.addEventListener('pointermove', onMove);
    parent.addEventListener('pointerleave', onLeave);

    const ro = new ResizeObserver(resize);
    ro.observe(parent);
    resize();
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      parent.removeEventListener('pointermove', onMove);
      parent.removeEventListener('pointerleave', onLeave);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
      style={{ zIndex: 5 }}
    />
  );
}
