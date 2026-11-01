import { readFile, writeFile, rename } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const root = new URL('../src/lib/meter-maps/', import.meta.url);
const defaults = ['odd-dice.observed-source.json', 'odd-dice.tempo-readouts.json',
  'odd-dice.alignment-summary.json', 'odd-dice.full.sections.csv', 'odd-dice.full.json'].map(n => new URL(n, root));
const hash = raw => createHash('sha256').update(raw).digest('hex');
const finite = n => assert.ok(typeof n === 'number' && Number.isFinite(n), 'Finite numeric value required');
const observedHash = 'ca653cb011ee49778cff02b5dc92e10a52ab3aa2efa75f6c1afad2e8828d4ae8';
const tempoHash = '4c0bb0dfbe03f2441ed562e523463fa8152c2b7773625aaf567965c9bcaec0a9';

export function generateMap(observedRaw, tempoRaw, alignmentRaw, csvRaw) {
  const observed = JSON.parse(observedRaw), tempo = JSON.parse(tempoRaw), alignment = JSON.parse(alignmentRaw);
  assert.equal(observed.barCount, 138);
  assert.equal(observed.bars.length, 138);
  let end = 0, count = 0;
  const bars = observed.bars.map((b, i) => {
    assert.equal(b.bar, i + 1);
    finite(b.startMs); finite(b.endMs);
    assert.ok(b.startMs >= end && b.endMs > b.startMs && b.endMs <= 248800);
    assert.ok(Number.isSafeInteger(b.numerator) && b.numerator > 0);
    assert.equal(b.denominator, 4);
    assert.equal(b.beatTimesMs.length, b.numerator);
    assert.deepEqual(b.inferredBeatTimesMs, [], 'Inferred beats are not accepted');
    assert.equal(b.beatTimesMs[0], b.startMs);
    let previous = -Infinity;
    for (const beat of b.beatTimesMs) {
      finite(beat); assert.ok(beat > previous && beat >= b.startMs && beat < b.endMs);
      previous = beat; count++;
    }
    end = b.endMs;
    return { startMs: b.startMs, endMs: b.endMs, numerator: b.numerator, denominator: b.denominator, beatTimesMs: b.beatTimesMs };
  });
  assert.equal(count, 733);
  assert.equal(end, 248800);
  assert.equal(tempo.changes.length, 63);
  let previous = -Infinity;
  for (const t of tempo.changes) {
    finite(t.startMs); finite(t.bpm);
    assert.ok(t.startMs > previous && t.startMs >= 0 && t.startMs < end && t.bpm > 0);
    assert.deepEqual(Object.keys(t).sort(), ['bpm', 'startMs']);
    previous = t.startMs;
  }
  // Pinned evidence prevents silently changing the verified transcription or calibration.
  assert.equal(hash(observedRaw), observedHash, 'Unreviewed observed snapshot');
  assert.equal(hash(tempoRaw), tempoHash, 'Unreviewed tempo snapshot');
  assert.equal(alignment.kind, 'waveform-multi-anchor');
  assert.equal(alignment.signConvention, 'sourceVideoMs = uploadedAudioMs + offsetMs');
  assert.equal(alignment.sourceHash, 'c5821ed7f1e10e318911d7469c7d9650e7c7ae226603ca156ec2d07d8813e31d');
  assert.equal(alignment.targetHash, '113cce1a5599ad4a48d31eb98c8ff684683ea5aed60fa8f50b68674a8c303dad');
  assert.equal(alignment.offsetSamples, 32702); assert.equal(alignment.sampleRate, 16000);
  assert.equal(alignment.offsetMs, alignment.offsetSamples * 1000 / alignment.sampleRate);
  assert.equal(alignment.scale, 1);
  assert.equal(alignment.verification.status, 'PASS');
  assert.equal(alignment.verification.inputHashesVerified, true);
  assert.equal(alignment.verification.offsetMs, alignment.offsetMs);
  assert.equal(alignment.anchors.length, 9); assert.equal(alignment.denseAnchors.length, 50);
  const accepted = alignment.denseAnchors.filter(a => a.acceptedForFit === true);
  assert.equal(accepted.length, 49);
  for (const a of [...alignment.anchors, ...accepted]) {
    finite(a.uploadedAudioMs); finite(a.sourceVideoMs); finite(a.correlation);
    finite(a.offsetMs); assert.ok(Math.abs(a.offsetMs - alignment.offsetMs) < 1e-7);
    assert.ok(Math.abs(a.sourceVideoMs - a.uploadedAudioMs - alignment.offsetMs) < 1e-7);
  }
  assert.equal(alignment.opticalBeatCrossCheck.sha256, observedHash);
  assert.equal(alignment.opticalBeatCrossCheck.observedBeatCount, count);
  assert.equal(csvRaw.trimEnd().split(/\r?\n/u).length, 33);
  assert.equal(hash(csvRaw), '6c61f6f4b9543d55a4f43e9569b105489352bb882f655ede483a69afa837ea23', 'Unreviewed coarse snapshot');
  assert.equal(hash(alignmentRaw), '083e7c5d67c2cd97071f1aaa0c8b2babec0149af57c5307436f493608bb881a2', 'Unreviewed alignment evidence');
  return {
    id: 'odd-dice-audio-aligned-v3', durationMs: 248828, playbackToSourceOffsetMs: alignment.offsetMs,
    source: 'https://www.bilibili.com/video/BV1YhJq6LE4Q/', sourceKind: 'video-frame-observed+waveform-aligned',
    sourceSha256: observedHash, tempoSourceSha256: tempoHash, sourceFrameRate: 30,
    sourceResolutionMs: 1000 / 30, inferredBeatCount: 0,
    method: 'Unmodified observed source bars/beats and displayed BPM events; no integration, interpolation or boundary snapping.',
    coverage: { coordinates: 'source-video', startMs: bars[0].startMs, endMs: end,
      endMeaning: 'Transcription observation boundary, not audio end or official bar endpoint',
      gaps: observed.unmetered, outsideCoverage: 'unknown; no beats' },
    calibration: { kind: alignment.kind, mapping: alignment.signConvention, sourceHash: alignment.sourceHash,
      targetHash: alignment.targetHash, offsetSamples: alignment.offsetSamples, sampleRate: alignment.sampleRate,
      scale: alignment.scale, summarySha256: hash(alignmentRaw), highEnergyWindows: 9, acceptedDenseWindows: 49,
      totalDenseWindows: 50, denseLinearFit: alignment.denseLinearFit,
      opticalBeatCrossCheck: alignment.opticalBeatCrossCheck,
      caveat: 'Decoded waveform alignment; 240s ambiguous tail excluded. Not official score, per-beat audio verification or Spotify device validation.' },
    coarseAudit: { file: 'odd-dice.full.sections.csv', sha256: hash(csvRaw), sections: 32,
      role: 'Coarse source comparison only; not runtime beat or tempo anchors' },
    tempoChanges: tempo.changes, bars,
  };
}

export async function writeMap(observed = defaults[0], tempo = defaults[1], alignment = defaults[2], csv = defaults[3], output = defaults[4]) {
  const raws = await Promise.all([observed, tempo, alignment, csv].map(p => readFile(p, 'utf8')));
  const payload = generateMap(...raws);
  const destination = output instanceof URL ? fileURLToPath(output) : output;
  const temporary = `${destination}.pending`;
  await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`);
  await rename(temporary, destination);
  return payload;
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  assert.ok(process.argv.length === 2 || process.argv.length === 7,
    'Usage: node scripts/import-odd-dice-map.mjs [observed.json tempo.json alignment.json sections.csv output.json]');
  const map = await writeMap(...process.argv.slice(2));
  console.log(JSON.stringify({ bars: map.bars.length, beats: map.bars.reduce((n, b) => n + b.beatTimesMs.length, 0), tempo: map.tempoChanges.length }));
}
