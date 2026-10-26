export const ROLLBACK_DURATION_MS = 200;

// The progress ref may jump before React commits the next active row. Never
// paint the NEW row's seek position onto the OLD focused label: doing so would
// make the jump look continuous when the rollback guard finally checks it.
export function shouldUpdateFocusedClock(current: number, nextTimed: number | null, focusedTimed: number | null): boolean {
  return nextTimed == null || focusedTimed == null || nextTimed <= focusedTimed || current < nextTimed;
}

// A large delta between rendered clock frames means the user sought or the tab
// stalled; don't play the natural line-end animation for that discontinuity.
export function isContinuousPlaybackAdvance(previous: number | null, current: number | null): boolean {
  return previous != null && current != null
    && Number.isFinite(previous) && Number.isFinite(current)
    && current >= previous && current - previous <= 750;
}

/** Ease a departed live clock backwards to its lyric timestamp in 200ms. */
export function rollbackTimeMs(from: number, target: number, elapsed: number): number {
  if (from <= target) return target;
  const progress = Math.max(0, Math.min(1, elapsed / ROLLBACK_DURATION_MS));
  return Math.round(target + (from - target) * (1 - progress) ** 3);
}
