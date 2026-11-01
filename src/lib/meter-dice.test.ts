import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import * as engine from './meter-dice.ts';
import {
  getDicePips, getMeterFrame, getMeterBpm, isValidMeterMap, meterPlaybackMs, shouldRotateMeterDice,
  type MeterBar, type MeterMap,
} from './meter-dice.ts';
import type { MeterDiceProps } from '../components/song/MeterDice.tsx';

// Synthetic fixtures exercise the generic engine; none purports to chart a song.
const map: MeterMap = {
  id: 'test-only', durationMs: 7000,
  tempoChanges: [{ startMs: 1000, bpm: 120 }, { startMs: 1750, bpm: 130 }, { startMs: 2500, bpm: 140 },
    { startMs: 4500, bpm: 240 }, { startMs: 6250, bpm: 200 }],
  bars: [
    { startMs: 1000, endMs: 2500, numerator: 3, denominator: 4, beatTimesMs: [1000, 1500, 2000] },
    { startMs: 2500, endMs: 4500, numerator: 4, denominator: 4, beatTimesMs: [2500, 3000, 3500, 4000] },
    { startMs: 4500, endMs: 6000, numerator: 6, denominator: 8, beatTimesMs: [4500, 4750, 5000, 5250, 5500, 5750] },
    { startMs: 6250, endMs: 7000, numerator: 3, denominator: 8, beatTimesMs: [6250, 6400, 6800] },
  ],
};

test('lookup uses half-open bars/beats and never lights missing, intro, gaps or ended progress', () => {
  for (const ms of [null, NaN, Infinity, -Infinity, -1, 0, 999.999, 6000, 6249.999, 7000, 9000]) {
    assert.equal(getMeterFrame(map, ms), null, `position ${ms}`);
  }
  assert.deepEqual(getMeterFrame(map, 1000), { barIndex: 0, beatIndex: 0, litCount: 1, numerator: 3, denominator: 4 });
  assert.equal(getMeterFrame(map, 1499.999)?.litCount, 1);
  assert.equal(getMeterFrame(map, 1500)?.litCount, 2);
  assert.equal(getMeterFrame(map, 2499.999)?.litCount, 3);
  assert.deepEqual(getMeterFrame(map, 2500), { barIndex: 1, beatIndex: 0, litCount: 1, numerator: 4, denominator: 4 });
  assert.equal(getMeterFrame({ ...map, bars: [] }, 1000), null);
});

test('6/8 counts all six eighth notes; nonuniform authored beats define tempo changes', () => {
  for (let beat = 0; beat < 6; beat++) {
    assert.equal(getMeterFrame(map, 4500 + beat * 250)?.beatIndex, beat);
  }
  for (const [ms, lit] of [[6250, 1], [6399.9, 1], [6400, 2], [6799.9, 2], [6800, 3]]) {
    assert.equal(getMeterFrame(map, ms)?.litCount, lit);
  }
});

test('lookups are stateless across forward seeks, backwards seeks and replay after end', () => {
  assert.deepEqual([5500, 1200, 6999, 7000, 2500, NaN, 1000].map((ms) => getMeterFrame(map, ms)?.litCount ?? null),
    [5, 1, 3, null, 1, null, 1]);
});

test('a real zero timestamp is not loading, and late first bars do not invent an intro beat', () => {
  const zero: MeterMap = {
    id: 'zero', durationMs: 500,
    bars: [{ startMs: 0, endMs: 500, numerator: 1, denominator: 4, beatTimesMs: [0] }],
  };
  assert.equal(isValidMeterMap(zero), true);
  assert.equal(getMeterFrame(zero, 0)?.litCount, 1);
  assert.equal(getMeterFrame(zero, null), null);
  assert.equal(getMeterFrame(map, 0), null);
});

