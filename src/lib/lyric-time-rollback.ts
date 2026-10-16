export const ROLLBACK_DURATION_MS = 320;

// A large delta between rendered clock frames means the user sought or the tab
// stalled; don't play the natural line-end animation for that discontinuity.
export function isContinuousPlaybackAdvance(previous: number | null, current: number | null): boolean {
  return previous != null && current != null
    && Number.isFinite(previous) && Number.isFinite(current)
    && current >= previous && current - previous <= 750;
}

/** Ease a departed live clock backwards to its lyric timestamp in 320ms. */
export function rollbackTimeMs(from: number, target: number, elapsed: number): number {
  if (from <= target) return target;
  const progress = Math.max(0, Math.min(1, elapsed / ROLLBACK_DURATION_MS));
  return Math.round(target + (from - target) * (1 - progress) ** 3);
}
