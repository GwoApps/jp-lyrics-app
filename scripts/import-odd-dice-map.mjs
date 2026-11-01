import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

// Import the observed full-version chart, never the 121-second game cut.
// See docs/odd-dice-meter.md for extraction, provenance and accuracy limits.
const input = process.argv[2];
const tempoInput = process.argv[3];
if (!input || !tempoInput) throw new Error('Usage: node scripts/import-odd-dice-map.mjs <refined_meter_map.json> <bpm_readouts.json>');
const raw = await readFile(input, 'utf8');
const source = JSON.parse(raw);
assert.equal(source.barCount, 138);
assert.equal(source.bars.length, 138);
let end = 0;
const bars = source.bars.map((bar, index) => {
  assert.equal(bar.bar, index + 1);
  assert.ok([3, 4, 5, 6].includes(bar.numerator));
  assert.equal(bar.denominator, 4);
  assert.equal(bar.inferredBeatTimesMs.length, 0, 'Interpolated beats must not enter the observed map');
  assert.equal(bar.beatTimesMs.length, bar.numerator);
  assert.equal(bar.startMs, bar.beatTimesMs[0]);
  assert.ok(Number.isFinite(bar.startMs) && bar.startMs >= end);
  assert.ok(Number.isFinite(bar.endMs) && bar.endMs > bar.startMs && bar.endMs <= 248828);
  let previousBeat = -Infinity;
  for (const beat of bar.beatTimesMs) {
    assert.ok(Number.isFinite(beat) && beat >= bar.startMs && beat < bar.endMs && beat > previousBeat);
    previousBeat = beat;
  }
  end = bar.endMs;
  return { startMs: bar.startMs, endMs: bar.endMs, numerator: bar.numerator, denominator: bar.denominator, beatTimesMs: bar.beatTimesMs };
});
const tempoRaw = await readFile(tempoInput, 'utf8');
const tempoSource = JSON.parse(tempoRaw);
assert.ok(Array.isArray(tempoSource.changes) && tempoSource.changes.length > 0);
let previousTempo = -Infinity;
const tempoChanges = tempoSource.changes.map(({ startMs, bpm }) => {
  assert.ok(Number.isFinite(startMs) && startMs >= 0 && startMs < 248828 && startMs > previousTempo);
  assert.ok(Number.isFinite(bpm) && bpm > 0);
  previousTempo = startMs;
  return { startMs, bpm };
});
const payload = {
  id: 'odd-dice-full-bv1yhjq6le4q',
  durationMs: 248828,
  source: 'https://www.bilibili.com/video/BV1YhJq6LE4Q/',
  sourceKind: 'community-transcription',
  sourceSha256: createHash('sha256').update(raw).digest('hex'),
  frameResolutionMs: 1000 / 30,
  tempoSourceSha256: createHash('sha256').update(tempoRaw).digest('hex'),
  tempoSampleIntervalMs: tempoSource.sampleIntervalMs,
  tempoChanges,
  bars,
};
const target = new URL('../src/lib/meter-maps/odd-dice.full.json', import.meta.url);
await mkdir(new URL('.', target), { recursive: true });
await writeFile(target, `${JSON.stringify(payload, null, 2)}\n`);
console.log(JSON.stringify({ target: fileURLToPath(target), bars: bars.length, beats: bars.reduce((total, bar) => total + bar.numerator, 0), inferred: 0, tempoChanges: tempoChanges.length }));