test('BPM uses authored tempo changes, including within a beat, and never frame-gap estimates', () => {
  for (const ms of [null, NaN, 0, 999, 6000, 6249, 7000]) assert.equal(getMeterBpm(map, ms), null);
  assert.equal(getMeterBpm(map, 1000), 120);
  assert.equal(getMeterBpm(map, 1749.999), 120);
  assert.equal(getMeterBpm(map, 1750), 130);
  assert.equal(getMeterBpm(map, 2499), 130);
  assert.equal(getMeterBpm(map, 2500), 140);
  assert.equal(getMeterBpm(map, 4500), 240);
  assert.equal(getMeterBpm(map, 6999), 200);
  assert.equal(getMeterBpm({ ...map, tempoChanges: undefined }, 1500), null);
  for (const tempoChanges of [[{ startMs: -1, bpm: 120 }], [{ startMs: 0, bpm: 0 }],
    [{ startMs: 7000, bpm: 120 }], [{ startMs: NaN, bpm: 120 }], [{ startMs: 0, bpm: Infinity }],
    [{ startMs: 1000, bpm: 120 }, { startMs: 1000, bpm: 140 }],
    [{ startMs: 2000, bpm: 120 }, { startMs: 1000, bpm: 140 }]]) {
    assert.equal(isValidMeterMap({ ...map, tempoChanges }), false);
  }
});

test('all 1–6 faces are standard, distinct pips; larger meters have centered extensible grids', () => {
  const expected = [
    [[50, 50]], [[25, 25], [75, 75]], [[25, 25], [50, 50], [75, 75]],
    [[25, 25], [75, 25], [25, 75], [75, 75]],
    [[25, 25], [75, 25], [50, 50], [25, 75], [75, 75]],
    [[25, 25], [75, 25], [25, 50], [75, 50], [25, 75], [75, 75]],
  ];
  for (let numerator = 1; numerator <= 6; numerator++) {
    assert.deepEqual(getDicePips(numerator).map(({ x, y }) => [x, y]), expected[numerator - 1]);
    const fixture: MeterMap = {
      id: `face-${numerator}`, durationMs: numerator * 100,
      bars: [{ startMs: 0, endMs: numerator * 100, numerator, denominator: 4,
        beatTimesMs: Array.from({ length: numerator }, (_, i) => i * 100) }],
    };
    for (let beat = 0; beat < numerator; beat++) assert.equal(getMeterFrame(fixture, beat * 100)?.litCount, beat + 1);
  }
  for (const count of [7, 8, 9, 12, 17]) {
    const pips = getDicePips(count);
    assert.equal(pips.length, count);
    assert.equal(new Set(pips.map(({ x, y }) => `${x},${y}`)).size, count);
    assert.ok(pips.every(({ x, y }) => x > 0 && x < 100 && y > 0 && y < 100));
  }
  for (const invalid of [0, -1, 2.5, NaN, Infinity]) assert.deepEqual(getDicePips(invalid), []);
});

test('chart validation rejects unordered, overlapping, missing and nonfinite authored beats', () => {
  assert.equal(isValidMeterMap(map), true);
  const change = (bar: Partial<MeterBar>) => ({ ...map, bars: [{ ...map.bars[0], ...bar }] });
  for (const invalid of [
    { ...map, id: '' }, { ...map, durationMs: NaN }, { ...map, durationMs: 0 }, { ...map, bars: [] },
    { ...map, bars: [...map.bars].reverse() }, { ...map, bars: [map.bars[0], map.bars[0]] },
    change({ startMs: -1 }), change({ endMs: 1000 }), change({ endMs: 7001 }),
    change({ numerator: 0 }), change({ numerator: 1.5 }), change({ denominator: 0 }),
    change({ denominator: NaN }), change({ beatTimesMs: [1000, 1500] }),
    change({ beatTimesMs: [1100, 1500, 2000] }), change({ beatTimesMs: [1000, 1000, 2000] }),
    change({ beatTimesMs: [1000, 2000, 1500] }), change({ beatTimesMs: [1000, NaN, 2000] }),
    change({ beatTimesMs: [1000, 1500, 2500] }),
  ]) assert.equal(isValidMeterMap(invalid), false);
});

