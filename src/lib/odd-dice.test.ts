import test from 'node:test';
import assert from 'node:assert/strict';
import { getOddDiceMap, ODD_DICE_FULL_MAP } from './odd-dice.ts';
import { getMeterBpm, getMeterFrame, isValidMeterMap } from './meter-dice.ts';

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
  assert.equal(map.bars.reduce((n, b) => n + b.beatTimesMs.length, 0), 764);
  assert.equal(map.bars.filter((b) => b.partial).length, 24);
  assert.equal(map.tempoChanges?.length, 30);
  for (const [index, bar] of map.bars.entries()) {
    assert.equal(getMeterFrame(map, bar.endMs - 0.00001)?.barIndex, index);
    assert.notEqual(getMeterFrame(map, bar.endMs)?.barIndex, index);
    for (const [beat, ms] of bar.beatTimesMs.entries()) {
      assert.deepEqual(getMeterFrame(map, ms), { barIndex: index, beatIndex: beat, litCount: beat + 1,
        numerator: bar.numerator, denominator: 4 });
      if (beat) {
        assert.equal(getMeterFrame(map, ms - 0.00001)?.beatIndex, beat - 1);
        assert.ok(ms - bar.beatTimesMs[beat - 1] > 260);
      }
    }
  }
});

test('CSV meter boundaries, unknown intro, free time and recording clipping', () => {
  const map = ODD_DICE_FULL_MAP;
  for (const [ms, before, after] of [[7500, 4, 5], [9000, 5, 6], [11500, 6, 5],
    [96500, 6, 4], [121500, 4, 3], [125000, 3, 5]]) {
    assert.equal(getMeterFrame(map, ms - 0.001)?.numerator, before);
    assert.equal(getMeterFrame(map, ms)?.numerator, after);
    assert.equal(getMeterFrame(map, ms)?.beatIndex, 0);
  }
  for (const ms of [0, 499.999, 219000, 225000, 229499.999, 248828, 249500, 253000]) {
    assert.equal(getMeterFrame(map, ms), null);
    assert.equal(getMeterBpm(map, ms), null);
  }
  assert.equal(getMeterFrame(map, 500)?.numerator, 4);
  assert.equal(getMeterFrame(map, 218999.999)?.numerator, 6);
  assert.equal(getMeterFrame(map, 229500)?.numerator, 3);
  assert.equal(getMeterFrame(map, 229500)?.beatIndex, 0);
  assert.equal(getMeterFrame(map, 248827.999)?.numerator, 3);
  for (const duration of [247828, 249828]) assert.equal(getOddDiceMap(song, duration), map);
  for (const duration of [247827, 249829, 253000]) assert.equal(getOddDiceMap(song, duration), null);
});

test('staircase/platform estimates and source-endpoint ritardando', () => {
  const map = ODD_DICE_FULL_MAP;
  for (const [ms, bpm] of [[500, 165], [58500, 170], [61500, 188], [67500, 230],
    [96500, 145], [143500, 230], [229500, 141], [232000, 139]]) assert.equal(getMeterBpm(map, ms), bpm);
  assert.equal(getMeterBpm(map, 240750), 131.5);
  assert.ok(getMeterBpm(map, 248827)! > 124);
  assert.ok(getMeterBpm(map, 248000)! < getMeterBpm(map, 240000)!);
  for (const boundary of [58500, 61500, 67500, 140500, 143500, 232000]) {
    assert.deepEqual(getMeterFrame(map, boundary - 0.001), getMeterFrame(map, boundary));
  }
});
