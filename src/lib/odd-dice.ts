import fullVersion from './meter-maps/odd-dice.full.json' with { type: 'json' };
import type { MeterMap } from './meter-dice.ts';

/** Video-frame-observed, waveform-aligned full-version meter map; see docs/odd-dice-meter.md. */
export const ODD_DICE_FULL_MAP: MeterMap = fullVersion;
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
