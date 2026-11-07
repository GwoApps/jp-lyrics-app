import test from 'node:test';
import assert from 'node:assert/strict';
import { getOddDiceMap, getOddDiceGlowIntensity, ODD_DICE_FULL_MAP } from './odd-dice.ts';
import { getMeterBpm, getMeterFrame, isValidMeterMap } from './meter-dice.ts';

const offset = 2043.875;
const player = (sourceMs: number) => sourceMs - offset;
const song = { title: 'Odd Dice', artist: 'millsage', spotify_duration_ms: 248828 };

test('only the named artist, song and verified full recording enable the egg', () => {
  assert.equal(getOddDiceMap(song), ODD_DICE_FULL_MAP);
  assert.equal(getOddDiceMap({ ...song, title: '  ODD   DICE ', artist: 'MILLSAGE' }), ODD_DICE_FULL_MAP);
  assert.equal(getOddDiceMap({ title: 'Odd Dice', artist: 'millsage' }, 248828), ODD_DICE_FULL_MAP);
  for (const invalid of [null, { ...song, artist: 'Cover artist' }, { ...song, title: 'Odd Dice (Live)' },
    { ...song, spotify_duration_ms: 121000 }, { ...song, spotify_duration_ms: 258000 },
    { ...song, spotify_duration_ms: null }, { ...song, spotify_duration_ms: NaN }]) {
    assert.equal(getOddDiceMap(invalid), null);
  }
  assert.equal(getOddDiceMap(song, 121000), null);
  assert.equal(getOddDiceMap(song, NaN), null);
  assert.equal(getOddDiceMap(song, 248800), ODD_DICE_FULL_MAP);
});

test('all observed bars and beats retain exact source values and valid counts', async () => {
  const { default: source } = await import('./meter-maps/odd-dice.observed-source.json', { with: { type: 'json' } });
  const map = ODD_DICE_FULL_MAP;
  assert.equal(isValidMeterMap(map), true);
  assert.equal(map.estimated, undefined);
  assert.equal(map.bars.length, 138);
  assert.equal(map.bars.reduce((n, b) => n + b.beatTimesMs.length, 0), 733);
  for (const [i, b] of map.bars.entries()) {
    const original = source.bars[i];
    assert.deepEqual(b, { startMs: original.startMs, endMs: original.endMs, numerator: original.numerator,
      denominator: original.denominator, beatTimesMs: original.beatTimesMs });
    assert.equal(b.beatTimesMs.length, b.numerator);
    assert.deepEqual(original.inferredBeatTimesMs, []);
    for (const [beatIndex, ms] of b.beatTimesMs.entries()) {
      assert.equal(getMeterFrame(map, player(ms) + 1e-5)?.beatIndex, beatIndex);
      assert.equal(getMeterFrame(map, player(ms) + 1e-5)?.barIndex, i);
      if (beatIndex) assert.equal(getMeterFrame(map, player(ms) - 1e-5)?.beatIndex, beatIndex - 1);
    }
    assert.equal(getMeterFrame(map, player(b.endMs) - 1e-5)?.barIndex, i);
    assert.notEqual(getMeterFrame(map, player(b.endMs) + 1e-5)?.barIndex, i);
  }
});

test('observed boundaries and unknown intro, free time and uncovered tail', () => {
  const map = ODD_DICE_FULL_MAP;
  for (const [source, playback, meter] of [[2933.333, 889.458, 4], [7300, 5256.125, 5],
    [96566.667, 94522.792, 4], [121366.667, 119322.792, 3], [230933.333, 228889.458, 3]]) {
    assert.ok(Math.abs(player(source) - playback) < 1e-7);
    assert.equal(getMeterFrame(map, playback + 1e-5)?.numerator, meter);
    assert.equal(getMeterFrame(map, playback + 1e-5)?.beatIndex, 0);
    assert.notDeepEqual(getMeterFrame(map, playback - 1e-5), getMeterFrame(map, playback + 1e-5));
  }
  assert.equal(player(219200), 217156.125);
  assert.equal(player(248800), 246756.125);
  assert.ok(getMeterFrame(map, 217156.125 - 1e-5));
  assert.ok(getMeterFrame(map, 246756.125 - 1e-5));
  for (const ms of [-1, 0, 889.458 - 1e-5, 217156.125, player(229700), 228889.458 - 1e-5,
    246756.125, 248827.999, 248828]) {
    assert.equal(getMeterFrame(map, ms), null);
    assert.equal(getMeterBpm(map, ms), null);
  }
  for (const duration of [247828, 249828]) assert.equal(getOddDiceMap(song, duration), map);
  for (const duration of [247827, 249829]) assert.equal(getOddDiceMap(song, duration), null);
});

