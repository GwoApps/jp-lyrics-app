import test from 'node:test';
import assert from 'node:assert/strict';
import { getOddDiceMap, ODD_DICE_FULL_MAP } from './odd-dice.ts';
import { getMeterBpm, getMeterFrame, isValidMeterMap } from './meter-dice.ts';

const offset = 8 * 60000 / 165;
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

test('estimated map validates every generated bar and beat boundary', () => {
  const map = ODD_DICE_FULL_MAP;
  assert.equal(map.estimated, true);
  assert.equal(isValidMeterMap(map), true);
  assert.equal(map.bars.length, 157);
  assert.equal(map.bars.reduce((n, b) => n + b.beatTimesMs.length, 0), 766);
  assert.equal(map.bars.filter((b) => b.partial).length, 24);
  assert.equal(map.tempoChanges?.length, 30);
  for (const [index, bar] of map.bars.entries()) {
    assert.ok(bar.endMs <= map.durationMs + offset);
    if (player(bar.endMs) <= 0) {
      assert.equal(getMeterFrame(map, player(bar.startMs)), null);
      continue;
    }
    assert.equal(getMeterFrame(map, player(bar.endMs) - 0.00001)?.barIndex, index);
    assert.notEqual(getMeterFrame(map, player(bar.endMs) + 0.00001)?.barIndex, index);
    for (const [beat, ms] of bar.beatTimesMs.entries()) {
      if (player(ms) < 0) { assert.equal(getMeterFrame(map, player(ms)), null); continue; }
      assert.deepEqual(getMeterFrame(map, player(ms) + 0.00001), { barIndex: index, beatIndex: beat, litCount: beat + 1,
        numerator: bar.numerator, denominator: 4 });
      if (beat) {
        assert.equal(getMeterFrame(map, player(ms) - 0.00001)?.beatIndex, beat - 1);
        assert.ok(ms - bar.beatTimesMs[beat - 1] > 260);
      }
    }
  }
});

test('CSV meter boundaries, unknown intro, free time and recording clipping', () => {
  const map = ODD_DICE_FULL_MAP;
  for (const [ms, before, after] of [[7500, 4, 5], [9000, 5, 6], [11500, 6, 5],
    [96500, 6, 4], [121500, 4, 3], [125000, 3, 5]]) {
    assert.equal(getMeterFrame(map, player(ms) - 0.001)?.numerator, before);
    assert.equal(getMeterFrame(map, player(ms))?.numerator, after);
    assert.equal(getMeterFrame(map, player(ms))?.beatIndex, 0);
  }
  for (const ms of [-1, player(219000), player(225000), player(229499.999), player(249500), 248827.999, 248828, 253000]) {
    assert.equal(getMeterFrame(map, ms), null);
    assert.equal(getMeterBpm(map, ms), null);
  }
  assert.equal(getMeterFrame(map, 0)?.numerator, 4);
  assert.equal(getMeterFrame(map, player(218999.999))?.numerator, 6);
  assert.equal(getMeterFrame(map, player(229500))?.numerator, 3);
  assert.equal(getMeterFrame(map, player(229500))?.beatIndex, 0);
  assert.equal(getMeterFrame(map, player(249500) - 0.001)?.numerator, 3);
  for (const duration of [247828, 249828]) assert.equal(getOddDiceMap(song, duration), map);
  for (const duration of [247827, 249829, 253000]) assert.equal(getOddDiceMap(song, duration), null);
});

test('staircase/platform estimates and source-endpoint ritardando', () => {
  const map = ODD_DICE_FULL_MAP;
  for (const [ms, bpm] of [[offset, 165], [58500, 170], [61500, 188], [67500, 230],
    [96500, 145], [143500, 230], [229500, 141], [232000, 139]]) assert.equal(getMeterBpm(map, player(ms)), bpm);
  assert.equal(getMeterBpm(map, player(240750)), 131.5);
  assert.ok(getMeterBpm(map, player(248827))! > 124);
  assert.ok(getMeterBpm(map, player(248000))! < getMeterBpm(map, player(240000))!);
  for (const boundary of [58500, 61500, 67500, 140500, 143500, 232000]) {
    assert.deepEqual(getMeterFrame(map, player(boundary) - 0.001), getMeterFrame(map, player(boundary)));
  }
});


test('manual zero anchor preserves the existing bar phase for both lookups', () => {
  const map = ODD_DICE_FULL_MAP;
  const sourceMap = { ...map, playbackToSourceOffsetMs: 0, durationMs: map.durationMs + offset };
  assert.equal(map.playbackToSourceOffsetMs, offset);
  assert.deepEqual(getMeterFrame(map, 0), getMeterFrame(sourceMap, offset));
  assert.equal(getMeterFrame(map, 0)?.litCount, 3);
  assert.equal(getMeterBpm(map, 0), getMeterBpm(sourceMap, offset));
  for (const bar of map.bars) {
    for (const boundary of [bar.startMs, ...bar.beatTimesMs, bar.endMs]) {
      for (const eps of [-0.00001, 0.00001]) {
        const playback = player(boundary) + eps;
        if (playback < 0 || playback >= map.durationMs) continue;
        assert.deepEqual(getMeterFrame(map, playback), getMeterFrame(sourceMap, playback + offset));
        assert.equal(getMeterBpm(map, playback), getMeterBpm(sourceMap, playback + offset));
      }
    }
  }
});


test('every CSV section agrees with source lookup on both sides of its boundaries', async () => {
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(new URL('./meter-maps/odd-dice.full.sections.csv', import.meta.url), 'utf8');
  const rows = raw.replace(/^\uFEFF/u, '').trimEnd().split(/\r?\n/u).slice(1);
  const map = ODD_DICE_FULL_MAP;
  const sourceMap = { ...map, playbackToSourceOffsetMs: 0, durationMs: 253000 };
  for (const row of rows) {
    const cells = row.split(',');
    for (const source of [Number(cells[1]) * 1000, Number(cells[3]) * 1000]) {
      for (const eps of [-0.00001, 0.00001]) {
        const ms = player(source) + eps;
        const valid = ms >= 0 && ms < map.durationMs;
        assert.deepEqual(getMeterFrame(map, ms), valid ? getMeterFrame(sourceMap, ms + offset) : null);
        assert.equal(getMeterBpm(map, ms), valid ? getMeterBpm(sourceMap, ms + offset) : null);
      }
    }
  }
});
