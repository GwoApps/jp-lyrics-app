import fullVersion from './meter-maps/odd-dice.full.json' with { type: 'json' };
import type { MeterMap, MeterGlowWindow } from './meter-dice.ts';

/** Video-frame-observed, waveform-aligned full-version meter map; see docs/odd-dice-meter.md. */
export const ODD_DICE_FULL_MAP: MeterMap = fullVersion;
/** First rising BPM readout through (excluding) the first non-230 BPM event after the plateau. */
export const ODD_DICE_GLOW_SOURCE_WINDOWS: readonly MeterGlowWindow[] = Object.freeze([
  Object.freeze({ startMs: 57866.667, endMs: 96566.667 }),
  Object.freeze({ startMs: 138966.667, endMs: 230933.333 }),
]);
/** Convert exactly once; consumers compare directly with the shared playback clock. */
export const ODD_DICE_GLOW_WINDOWS: readonly MeterGlowWindow[] = Object.freeze(
  ODD_DICE_GLOW_SOURCE_WINDOWS.map(({ startMs, endMs }) => Object.freeze({
    startMs: startMs - (ODD_DICE_FULL_MAP.playbackToSourceOffsetMs ?? 0),
    endMs: endMs - (ODD_DICE_FULL_MAP.playbackToSourceOffsetMs ?? 0),
  })),
);
/** Current authored BPM, independent of either accelerando window's duration. */
export function getOddDiceGlowIntensity(bpm: number | null): number {
  if (bpm == null || !Number.isFinite(bpm) || bpm <= 0) return 0;
  return 0.2 + 0.8 * Math.max(0, Math.min(1, (bpm - 165) / (230 - 165)));
}

const VERSION_TOLERANCE_MS = 1000;

interface SongIdentity {
  title: string;
  artist: string;
  spotify_duration_ms?: number | null;
}

function identity(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
}

/** Fail closed for other songs, unknown versions, game cuts and extended edits. */
export function getOddDiceMap(song: SongIdentity | null, playbackDurationMs?: number | null): MeterMap | null {
  if (!song || identity(song.title) !== 'odd dice' || identity(song.artist) !== 'millsage') return null;
  const duration = song.spotify_duration_ms ?? playbackDurationMs;
  if (duration == null || !Number.isFinite(duration)
    || Math.abs(duration - ODD_DICE_FULL_MAP.durationMs) > VERSION_TOLERANCE_MS) return null;
  // An actually playing track's duration must also agree; an ID match alone
  // must not apply this full-song chart to a different recording/edit.
  if (playbackDurationMs != null && (!Number.isFinite(playbackDurationMs)
    || Math.abs(playbackDurationMs - ODD_DICE_FULL_MAP.durationMs) > VERSION_TOLERANCE_MS)) return null;
  return ODD_DICE_FULL_MAP;
}