test('all 63 displayed BPM events are preserved, held without interpolation', async () => {
  const { default: source } = await import('./meter-maps/odd-dice.tempo-readouts.json', { with: { type: 'json' } });
  const map = ODD_DICE_FULL_MAP;
  assert.equal(map.tempoChanges?.length, 63);
  assert.deepEqual(map.tempoChanges, source.changes);
  for (const [i, t] of source.changes.entries()) {
    assert.equal(getMeterBpm(map, player(t.startMs) + 1e-5), t.bpm);
    const next = source.changes[i + 1]?.startMs ?? 248800;
    const middle = player((t.startMs + next) / 2);
    assert.equal(getMeterBpm(map, middle), getMeterFrame(map, middle) ? t.bpm : null);
  }
});

test('every beat, bar, tempo and coarse CSV boundary has equivalent source/playback lookup', async () => {
  const { readFile } = await import('node:fs/promises');
  const csv = await readFile(new URL('./meter-maps/odd-dice.full.sections.csv', import.meta.url), 'utf8');
  const map = ODD_DICE_FULL_MAP;
  const sourceMap = { ...map, playbackToSourceOffsetMs: 0, durationMs: map.durationMs + offset };
  assert.equal(map.playbackToSourceOffsetMs, offset);
  const boundaries = [...map.bars.flatMap(b => [b.startMs, ...b.beatTimesMs, b.endMs]),
    ...map.tempoChanges!.map(t => t.startMs), ...csv.trimEnd().split(/\r?\n/u).slice(1).flatMap(row => {
      const c = row.split(','); return [Number(c[1]) * 1000, Number(c[3]) * 1000];
    })];
  for (const boundary of boundaries) for (const eps of [-1e-5, 0, 1e-5]) {
    const ms = player(boundary) + eps;
    const valid = ms >= 0 && ms < map.durationMs;
    assert.deepEqual(getMeterFrame(map, ms), valid ? getMeterFrame(sourceMap, ms + offset) : null);
    assert.equal(getMeterBpm(map, ms), valid ? getMeterBpm(sourceMap, ms + offset) : null);
  }
  // The coarse 7500ms section edge is 200ms later than the observed 5/4 downbeat.
  assert.equal(getMeterFrame(map, player(7300))?.numerator, 5);
  assert.equal(getMeterFrame(map, player(7500))?.beatIndex, 0);
});

test('half-open acceleration and plateau glow windows convert the current map offset exactly once', async () => {
  const { ODD_DICE_GLOW_SOURCE_WINDOWS: source, ODD_DICE_GLOW_WINDOWS: playback } = await import('./odd-dice.ts');
  const { isInMeterGlowWindow } = await import('./meter-dice.ts');
  assert.deepEqual(source, [{ startMs: 57866.667, endMs: 96566.667 }, { startMs: 138966.667, endMs: 230933.333 }]);
  assert.equal(ODD_DICE_FULL_MAP.id, 'odd-dice-audio-aligned-v3');
  assert.equal(ODD_DICE_FULL_MAP.playbackToSourceOffsetMs, offset);
  const expected = [[55822.792, 94522.792], [136922.792, 228889.458]];
  playback.forEach((window, i) => {
    assert.equal(window.startMs, source[i].startMs - offset);
    assert.equal(window.endMs, source[i].endMs - offset);
    assert.ok(Math.abs(window.startMs - expected[i][0]) < 1e-8);
    assert.ok(Math.abs(window.endMs - expected[i][1]) < 1e-8);
    for (const [ms, active] of [[window.startMs - 0.001, false], [window.startMs, true],
      [window.endMs - 0.001, true], [window.endMs, false], [(window.startMs + window.endMs) / 2, true]] as const) {
      assert.equal(isInMeterGlowWindow(playback, ms), active);
    }
    assert.equal(isInMeterGlowWindow(playback, window.endMs + 100), false, 'after the first non-230 event stays off');
  });
  for (const ms of [null, NaN, -1, 100000]) assert.equal(isInMeterGlowWindow(playback, ms), false);
  assert.equal(getOddDiceMap(song), ODD_DICE_FULL_MAP);
  assert.equal(getOddDiceMap({ ...song, spotify_duration_ms: 121000 }), null);
  assert.equal(getOddDiceMap({ ...song, artist: 'someone else' }), null);
});

