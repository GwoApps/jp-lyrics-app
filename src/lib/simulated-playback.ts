import type { FuriganaLine } from './types.ts';

export interface PlaybackClock {
  positionMs: number;
  startedAt: number;
  playing: boolean;
}

export function clockPosition(clock: PlaybackClock, now: number, durationMs: number): number {
  return Math.min(durationMs, Math.max(0, clock.positionMs + (clock.playing ? Math.max(0, now - clock.startedAt) : 0)));
}

/** Preview-only timing. Never persist estimated timestamps as real LRC data. */
export function previewTimeline(timestamps: (number | null)[], lines: FuriganaLine[], duration?: number | null) {
  const timed = timestamps.filter((ms): ms is number => ms != null && Number.isFinite(ms) && ms >= 0);
  const readable = lines.flatMap((line, index) => line.segments.some((s) => s.text.trim()) ? [index] : []);
  const knownDuration = typeof duration === 'number' && Number.isFinite(duration) && duration > 0 ? duration : 0;
  if (timed.length) {
    return { timestamps, durationMs: Math.max(knownDuration, Math.max(...timed) + 1000), estimated: false };
  }
  const durationMs = knownDuration || Math.max(1, readable.length) * 4000;
  const estimated: (number | null)[] = lines.map(() => null);
  readable.forEach((index, slot) => { estimated[index] = slot * durationMs / readable.length; });
  return { timestamps: estimated, durationMs, estimated: true };
}
