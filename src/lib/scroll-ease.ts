'use client';

/**
 * Apple-style smooth scroll animation for the lyrics panel.
 *
 * Native `scrollTo({ behavior: 'smooth' })` eases linearly-ish; this drives
 * the scroll position manually with an easeOutQuart curve — a fast, confident
 * start that decelerates gracefully into place (the feel of Apple Music's
 * lyric follow). Duration scales with distance so adjacent-line follows feel
 * snappy while long jumps (progress bar scrubbing) glide.
 */

let activeAnim: { raf: number; container: HTMLElement } | null = null;

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

/** easeOutQuart: 1 - (1-t)^4 — fast start, graceful settle. */
const easeOutQuart = (t: number) => 1 - Math.pow(1 - t, 4);

/**
 * Animate `container.scrollTop` toward `targetTop`. Any in-flight animation
 * on the same container is cancelled (a newer follow wins). Manual scrolling
 * is not interrupted — the animation simply finishes on its own.
 */
export function animateSmoothScroll(
  container: HTMLElement,
  targetTop: number,
  durationMs?: number,
): void {
  const start = container.scrollTop;
  const distance = targetTop - start;
  if (Math.abs(distance) < 1) return;

  if (activeAnim && activeAnim.container === container) {
    cancelAnimationFrame(activeAnim.raf);
    activeAnim = null;
  }

  // ~0.55ms per px, clamped: 220ms for an adjacent line, 700ms for a full jump.
  const duration =
    durationMs ?? clamp(Math.abs(distance) * 0.55, 220, 700);
  const startTime = performance.now();

  const step = (now: number) => {
    const progress = Math.min(1, (now - startTime) / duration);
    container.scrollTop = start + distance * easeOutQuart(progress);
    if (progress < 1) {
      activeAnim = { container, raf: requestAnimationFrame(step) };
    } else {
      activeAnim = null;
    }
  };

  activeAnim = { container, raf: requestAnimationFrame(step) };
}