test('clock selection respects null/loading, real 0, matching, playing ref and paused seek contract', () => {
  const playing = { progress_ms: 1500, is_playing: true };
  const paused = { ...playing, is_playing: false };
  assert.equal(meterPlaybackMs(true, playing, 1600), 1600);
  assert.equal(meterPlaybackMs(true, playing, null), null, 'never extrapolate the poll');
  assert.equal(meterPlaybackMs(true, paused, null), 1500);
  assert.equal(meterPlaybackMs(true, paused, 4000), 4000, 'confirmed paused seek ref wins');
  assert.equal(meterPlaybackMs(true, { progress_ms: 0, is_playing: false }, null), 0);
  assert.equal(meterPlaybackMs(true, playing, 0), 0);
  assert.equal(meterPlaybackMs(false, playing, 1600), null);
  assert.equal(meterPlaybackMs(false, paused, 1600), null);
  assert.equal(meterPlaybackMs(true, null, 0), null);
  for (const invalid of [NaN, Infinity, -1]) {
    assert.equal(meterPlaybackMs(true, playing, invalid), null);
    assert.equal(meterPlaybackMs(true, { ...paused, progress_ms: invalid }, null), null);
  }
});

test('only continuous adjacent signature changes rotate, including denominator-only changes', () => {
  const before = getMeterFrame(map, 2490);
  const after = getMeterFrame(map, 2506);
  assert.equal(shouldRotateMeterDice(before, after, 2490, 2506, 16), true);
  assert.equal(shouldRotateMeterDice(before, after, 2490, 2506, 500), false);
  assert.equal(shouldRotateMeterDice(before, after, 2490, 2506, NaN), false);
  assert.equal(shouldRotateMeterDice(before, after, 2490, 2506, -1), false);
  assert.equal(shouldRotateMeterDice(after, before, 2506, 2490, 16), false);
  assert.equal(shouldRotateMeterDice(null, after, null, 2506, 16), false);
  assert.equal(shouldRotateMeterDice(before, null, 2490, 7000, 16), false);
  assert.equal(shouldRotateMeterDice(before, after, 1000, 2506, 16), false);
  assert.equal(shouldRotateMeterDice(before, getMeterFrame(map, 5000), 2490, 5000, 16), false);
  assert.equal(shouldRotateMeterDice(before, after, NaN, 2506, 16), false);
  assert.ok(before && after);
  assert.equal(shouldRotateMeterDice(before, { ...after, numerator: 3 }, 2490, 2506, 16), false);
  assert.equal(shouldRotateMeterDice(before, { ...after, numerator: 3, denominator: 8 }, 2490, 2506, 16), true);
});

const require = createRequire(import.meta.url);
const componentSource = readFileSync(new URL('../components/song/MeterDice.tsx', import.meta.url), 'utf8');
const componentJS = ts.transpileModule(componentSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
}).outputText;

// Test-only transpilation avoids adding a TSX/CSS loader or a DOM dependency.
function loadDice(react: object = React): React.ComponentType<MeterDiceProps> {
  const loaded = { exports: {} as { default: React.ComponentType<MeterDiceProps> } };
  const localRequire = (id: string) => {
    if (id === 'react') return react;
    if (id === '@/lib/meter-dice') return engine;
    if (id.endsWith('.module.css')) return { default: { dice: 'dice', face: 'face', pip: 'pip', outline: 'outline', meter: 'meter', socket: 'socket', haloOuter: 'haloOuter', haloInner: 'haloInner', filament: 'filament', core: 'core' } };
    return require(id);
  };
  new Function('require', 'module', 'exports', componentJS)(localRequire, loaded, loaded.exports);
  return loaded.exports.default;
}

