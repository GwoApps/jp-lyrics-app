import { readFile, writeFile, rename } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const snapshot = new URL('../src/lib/meter-maps/odd-dice.full.sections.csv', import.meta.url);
const target = new URL('../src/lib/meter-maps/odd-dice.full.json', import.meta.url);
const header = '段,start_s,start,end_s,end,拍子,bpmFrom,bpmTo,推算小节数';
const durationMs = 248828;
const round = (n) => Math.round(n * 1e6) / 1e6;

// Strict source-specific CSV dialect: no quoted fields, missing cells or extra columns.
export function parseSections(raw) {
  const lines = raw.replace(/^\uFEFF/u, '').trimEnd().split(/\r?\n/u);
  assert.equal(lines.shift(), header, 'CSV columns');
  assert.equal(lines.length, 32, 'Expected all 32 source sections');
  let previousEnd = 500;
  const number = (s) => {
    assert.match(s, /^\d+(?:\.\d+)?$/u, 'Invalid numeric cell');
    const n = Number(s);
    assert.ok(Number.isFinite(n));
    return n;
  };
  const clock = (s) => {
    assert.match(s, /^\d+:[0-5]\d\.\d{3}$/u);
    const [m, sec] = s.split(':').map(Number);
    return (m * 60 + sec) * 1000;
  };
  const sections = lines.map((line, i) => {
    const cells = line.split(',');
    assert.equal(cells.length, 9, `Row ${i + 1}`);
    const [id, start, startLabel, end, endLabel, meter, from, to, count] = cells;
    assert.equal(number(id), i + 1);
    const startMs = number(start) * 1000, endMs = number(end) * 1000;
    assert.equal(startMs, previousEnd, 'Ordered contiguous source sections');
    assert.ok(endMs > startMs && endMs <= 253000);
    assert.equal(startMs, clock(startLabel));
    assert.equal(endMs, clock(endLabel));
    assert.ok(['3/4', '4/4', '5/4', '6/4', 'senza tempo'].includes(meter));
    const bpmMin = number(from), bpmMax = number(to), estimatedBars = number(count);
    assert.ok(bpmMin > 0 && bpmMin <= bpmMax && bpmMax <= 300);
    if (meter === 'senza tempo') assert.equal(estimatedBars, 0);
    else assert.ok(estimatedBars > 0);
    let strategy = 'constant';
    if (bpmMin !== bpmMax) {
      if ([18, 28].includes(i + 1) && bpmMin === 228 && bpmMax === 230) strategy = '230-platform';
      else if (i === 30 && bpmMin === 124 && bpmMax === 139 && startMs === 232000 && endMs === 249500) strategy = 'linear-ritardando';
      else assert.fail('Unsupported BPM range');
    }
    if (meter === 'senza tempo') strategy = 'unmetered';
    previousEnd = endMs;
    return { section: i + 1, startMs, endMs, meter, bpmMin, bpmMax, estimatedBars, strategy,
      runtimeStartMs: startMs < durationMs ? startMs : null,
      runtimeEndMs: startMs < durationMs ? Math.min(endMs, durationMs) : null };
  });
  assert.equal(previousEnd, 253000);
  return sections;
}

export function generateMap(raw) {
  const sourceSections = parseSections(raw);
  const bars = [], tempoChanges = [];
  let group = null;
  const finish = () => {
    if (!group) return;
    for (let i = 0; i < group.beats.length; i += group.numerator) {
      const beatTimesMs = group.beats.slice(i, i + group.numerator);
      const endMs = group.beats[i + group.numerator] ?? group.endMs;
      // A truncated final beat also makes a full-count bar partial.
      const partial = i + group.numerator > group.phase + 1e-9;
      bars.push({ startMs: beatTimesMs[0], endMs, numerator: group.numerator, denominator: 4,
        beatTimesMs, ...(partial ? { estimated: true, partial: true } : {}) });
    }
    group = null;
  };
  for (const s of sourceSections) {
    if (s.runtimeStartMs === null) continue;
    if (s.strategy === 'unmetered') { finish(); continue; }
    const numerator = Number(s.meter[0]);
    if (group && group.numerator !== numerator) finish();
    if (!group) group = { numerator, beats: [], phase: 0, endMs: s.startMs };
    const bpm = s.strategy === 'linear-ritardando' ? 139 : s.bpmMax;
    const slope = s.strategy === 'linear-ritardando' ? (124 - 139) / (s.endMs - s.startMs) : 0;
    tempoChanges.push({ startMs: s.startMs, bpm,
      ...(slope ? { endMs: s.endMs, endBpm: 124 } : {}) });
    const dt = s.runtimeEndMs - s.startMs;
    const phaseEnd = group.phase + (bpm * dt + slope * dt * dt / 2) / 60000;
    for (let beat = Math.ceil(group.phase - 1e-9); beat < phaseEnd - 1e-9; beat++) {
      const area = Math.max(0, beat - group.phase) * 60000;
      // Rationalized quadratic root avoids cancellation for shallow ramps.
      const offset = slope ? 2 * area / (bpm + Math.sqrt(bpm * bpm + 2 * slope * area)) : area / bpm;
      group.beats.push(round(s.startMs + offset));
    }
    group.phase = phaseEnd;
    group.endMs = s.runtimeEndMs;
  }
  finish();
  return {
    id: 'odd-dice-full-sections-estimated-v1', durationMs, estimated: true,
    source: 'https://www.bilibili.com/video/BV1YhJq6LE4Q/', sourceKind: 'community-transcription-estimate',
    sourceSha256: createHash('sha256').update(raw).digest('hex'), sourceResolutionMs: 500,
    method: 'Piecewise tempo integral; integer phase beats; meter/free-time resets; timestamps rounded to 0.000001 ms for serialization only.',
    assumptions: ['BPM columns are min/max, not directed endpoints.', 'Equal BPM values use constant staircase tempo, including 170 and 188.',
      'Sections 18/28 approximate entry range 228–230 as a 230 platform.',
      'Section 31 is linear in time from 139 to 124 over 232000–249500 ms.',
      'Same-meter tempo boundaries retain beat/bar phase; source estimated bar counts are metadata only.',
      'Source boundaries ±500 ms; source integrated bar estimates ±10%; all runtime beats estimated.'],
    clipping: { startMs: 0, endMs: durationMs, sourceEndMs: 253000, offsetMs: 0, scale: 1 },
    sourceSections, tempoChanges, bars,
  };
}

export async function writeMap(input = snapshot, output = target) {
  const payload = generateMap(await readFile(input, 'utf8'));
  // Validate/generate completely before touching the destination; atomic replacement.
  const destination = output instanceof URL ? fileURLToPath(output) : output;
  const temporary = `${destination}.pending`;
  await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`);
  await rename(temporary, destination);
  return payload;
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const map = await writeMap(process.argv[2], process.argv[3]);
  console.log(JSON.stringify({ bars: map.bars.length, beats: map.bars.reduce((n, b) => n + b.beatTimesMs.length, 0),
    tempo: map.tempoChanges.length, partial: map.bars.filter((b) => b.partial).length }));
}
