/** Authored absolute beat times, not a BPM approximation or a generated chart. */
export interface MeterBar {
  readonly startMs: number;
  readonly endMs: number;
  readonly numerator: number;
  readonly denominator: number;
  /** Includes this bar's downbeat; excludes the following bar's downbeat. */
  readonly beatTimesMs: readonly number[];
}

export interface MeterTempoChange {
  readonly startMs: number;
  /** Source-authored/displayed quarter-note BPM, not rounded video-frame beat spacing. */
  readonly bpm: number;
}

export interface MeterMap {
  readonly id: string;
  readonly durationMs: number;
  readonly bars: readonly MeterBar[];
  readonly tempoChanges?: readonly MeterTempoChange[];
}

export interface MeterFrame {
  readonly barIndex: number;
  /** Zero-based, including in compound meters: 6/8 has six eighth-note beats. */
  readonly beatIndex: number;
  readonly litCount: number;
  readonly numerator: number;
  readonly denominator: number;
}

export interface MeterPlayback {
  readonly progress_ms: number;
  readonly is_playing: boolean;
}

export interface DicePip {
  /** Coordinates within an SVG viewBox of 0 0 100 100. */
  readonly x: number;
  readonly y: number;
}

/** Validate once at the data boundary, never scan the chart on every frame. */
export function isValidMeterMap(map: MeterMap): boolean {
  if (!map.id || !Number.isFinite(map.durationMs) || map.durationMs <= 0 || !map.bars.length) return false;
  let previousEnd = 0;
  for (const bar of map.bars) {
    if (!Number.isFinite(bar.startMs) || !Number.isFinite(bar.endMs)
      || bar.startMs < previousEnd || bar.endMs <= bar.startMs || bar.endMs > map.durationMs
      || !Number.isSafeInteger(bar.numerator) || bar.numerator < 1
      || !Number.isSafeInteger(bar.denominator) || bar.denominator < 1
      || bar.beatTimesMs.length !== bar.numerator || bar.beatTimesMs[0] !== bar.startMs) return false;
    let previousBeat = -Infinity;
    for (const beat of bar.beatTimesMs) {
      if (!Number.isFinite(beat) || beat < bar.startMs || beat >= bar.endMs || beat <= previousBeat) return false;
      previousBeat = beat;
    }
    previousEnd = bar.endMs;
  }
  let previousTempo = -Infinity;
  for (const tempo of map.tempoChanges ?? []) {
    if (!Number.isFinite(tempo.startMs) || tempo.startMs < 0 || tempo.startMs >= map.durationMs
      || tempo.startMs <= previousTempo || !Number.isFinite(tempo.bpm) || tempo.bpm <= 0) return false;
    previousTempo = tempo.startMs;
  }
  return true;
}

/** First index whose value is greater than `time`; O(log n). */
function upperBound(length: number, valueAt: (index: number) => number, time: number): number {
  let low = 0;
  let high = length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (valueAt(middle) <= time) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * Stateless lookup into a validated map: bar and beat intervals are [start, end).
 * Seeking in either direction is the same lookup, never a replay of missed beats.
 * Missing progress, an intro, chart gaps and the song's end all return null.
 */
export function getMeterFrame(map: MeterMap, playbackMs: number | null): MeterFrame | null {
  if (playbackMs == null || !Number.isFinite(playbackMs) || playbackMs < 0
    || !Number.isFinite(map.durationMs) || playbackMs >= map.durationMs) return null;
  const barIndex = upperBound(map.bars.length, (index) => map.bars[index].startMs, playbackMs) - 1;
  const bar = map.bars[barIndex];
  if (!bar || playbackMs >= bar.endMs) return null;
  const beatIndex = upperBound(bar.beatTimesMs.length, (index) => bar.beatTimesMs[index], playbackMs) - 1;
  if (beatIndex < 0 || beatIndex >= bar.numerator) return null;
  return { barIndex, beatIndex, litCount: beatIndex + 1, numerator: bar.numerator, denominator: bar.denominator };
}

/** Look up the last reliable source BPM; free time and unknown tempos stay empty. */
export function getMeterBpm(map: MeterMap, playbackMs: number | null): number | null {
  if (playbackMs == null || !getMeterFrame(map, playbackMs)) return null;
  const changes = map.tempoChanges ?? [];
  const index = upperBound(changes.length, (i) => changes[i].startMs, playbackMs) - 1;
  return changes[index]?.bpm ?? null;
}

/**
 * useSpotifySync owns the only clock. Its ref is null while paused/hidden.
 * A non-null paused ref is a freshly confirmed seek; otherwise use the paused
 * snapshot. Never fall back to a stale poll while playing, or turn null into 0.
 */
export function meterPlaybackMs(
  matching: boolean,
  playback: MeterPlayback | null,
  interpolatedMs: number | null,
): number | null {
  if (!matching || !playback) return null;
  const ms = playback.is_playing ? interpolatedMs : interpolatedMs ?? playback.progress_ms;
  return ms != null && Number.isFinite(ms) && ms >= 0 ? ms : null;
}

/**
 * Only a sampled, continuous adjacent-bar meter change gets a turn. Wall time
 * is a discontinuity guard only: it must NEVER be added to playback position.
 * Stalls, skips, rewinds and initial positioning snap straight to the target.
 */
export function shouldRotateMeterDice(
  previous: MeterFrame | null,
  next: MeterFrame | null,
  previousMs: number | null,
  nextMs: number | null,
  sampleElapsedMs: number,
): boolean {
  if (!previous || !next || previousMs == null || nextMs == null
    || !Number.isFinite(previousMs) || !Number.isFinite(nextMs)
    || !Number.isFinite(sampleElapsedMs) || sampleElapsedMs < 0 || sampleElapsedMs > 250) return false;
  const advance = nextMs - previousMs;
  return advance > 0 && Math.abs(advance - sampleElapsedMs) <= 50
    && next.barIndex === previous.barIndex + 1
    && (next.numerator !== previous.numerator || next.denominator !== previous.denominator);
}

const STANDARD_PIPS: readonly (readonly DicePip[])[] = [
  [],
  [{ x: 50, y: 50 }],
  [{ x: 25, y: 25 }, { x: 75, y: 75 }],
  [{ x: 25, y: 25 }, { x: 50, y: 50 }, { x: 75, y: 75 }],
  [{ x: 25, y: 25 }, { x: 75, y: 25 }, { x: 25, y: 75 }, { x: 75, y: 75 }],
  [{ x: 25, y: 25 }, { x: 75, y: 25 }, { x: 50, y: 50 }, { x: 25, y: 75 }, { x: 75, y: 75 }],
  [{ x: 25, y: 25 }, { x: 75, y: 25 }, { x: 25, y: 50 }, { x: 75, y: 50 }, { x: 25, y: 75 }, { x: 75, y: 75 }],
];

/** Standard die faces for 1–6, then a centered grid for larger numerators. */
export function getDicePips(numerator: number): readonly DicePip[] {
  if (!Number.isSafeInteger(numerator) || numerator < 1) return [];
  if (numerator <= 6) return STANDARD_PIPS[numerator];
  const columns = Math.ceil(Math.sqrt(numerator));
  const rows = Math.ceil(numerator / columns);
  return Array.from({ length: numerator }, (_, index) => {
    const row = Math.floor(index / columns);
    const rowLength = Math.min(columns, numerator - row * columns);
    return {
      x: 50 + (index % columns - (rowLength - 1) / 2) * 60 / columns,
      y: 50 + (row - (rows - 1) / 2) * 60 / rows,
    };
  });
}