test('real React SSR is hydration-safe, localized and silent with no fabricated active face', () => {
  const Dice = loadDice();
  for (const playback of [null, { progress_ms: 2500, is_playing: true }, { progress_ms: 0, is_playing: false }]) {
    const html = renderToStaticMarkup(React.createElement(Dice, {
      map, playback, matching: true, playbackMsRef: { current: null }, label: 'Localized dice label',
    }));
    assert.match(html, /role="img" aria-label="Localized dice label"/);
    assert.match(html, /viewBox="0 0 100 100" aria-hidden="true" focusable="false"/);
    assert.doesNotMatch(html, /aria-live|<circle|3\/4|4\/4/);
    assert.match(html, playback ? /data-state="unavailable"/ : /data-state="loading"/);
  }
});

class FakeElement {
  readonly dataWrites: [string, string][] = [];
  dataset: Record<string, string> = new Proxy({}, {
    set: (target: Record<string, string>, key: string, value: string) => {
      this.dataWrites.push([key, value]);
      target[key] = value;
      return true;
    },
  });
  readonly tagName: string;
  constructor(tagName = '') { this.tagName = tagName; }
  get lastElementChild(): FakeElement | null { return this.children.at(-1) ?? null; }
  attributes: Record<string, string> = {};
  children: FakeElement[] = [];
  textContent = '';
  writes = 0;
  animations: { playState: string; cancelled: boolean; pause: () => void; play: () => void; cancel: () => void }[] = [];
  setAttribute(name: string, value: string) { this.attributes[name] = value; this.writes++; }
  replaceChildren(...children: FakeElement[]) { this.children = children; this.writes++; }
  animate() {
    const animation = {
      playState: 'running', cancelled: false,
      pause() { this.playState = 'paused'; },
      play() { this.playState = 'running'; },
      cancel() { this.cancelled = true; this.playState = 'idle'; },
    };
    this.animations.push(animation);
    return animation;
  }
}

type Effect = () => void | (() => void);

/** Deterministic hook/DOM adapter exercises the actual component effect body. */
function diceHarness(initial: MeterDiceProps) {
  let now = 0;
  let hidden = false;
  let reduced = false;
  let nextRaf = 1;
  const styleReads: FakeElement[] = [];
  const styleSnapshots: { node: FakeElement; motion: string; lit: string[] }[] = [];
  const frames = new Map<number, FrameRequestCallback>();
  const visibility = new Set<() => void>();
  const preference = new Set<() => void>();
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const install = (key: string, value: unknown) => {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  };
  install('document', {
    get hidden() { return hidden; },
    createElementNS: (_: string, tag: string) => new FakeElement(tag),
    addEventListener: (_: string, fn: () => void) => visibility.add(fn),
    removeEventListener: (_: string, fn: () => void) => visibility.delete(fn),
  });
  install('window', { getComputedStyle: (node: FakeElement) => {
    styleReads.push(node);
    styleSnapshots.push({ node, motion: nodes.get('div')!.dataset.motion,
      lit: nodes.get('g')!.children.map((pip) => pip.dataset.lit) });
    return { opacity: '0' }; // Style flush observation only; this adapter does not run CSS.
  }, matchMedia: () => ({
    get matches() { return reduced; },
    addEventListener: (_: string, fn: () => void) => preference.add(fn),
    removeEventListener: (_: string, fn: () => void) => preference.delete(fn),
  }) });
  install('performance', { now: () => now });
  install('requestAnimationFrame', (fn: FrameRequestCallback) => { const id = nextRaf++; frames.set(id, fn); return id; });
  install('cancelAnimationFrame', (id: number) => frames.delete(id));

  const refs: { current: unknown }[] = [];
  const effects: { deps: readonly unknown[]; cleanup?: () => void }[] = [];
  const pending: (() => void)[] = [];
  let refIndex = 0;
  let effectIndex = 0;
  const hooks = {
    ...React,
    memo: (component: unknown) => component,
    useRef: (value: unknown) => refs[refIndex++] ?? (refs[refIndex - 1] = { current: value }),
    useEffect: (effect: Effect, deps: readonly unknown[]) => {
      const index = effectIndex++;
      const old = effects[index];
      if (!old || deps.some((dep, i) => dep !== old.deps[i])) pending.push(() => {
        old?.cleanup?.();
        effects[index] = { deps, cleanup: effect() || undefined };
      });
    },
  };
  const Dice = loadDice(hooks) as (props: MeterDiceProps) => React.ReactNode;
  const nodes = new Map<string, FakeElement>();
  const attach = (node: React.ReactNode) => {
    if (!React.isValidElement<{ ref?: { current: unknown }; children?: React.ReactNode }>(node)) return;
    if (node.props.ref && typeof node.type === 'string') {
      const element = nodes.get(node.type) ?? new FakeElement();
      nodes.set(node.type, element);
      node.props.ref.current = element;
    }
    React.Children.forEach(node.props.children, attach);
  };
  const render = (props: MeterDiceProps) => {
    refIndex = 0;
    effectIndex = 0;
    attach(Dice(props));
    pending.splice(0).forEach((effect) => effect());
  };
  render(initial);
  return {
    nodes, frames, visibility, preference, styleReads, styleSnapshots, render,
    step(ms: number, elapsed = 16) {
      initial.playbackMsRef.current = ms;
      now += elapsed;
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((callback) => callback(now));
    },
    hide(value: boolean) { hidden = value; visibility.forEach((fn) => fn()); },
    reduce(value: boolean) { reduced = value; preference.forEach((fn) => fn()); },
    close() {
      effects.forEach((effect) => effect.cleanup?.());
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    },
  };
}

