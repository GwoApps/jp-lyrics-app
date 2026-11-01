import test from 'node:test';
import assert from 'node:assert/strict';
import { getOddDiceMap, ODD_DICE_FULL_MAP } from './odd-dice.ts';
import { getMeterFrame, isValidMeterMap } from './meter-dice.ts';

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

test('the observed full map contains 138 valid bars, 733 ordered beats and all four observed faces', () => {
  assert.equal(isValidMeterMap(ODD_DICE_FULL_MAP), true);
  assert.equal(ODD_DICE_FULL_MAP.bars.length, 138);
  assert.equal(ODD_DICE_FULL_MAP.bars.reduce((count, bar) => count + bar.beatTimesMs.length, 0), 733);
  assert.deepEqual([...new Set(ODD_DICE_FULL_MAP.bars.map((bar) => bar.numerator))].sort(), [3, 4, 5, 6]);
  for (const [index, bar] of ODD_DICE_FULL_MAP.bars.entries()) {
    for (const [beat, ms] of bar.beatTimesMs.entries()) {
      const frame = getMeterFrame(ODD_DICE_FULL_MAP, ms);
      assert.deepEqual(frame, { barIndex: index, beatIndex: beat, litCount: beat + 1, numerator: bar.numerator, denominator: 4 });
      if (beat > 0) assert.equal(getMeterFrame(ODD_DICE_FULL_MAP, ms - 0.001)?.beatIndex, beat - 1);
    }
  }
});

test('real signature changes and unmetered rests use authored full-song timestamps', () => {
  assert.equal(getMeterFrame(ODD_DICE_FULL_MAP, 0), null); // source count-in, not a fabricated bar
  assert.equal(getMeterFrame(ODD_DICE_FULL_MAP, 7300)?.numerator, 5);
  assert.equal(getMeterFrame(ODD_DICE_FULL_MAP, 9100)?.numerator, 6);
  assert.equal(getMeterFrame(ODD_DICE_FULL_MAP, 96566.667)?.numerator, 4);
  assert.equal(getMeterFrame(ODD_DICE_FULL_MAP, 121366.667)?.numerator, 3);
  assert.equal(getMeterFrame(ODD_DICE_FULL_MAP, 125100)?.numerator, 5);
  assert.equal(getMeterFrame(ODD_DICE_FULL_MAP, 219199)?.numerator, 6);
  for (const ms of [219200, 225000, 229700, 230933.332]) assert.equal(getMeterFrame(ODD_DICE_FULL_MAP, ms), null);
  assert.equal(getMeterFrame(ODD_DICE_FULL_MAP, 230933.333)?.numerator, 3);
  assert.equal(getMeterFrame(ODD_DICE_FULL_MAP, 242566.667)?.litCount, 3);
  assert.equal(getMeterFrame(ODD_DICE_FULL_MAP, 248799)?.litCount, 3); // sustained final chord
  assert.equal(getMeterFrame(ODD_DICE_FULL_MAP, 248800), null);
  assert.equal(getMeterFrame(ODD_DICE_FULL_MAP, 248828), null);
});

test('accelerando and ritardando retain measured nonuniform beats instead of one BPM', () => {
  for (const index of [29, 79, 136]) {
    const beats = ODD_DICE_FULL_MAP.bars[index].beatTimesMs;
    const intervals = beats.slice(1).map((ms, i) => Math.round(ms - beats[i]));
    assert.ok(new Set(intervals).size > 1);
  }
});
