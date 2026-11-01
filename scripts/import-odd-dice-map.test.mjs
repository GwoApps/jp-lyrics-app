import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { generateMap, parseSections, writeMap } from './import-odd-dice-map.mjs';

const raw = await readFile(new URL('../src/lib/meter-maps/odd-dice.full.sections.csv', import.meta.url), 'utf8');
const stored = await readFile(new URL('../src/lib/meter-maps/odd-dice.full.json', import.meta.url), 'utf8');
const rows = raw.replace(/^\uFEFF/u, '').trimEnd().split(/\r?\n/u).map((s) => s.split(','));
// Mutated fixtures are synthetic validation cases, not measured scores.
const mutate = (row, col, value) => rows.map((r, i) => r.map((v, j) => i === row && j === col ? value : v).join(',')).join('\n');

test('all 32 rows retain every source field and exact clipping', () => {
  const sections = parseSections(raw);
  for (const [i, s] of sections.entries()) {
    const r = rows[i + 1];
    assert.deepEqual([s.section, s.startMs, s.endMs, s.meter, s.bpmMin, s.bpmMax, s.estimatedBars],
      [Number(r[0]), Number(r[1]) * 1000, Number(r[3]) * 1000, r[5], Number(r[6]), Number(r[7]), Number(r[8])]);
    assert.equal(s.runtimeStartMs, i === 31 ? null : s.startMs);
    assert.equal(s.runtimeEndMs, i === 31 ? null : Math.min(s.endMs, 248828));
  }
  assert.equal(generateMap(raw).sourceSha256, createHash('sha256').update(raw).digest('hex'));
});

test('all generated beats solve the continuous phase integral within each meter run', () => {
  const map = generateMap(raw);
  let phase = 0, priorMeter = null;
  for (const s of map.sourceSections) {
    if (s.runtimeStartMs === null) continue;
    if (s.meter === 'senza tempo') { priorMeter = null; continue; }
    if (s.meter !== priorMeter) phase = 0;
    const p = map.tempoChanges.find((t) => t.startMs === s.startMs);
    const slope = p.endMs ? (p.endBpm - p.bpm) / (p.endMs - p.startMs) : 0;
    const integral = (dt) => (p.bpm * dt + slope * dt * dt / 2) / 60000;
    const beats = map.bars.flatMap((b) => b.beatTimesMs).filter((t) => t >= s.startMs && t < s.runtimeEndMs);
    const endPhase = phase + integral(s.runtimeEndMs - s.startMs);
    assert.equal(beats.length, Math.ceil(endPhase - 1e-9) - Math.ceil(phase - 1e-9));
    for (const t of beats) {
      const at = phase + integral(t - s.startMs);
      assert.ok(Math.abs(at - Math.round(at)) < 1e-8);
    }
    phase = endPhase;
    priorMeter = s.meter;
  }
});

test('byte-identical rebuild; malformed synthetic CSV never overwrites a valid target', async () => {
  const dir = await mkdtemp(`${process.env.TMPDIR || '/root/.hermes/cache/scratch'}/odd-dice-test-`);
  try {
    const input = `${dir}/input.csv`, output = `${dir}/map.json`;
    await writeFile(input, raw);
    await writeMap(input, output);
    assert.equal(await readFile(output, 'utf8'), stored);
    await writeMap(input, output);
    assert.equal(await readFile(output, 'utf8'), stored);
    const invalid = [raw.replace('bpmFrom,', ''), mutate(1, 6, 'NaN'), mutate(1, 6, '-1'),
      mutate(1, 6, '0'), mutate(2, 0, '1'), mutate(2, 1, '0.00'), mutate(2, 3, '1.00'),
      mutate(1, 5, '7/8'), mutate(32, 3, '254.00'), mutate(1, 6, ''),
      mutate(18, 6, '227'), mutate(1, 2, '0:00.000'), raw + rows[32].join(',') + '\n'];
    for (const csv of invalid) {
      await writeFile(input, csv);
      await assert.rejects(writeMap(input, output));
      assert.equal(await readFile(output, 'utf8'), stored);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