test('component accumulates beats locally, changes signature once, freezes pause and snaps seeks', () => {
  const props: MeterDiceProps = {
    map, playbackMsRef: { current: 2480 }, playback: { progress_ms: 2480, is_playing: true }, matching: true, label: 'Localized',
  };
  const h = diceHarness(props);
  try {
    const root = h.nodes.get('div')!;
    const face = h.nodes.get('svg')!;
    const group = h.nodes.get('g')!;
    const meter = h.nodes.get('span')!;
    assert.equal(group.children.length, 3);
    assert.equal(group.children.filter((pip) => pip.dataset.lit === 'true').length, 3);
    const writes = group.writes;
    h.step(2496);
    assert.equal(group.writes, writes, 'unchanged face is not rebuilt each frame');
    h.step(2512);
    assert.equal(meter.textContent, '140 BPM');
    assert.equal(group.children.length, 4);
    assert.equal(group.children.filter((pip) => pip.dataset.lit === 'true').length, 1);
    assert.equal(face.animations.length, 1);
    assert.equal(root.dataset.motion, 'continuous', 'new signature also warms from dark');
    assert.ok(group.children.every((pip) => h.styleReads.includes(pip.lastElementChild!)));
    const animation = face.animations[0];
    const paused = { ...props, playback: { progress_ms: 2512, is_playing: false } };
    h.render(paused);
    assert.equal(h.frames.size, 0);
    assert.equal(animation.playState, 'paused');
    assert.equal(animation.cancelled, false);
    h.render(props);
    assert.equal(animation.playState, 'running');
    h.step(5500);
    assert.equal(root.dataset.beat, '4');
    assert.equal(group.children.length, 6);
    assert.equal(face.animations.length, 1, 'forward seek does not roll intermediate meters');
    assert.equal(animation.cancelled, true);
    h.step(1200);
    assert.equal(meter.textContent, '120 BPM');
    assert.equal(root.dataset.beat, '0');
    assert.equal(face.animations.length, 1, 'backwards seek does not animate');
    h.step(7000);
    assert.equal(group.children.length, 0);
    assert.equal(meter.textContent, '');
    assert.equal(root.dataset.state, 'outside');
  } finally { h.close(); }
  assert.equal(h.frames.size, 0);
  assert.equal(h.visibility.size, 0);
  assert.equal(h.preference.size, 0);
});