test('authored 230 plateaus stay fully lit on every valid beat until the first non-230 event', async () => {
  const { ODD_DICE_GLOW_SOURCE_WINDOWS: windows, ODD_DICE_GLOW_WINDOWS: playback } = await import('./odd-dice.ts');
  const { isInMeterGlowWindow } = await import('./meter-dice.ts');
  const map = ODD_DICE_FULL_MAP;
  // Same frame/window gates and BPM resolver as MeterDice's target opacity.
  const target = (sourceMs: number) => {
    const ms = player(sourceMs);
    return getMeterFrame(map, ms) && isInMeterGlowWindow(playback, ms)
      ? getOddDiceGlowIntensity(getMeterBpm(map, ms)) : 0;
  };
  windows.forEach((window, i) => {
    const plateauIndex = map.tempoChanges!.findIndex(t => t.startMs >= window.startMs && t.bpm === 230);
    const plateau = map.tempoChanges![plateauIndex];
    const exit = map.tempoChanges!.slice(plateauIndex + 1).find(t => t.bpm !== 230)!;
    assert.equal(plateau.startMs, [68000, 143833.333][i], 'old acceleration endpoint');
    assert.equal(window.endMs, exit.startMs, 'constant must match the first authored non-230 event');
    assert.equal(exit.bpm, [145, 141][i]);
    const lastValid = i === 0 ? exit.startMs : 219200;
    for (const sourceMs of [plateau.startMs - 0.001, plateau.startMs,
      plateau.startMs + 0.001, (plateau.startMs + lastValid) / 2, lastValid - 0.001,
      ...map.bars.flatMap(b => b.beatTimesMs).filter(ms => ms >= plateau.startMs && ms < exit.startMs)]) {
      assert.ok(getMeterFrame(map, player(sourceMs)), `valid frame at ${sourceMs}`);
      assert.ok(isInMeterGlowWindow(playback, player(sourceMs)));
      assert.equal(getMeterBpm(map, player(sourceMs)), sourceMs < plateau.startMs ? 228 : 230);
      assert.equal(target(sourceMs), sourceMs < plateau.startMs ? getOddDiceGlowIntensity(228) : 1);
    }
    assert.equal(target(window.startMs - 0.001), 0);
    assert.ok(target(window.startMs) > 0);
    assert.ok(getMeterFrame(map, player(exit.startMs)));
    assert.equal(getMeterBpm(map, player(exit.startMs)), exit.bpm);
    assert.equal(target(exit.startMs), 0, 'first non-230 event immediately sets off target');
    assert.equal(target(exit.startMs + 0.001), 0);
  });
  for (const sourceMs of [219200, (219200 + 230933.333) / 2, 230933.333 - 0.001]) {
    assert.ok(isInMeterGlowWindow(playback, player(sourceMs)), 'window covers the whole authored plateau');
    assert.equal(getMeterFrame(map, player(sourceMs)), null);
    assert.equal(getMeterBpm(map, player(sourceMs)), null);
    assert.equal(target(sourceMs), 0, 'uncovered free time retains the frame gate');
  }
  for (const sourceMs of [30000, 110000, 240000]) assert.equal(target(sourceMs), 0);
});

test('glow intensity normalizes authored BPM monotonically, independent of window duration', () => {
  for (const bpm of [null, NaN, Infinity, -Infinity, 0, -1]) {
    assert.equal(getOddDiceGlowIntensity(bpm), 0);
  }
  const bpms = [120, 165, 175, 190, 197.5, 210, 230, 250];
  const values = bpms.map(getOddDiceGlowIntensity);
  assert.equal(values[0], 0.2);
  assert.equal(values[1], 0.2);
  assert.ok(Math.abs(getOddDiceGlowIntensity(197.5) - 0.6) < 1e-10);
  assert.equal(values.at(-2), 1);
  assert.equal(values.at(-1), 1);
  assert.ok(values.every((value, i) => i === 0 || value >= values[i - 1]));
  const windows = [[57866.667, 68000], [138966.667, 143833.333]];
  const byBpm = windows.map(([start, end]) => new Map(
    ODD_DICE_FULL_MAP.tempoChanges!.filter((event) => event.startMs >= start && event.startMs < end)
      .map((event) => {
        const bpm = getMeterBpm(ODD_DICE_FULL_MAP, player(event.startMs));
        return [bpm, { intensity: getOddDiceGlowIntensity(bpm), fraction: (event.startMs - start) / (end - start) }];
      }),
  ));
  let shared = 0;
  let differentFraction = false;
  for (const [bpm, first] of byBpm[0]) {
    const second = byBpm[1].get(bpm);
    if (!second) continue;
    shared++;
    assert.equal(first.intensity, second.intensity);
    if (Math.abs(first.fraction - second.fraction) > 0.01) differentFraction = true;
  }
  assert.ok(shared > 1);
  assert.ok(differentFraction, 'same BPM at different window fractions must still have equal intensity');
});
