import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { generateMap, writeMap } from './import-odd-dice-map.mjs';

const root = new URL('../src/lib/meter-maps/', import.meta.url);
const names = ['odd-dice.observed-source.json', 'odd-dice.tempo-readouts.json', 'odd-dice.alignment-summary.json', 'odd-dice.full.sections.csv'];
const raws = await Promise.all(names.map(n => readFile(new URL(n, root), 'utf8')));
const stored = await readFile(new URL('odd-dice.full.json', root), 'utf8');
const hash = raw => createHash('sha256').update(raw).digest('hex');

test('verified inputs rebuild byte-identical output and preserve evidence', () => {
  const map = generateMap(...raws), summary = JSON.parse(raws[2]);
  assert.equal(`${JSON.stringify(map, null, 2)}\n`, stored);
  assert.equal(map.sourceSha256, hash(raws[0]));
  assert.equal(map.tempoSourceSha256, hash(raws[1]));
  assert.equal(map.coarseAudit.sha256, hash(raws[3]));
  assert.equal(map.calibration.sourceHash, 'c5821ed7f1e10e318911d7469c7d9650e7c7ae226603ca156ec2d07d8813e31d');
  assert.equal(map.calibration.targetHash, '113cce1a5599ad4a48d31eb98c8ff684683ea5aed60fa8f50b68674a8c303dad');
  assert.equal(map.playbackToSourceOffsetMs, 2043.875);
  assert.equal(summary.offsetSamples, 32702);
  assert.equal(summary.scale, 1);
  assert.equal(summary.denseAnchors.filter(a => !a.acceptedForFit).length, 1);
  assert.equal(summary.ambiguousWindowChecks[0].uploadedAudioMs, 240000);
  assert.equal(summary.opticalBeatCrossCheck.fractionWithResidualPeakWithin60ms, 1);
  assert.ok(Buffer.byteLength(raws[2]) < 15000);
  assert.doesNotMatch(raws[2] + stored, /\/root\/|\/tmp\//u);
});

test('independent paths repeat deterministically; invalid inputs never overwrite output', async () => {
  const dir = await mkdtemp(join(process.env.TMPDIR || '/root/.hermes/cache/scratch', 'odd-dice-import-'));
  try {
    const paths = names.map(n => join(dir, n)), output = join(dir, 'runtime.json');
    for (const [i, p] of paths.entries()) await writeFile(p, raws[i]);
    await writeMap(...paths, output);
    assert.equal(await readFile(output, 'utf8'), stored);
    await writeMap(...paths, output);
    assert.equal(await readFile(output, 'utf8'), stored);
    const cases = [
      [0, () => '{'],
      [0, d => { d.bars.pop(); }],
      [0, d => { d.bars[0].startMs = null; }],
      [0, d => { d.bars[1].startMs = 0; }],
      [0, d => { d.bars[0].beatTimesMs[1] = d.bars[0].beatTimesMs[0]; }],
      [0, d => { d.bars[0].beatTimesMs.pop(); }],
      [0, d => { d.bars[0].inferredBeatTimesMs = [3300]; }],
      [1, d => { d.changes.pop(); }],
      [1, d => { d.changes[1].startMs = 0; }],
      [1, d => { d.changes[0].bpm = 'NaN'; }],
      [2, d => { d.offsetMs *= -1; }],
      [2, d => { d.sourceHash = d.targetHash; }],
      [2, d => { d.scale = 1.001; }],
      [2, d => { d.verification.status = 'FAIL'; }],
    ];
    for (const [i, mutate] of cases) {
      const data = JSON.parse(raws[i]);
      const replacement = mutate(data) ?? JSON.stringify(data);
      await writeFile(paths[i], replacement);
      await assert.rejects(writeMap(...paths, output));
      assert.equal(await readFile(output, 'utf8'), stored);
      await writeFile(paths[i], raws[i]);
    }
    await writeFile(paths[0], raws[0].replace('2933.333', 'NaN'));
    await assert.rejects(writeMap(...paths, output));
    assert.equal(await readFile(output, 'utf8'), stored);
    await rm(paths[0]);
    await assert.rejects(writeMap(...paths, output));
    assert.equal(await readFile(output, 'utf8'), stored);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