test('BPM caption updates mid-beat without rebuilding or rotating the dice, and clears on mismatch', () => {
  const props: MeterDiceProps = {
    map, playbackMsRef: { current: 1700 }, playback: { progress_ms: 1700, is_playing: true }, matching: true, label: 'Localized',
  };
  const h = diceHarness(props);
  try {
    const caption = h.nodes.get('span')!;
    const group = h.nodes.get('g')!;
    const face = h.nodes.get('svg')!;
    assert.equal(caption.textContent, '120 BPM');
    const writes = group.writes;
    h.step(1760, 60);
    assert.equal(caption.textContent, '130 BPM');
    assert.equal(group.writes, writes);
    assert.equal(face.animations.length, 0);
    h.step(1200);
    assert.equal(caption.textContent, '120 BPM');
    h.render({ ...props, matching: false });
    assert.equal(caption.textContent, '');
  } finally { h.close(); }
});

test('component stops hidden loops, resyncs on restore, honors reduced motion and clears mismatches', () => {
  const props: MeterDiceProps = {
    map, playbackMsRef: { current: 2480 }, playback: { progress_ms: 2480, is_playing: true }, matching: true, label: 'Localized',
  };
  const h = diceHarness(props);
  try {
    const root = h.nodes.get('div')!;
    const group = h.nodes.get('g')!;
    const face = h.nodes.get('svg')!;
    h.hide(true);
    assert.equal(h.frames.size, 0);
    props.playbackMsRef.current = 5000;
    h.hide(false);
    assert.equal(root.dataset.beat, '2');
    assert.equal(face.animations.length, 0, 'restore never replays skipped meters');
    assert.equal(h.frames.size, 1);
    h.step(2480);
    h.reduce(true);
    h.step(2496);
    h.step(2512);
    assert.equal(face.animations.length, 0);
    assert.equal(group.children.length, 4);
    h.render({ ...props, matching: false });
    assert.equal(group.children.length, 0);
    assert.equal(root.dataset.state, 'inactive');
    assert.equal(h.frames.size, 0);
    h.render({ ...props, playback: null });
    assert.equal(root.dataset.state, 'loading');
    h.render({ ...props, map: { ...map, bars: [] } });
    assert.equal(root.dataset.state, 'invalid');
    assert.equal(h.frames.size, 0);
  } finally { h.close(); }
});

test('component handles paused null-ref snapshots, confirmed seeks, zero and no playing ref without a clock', () => {
  const props: MeterDiceProps = {
    map, playbackMsRef: { current: null }, playback: { progress_ms: 1500, is_playing: false }, matching: true, label: 'Localized',
  };
  const h = diceHarness(props);
  try {
    const root = h.nodes.get('div')!;
    const group = h.nodes.get('g')!;
    assert.equal(root.dataset.beat, '1');
    assert.equal(h.frames.size, 0);
    props.playbackMsRef.current = 5000;
    h.render({ ...props, playback: { progress_ms: 5000, is_playing: false } });
    assert.equal(root.dataset.beat, '2');
    props.playbackMsRef.current = null;
    h.render({ ...props, playback: { progress_ms: 0, is_playing: false } });
    assert.equal(root.dataset.state, 'outside');
    assert.equal(group.children.length, 0);
    h.render({ ...props, playback: { progress_ms: 2500, is_playing: true } });
    assert.equal(root.dataset.state, 'unavailable');
    assert.equal(group.children.length, 0);
    h.step(2500);
    assert.equal(root.dataset.beat, '0');
  } finally { h.close(); }
});


test('lamp layers warm only newly lit pips, retain steady lights and reset the next same-meter bar', () => {
  const repeated: MeterMap = { id: 'lamps', durationMs: 1398, bars: [0, 699].map((startMs) => ({
    startMs, endMs: startMs + 699, numerator: 3, denominator: 4,
    beatTimesMs: [startMs, startMs + 233, startMs + 466],
  })) };
  const props: MeterDiceProps = { map: repeated, playbackMsRef: { current: 0 },
    playback: { progress_ms: 0, is_playing: true }, matching: true, label: 'Localized' };
  const h = diceHarness(props);
  try {
    const root = h.nodes.get('div')!;
    const group = h.nodes.get('g')!;
    const pips = [...group.children];
    assert.equal(root.dataset.motion, 'snap');
    assert.deepEqual(pips.map((p) => p.dataset.lit), ['true', 'false', 'false']);
    for (const pip of pips) {
      assert.equal(pip.tagName, 'g');
      assert.deepEqual(pip.children.map((c) => c.attributes.class),
        ['socket', 'haloOuter', 'haloInner', 'filament', 'core']);
      assert.ok(pip.children.every((c) => c.tagName === 'circle' && Number(c.attributes.r) > 0));
      assert.equal(pip.children[4].attributes.cx, pip.children[0].attributes.cx);
    }
    const reads = h.styleReads.length;
    const firstWrites = pips[0].dataWrites.length;
    h.step(233, 233);
    assert.equal(root.dataset.motion, 'continuous');
    assert.deepEqual(pips.map((p) => p.dataset.lit), ['true', 'true', 'false']);
    assert.equal(pips[0].dataWrites.length, firstWrites, 'already lit core/halo are untouched');
    assert.deepEqual(pips[1].dataWrites, [['lit', 'false'], ['lit', 'true']]);
    h.step(466, 233);
    assert.equal(h.styleReads.length, reads, 'ordinary beats do not read style');
    h.step(699, 233);
    assert.deepEqual(group.children, pips, 'same-meter reset preserves lamp nodes');
    assert.deepEqual(pips.map((p) => p.dataset.lit), ['true', 'false', 'false']);
    assert.deepEqual(pips[0].dataWrites.slice(firstWrites), [['lit', 'false'], ['lit', 'true']]);
    assert.deepEqual(h.styleSnapshots.slice(reads), [{ node: pips[0].lastElementChild,
      motion: 'snap', lit: ['false', 'true', 'true'] }], 'only the first pip commits dark; old lights remain lit');
    assert.equal(root.dataset.motion, 'continuous', 'first pip warms and other pips fade');
    const writes = pips.map((pip) => pip.dataWrites.length);
    h.step(715);
    h.step(731);
    assert.deepEqual(pips.map((pip) => pip.dataWrites.length), writes, 'same-bar rAF never replays');
    assert.equal(h.styleReads.length, reads + 1, 'only one boundary style read');
    assert.equal(h.nodes.get('svg')!.animations.length, 0);
  } finally { h.close(); }
});

test('lamp transitions snap on seeks, pause, visibility, map changes and live motion preference', () => {
  const props: MeterDiceProps = { map, playbackMsRef: { current: 1480 },
    playback: { progress_ms: 1480, is_playing: true }, matching: true, label: 'Localized' };
  const h = diceHarness(props);
  try {
    const root = h.nodes.get('div')!;
    const group = h.nodes.get('g')!;
    h.step(1500, 20);
    assert.equal(root.dataset.motion, 'continuous');
    h.render({ ...props, playback: { progress_ms: 1500, is_playing: false } });
    assert.equal(root.dataset.motion, 'snap');
    assert.equal(h.frames.size, 0);
    h.render(props);
    assert.equal(root.dataset.motion, 'snap');
    h.step(1516);
    assert.equal(root.dataset.motion, 'continuous');
    h.step(1520, 500);
    assert.equal(root.dataset.motion, 'snap', 'a stalled frame cannot replay a light');
    h.step(1536);
    assert.equal(root.dataset.motion, 'continuous');
    h.step(1550, 500);
    assert.equal(root.dataset.motion, 'snap', 'same-beat discontinuity also settles');
    h.step(5500);
    assert.equal(root.dataset.motion, 'snap');
    assert.equal(group.children.filter((p) => p.dataset.lit === 'true').length, 5);
    h.step(1480);
    assert.equal(root.dataset.motion, 'snap');
    h.step(1500, 20);
    h.reduce(true);
    assert.equal(root.dataset.motion, 'snap');
    h.step(1516);
    assert.equal(root.dataset.motion, 'snap');
    h.reduce(false);
    assert.equal(root.dataset.motion, 'snap');
    h.step(1532);
    assert.equal(root.dataset.motion, 'continuous');
    h.hide(true);
    assert.equal(root.dataset.motion, 'snap');
    assert.equal(h.frames.size, 0);
    props.playbackMsRef.current = 5000;
    h.hide(false);
    assert.equal(root.dataset.motion, 'snap');
    assert.equal(group.children.filter((p) => p.dataset.lit === 'true').length, 3);
    h.render({ ...props, map: { ...map, id: 'replacement' } });
    assert.equal(root.dataset.motion, 'snap');
    h.render({ ...props, matching: false });
    assert.equal(root.dataset.motion, 'snap');
    assert.equal(group.children.length, 0);
    assert.ok(h.styleReads.length > 0, 'snap commits existing lamp styles');
  } finally { h.close(); }
  assert.equal(h.nodes.get('div')!.dataset.motion, 'snap');
  assert.equal(h.frames.size, 0);
});


test('same-meter pause, seek and visibility restore snap without a dark first-pip replay', () => {
  const repeated: MeterMap = { id: 'same-meter-snap', durationMs: 1200, bars: [0, 600].map((startMs) => ({
    startMs, endMs: startMs + 600, numerator: 6, denominator: 4,
    beatTimesMs: Array.from({ length: 6 }, (_, i) => startMs + i * 100),
  })) };
  for (const action of ['pause', 'seek', 'visibility'] as const) {
    const props: MeterDiceProps = { map: repeated, playbackMsRef: { current: 580 },
      playback: { progress_ms: 580, is_playing: true }, matching: true, label: 'Localized' };
    const h = diceHarness(props);
    try {
      const root = h.nodes.get('div')!;
      const group = h.nodes.get('g')!;
      const pips = [...group.children];
      h.step(596);
      const firstWrites = pips[0].dataWrites.length;
      const reads = h.styleSnapshots.length;
      if (action === 'pause') {
        props.playbackMsRef.current = 612;
        h.render({ ...props, playback: { progress_ms: 612, is_playing: false } });
      } else if (action === 'seek') {
        h.step(800);
      } else {
        h.hide(true);
        props.playbackMsRef.current = 612;
        h.hide(false);
      }
      assert.equal(root.dataset.motion, 'snap', action);
      assert.deepEqual(group.children, pips);
      assert.equal(pips[0].dataWrites.length, firstWrites, 'no false/true first-pip replay');
      assert.ok(h.styleSnapshots.slice(reads).every((s) => s.motion === 'snap' && s.lit[0] === 'true'));
      assert.equal(pips.filter((pip) => pip.dataset.lit === 'true').length, action === 'seek' ? 3 : 1);
    } finally { h.close(); }
  }
});

test('synthetic partial bars require explicit estimated map AND bar markers', () => {
  const bar = { startMs: 0, endMs: 750, numerator: 3, denominator: 4,
    beatTimesMs: [0, 500], partial: true, estimated: true };
  const estimate: MeterMap = { id: 'synthetic-partial', durationMs: 750, estimated: true, bars: [bar] };
  assert.equal(isValidMeterMap(estimate), true);
  assert.equal(getMeterFrame(estimate, 749)?.numerator, 3);
  assert.equal(getMeterFrame(estimate, 749)?.litCount, 2);
  for (const invalid of [{ ...estimate, estimated: false },
    { ...estimate, bars: [{ ...bar, estimated: false }] },
    { ...estimate, bars: [{ ...bar, partial: false }] },
    { ...estimate, bars: [{ ...bar, beatTimesMs: [] }] },
    { ...estimate, bars: [{ ...bar, beatTimesMs: [0, 100, 200, 300] }] }]) {
    assert.equal(isValidMeterMap(invalid), false);
  }
  for (const change of [{ startMs: 0, bpm: 140, endMs: 0, endBpm: 124 },
    { startMs: 0, bpm: 140, endMs: 1000, endBpm: NaN },
    { startMs: 0, bpm: 140, endMs: 1000 }]) {
    assert.equal(isValidMeterMap({ ...estimate, tempoChanges: [change] }), false);
  }
});
