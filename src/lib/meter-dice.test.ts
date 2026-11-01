import * as metronome from './meter-metronome.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { getOddDiceGlowIntensity } from './odd-dice.ts';
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
    if (id === '@/lib/meter-metronome') return metronome;
    if (id.endsWith('.module.css')) return { default: { dice: 'dice', glow: 'glow', glowBreath: 'glowBreath', light: 'light', lightViewport: 'lightViewport', lightField: 'lightField', face: 'face', pip: 'pip', outline: 'outline', meter: 'meter', socket: 'socket', haloOuter: 'haloOuter', haloInner: 'haloInner', filament: 'filament', core: 'core' } };
    return require(id);
  };
  new Function('require', 'module', 'exports', componentJS)(localRequire, loaded, loaded.exports);
  return loaded.exports.default;
}

test('real React SSR is hydration-safe, localized and silent with no fabricated active face', () => {
  const Dice = loadDice();
  for (const playback of [null, { progress_ms: 2500, is_playing: true }, { progress_ms: 0, is_playing: false }]) {
    const html = renderToStaticMarkup(React.createElement(Dice, {
      map, playback, matching: true, playbackMsRef: { current: 2500 }, soundLabels: { start: 'Start', stop: 'Stop', unlock: 'Unlock', unavailable: 'Unavailable' }, label: 'Localized dice label',
      glowWindows: [{ startMs: 1200, endMs: 4500 }],
    }));
    assert.match(html, /role="img" aria-label="Localized dice label"/);
    assert.match(html, /viewBox="0 0 100 100" aria-hidden="true" focusable="false"/);
    assert.match(html, /data-glow="off" data-glow-motion="paused"/);
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
  readonly opacityWrites: string[] = [];
  style = new Proxy({ opacity: '' }, {
    set: (target, key: 'opacity', value: string) => {
      this.opacityWrites.push(value);
      target[key] = String(Number(value));
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
  animations: { keyframes: Keyframe[]; options: KeyframeAnimationOptions; onfinish: (() => void) | null; playState: string; cancelled: boolean; pause: () => void; play: () => void; cancel: () => void }[] = [];
  setAttribute(name: string, value: string) { this.attributes[name] = value; this.writes++; }
  replaceChildren(...children: FakeElement[]) { this.children = children; this.writes++; }
  animate(keyframes: Keyframe[], options: KeyframeAnimationOptions) {
    const animation = {
      keyframes, options, onfinish: null as (() => void) | null,
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
function diceHarness(initial: MeterDiceProps, initiallyReduced = false) {
  let now = 0;
  let hidden = false;
  let reduced = initiallyReduced;
  let nextRaf = 1;
  const styleReads: FakeElement[] = [];
  const styleSnapshots: { node: FakeElement; motion: string; lit: string[]; opacity: string; opacityWrites: string[] }[] = [];
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
      lit: nodes.get('g')!.children.map((pip) => pip.dataset.lit),
      opacity: node.style.opacity, opacityWrites: [...node.opacityWrites] });
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
    if (!React.isValidElement<{ ref?: { current: unknown }; className?: string; 'data-meter-hint'?: string; children?: React.ReactNode }>(node)) return;
    if (node.props.ref && typeof node.type === 'string') {
      const key = node.props['data-meter-hint'] !== undefined ? 'hint' : node.props.className === 'glow' ? 'glow' : node.type;
      const element = nodes.get(key) ?? new FakeElement();
      nodes.set(key, element);
      node.props.ref.current = element;
    }
    React.Children.forEach(node.props.children, attach);
  };
  let tree: React.ReactElement;
  const render = (props: MeterDiceProps) => {
    refIndex = 0;
    effectIndex = 0;
    tree = Dice(props) as React.ReactElement;
    attach(tree);
    pending.splice(0).forEach((effect) => effect());
  };
  render(initial);
  return {
    nodes, frames, visibility, preference, styleReads, styleSnapshots, render,
    trigger: () => tree.props as Record<string, (event: unknown) => void>,
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
    map, playbackMsRef: { current: 2480 }, playback: { progress_ms: 2480, is_playing: true }, matching: true, soundLabels: { start: 'Start', stop: 'Stop', unlock: 'Unlock', unavailable: 'Unavailable' }, label: 'Localized',
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
    map, playbackMsRef: { current: 1700 }, playback: { progress_ms: 1700, is_playing: true }, matching: true, soundLabels: { start: 'Start', stop: 'Stop', unlock: 'Unlock', unavailable: 'Unavailable' }, label: 'Localized',
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
    map, playbackMsRef: { current: 2480 }, playback: { progress_ms: 2480, is_playing: true }, matching: true, soundLabels: { start: 'Start', stop: 'Stop', unlock: 'Unlock', unavailable: 'Unavailable' }, label: 'Localized',
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
    map, playbackMsRef: { current: null }, playback: { progress_ms: 1500, is_playing: false }, matching: true, soundLabels: { start: 'Start', stop: 'Stop', unlock: 'Unlock', unavailable: 'Unavailable' }, label: 'Localized',
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
    playback: { progress_ms: 0, is_playing: true }, matching: true, soundLabels: { start: 'Start', stop: 'Stop', unlock: 'Unlock', unavailable: 'Unavailable' }, label: 'Localized' };
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
      motion: 'snap', lit: ['false', 'true', 'true'], opacity: '', opacityWrites: [] }], 'only the first pip commits dark; old lights remain lit');
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
    playback: { progress_ms: 1480, is_playing: true }, matching: true, soundLabels: { start: 'Start', stop: 'Stop', unlock: 'Unlock', unavailable: 'Unavailable' }, label: 'Localized' };
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
      playback: { progress_ms: 580, is_playing: true }, matching: true, soundLabels: { start: 'Start', stop: 'Stop', unlock: 'Unlock', unavailable: 'Unavailable' }, label: 'Localized' };
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


test('explicit source offsets preserve default behavior and fail closed when nonfinite', () => {
  for (const ms of [-1, 0, 1000, 1750, 2500, 6999, 7000]) {
    assert.deepEqual(getMeterFrame({ ...map, playbackToSourceOffsetMs: 0 }, ms), getMeterFrame(map, ms));
    assert.equal(getMeterBpm({ ...map, playbackToSourceOffsetMs: 0 }, ms), getMeterBpm(map, ms));
  }
  for (const offset of [NaN, Infinity, -Infinity]) {
    const invalid = { ...map, playbackToSourceOffsetMs: offset };
    assert.equal(isValidMeterMap(invalid), false);
    assert.equal(getMeterFrame(invalid, 1500), null);
    assert.equal(getMeterBpm(invalid, 1500), null);
  }
});

test('glow helper uses playback half-open windows and rejects missing or invalid positions', () => {
  const windows = [{ startMs: 1200, endMs: 1800 }, { startMs: 4500, endMs: 5500 }];
  for (const { startMs, endMs } of windows) {
    for (const [ms, expected] of [[startMs - 0.001, false], [startMs, true],
      [endMs - 0.001, true], [endMs, false], [(startMs + endMs) / 2, true]] as const) {
      assert.equal(engine.isInMeterGlowWindow(windows, ms), expected);
    }
  }
  for (const ms of [null, NaN, Infinity, -1, 0, 2000, 6000]) {
    assert.equal(engine.isInMeterGlowWindow(windows, ms), false);
  }
  assert.equal(engine.isInMeterGlowWindow(undefined, 1500), false);
  assert.equal(engine.isInMeterGlowWindow([], 1500), false);
  for (const window of [{ startMs: NaN, endMs: 1800 }, { startMs: 1200, endMs: Infinity },
    { startMs: -1, endMs: 1800 }, { startMs: 1800, endMs: 1200 }]) {
    assert.equal(engine.isInMeterGlowWindow([window], 1500), false);
  }
});

test('component glow follows the single clock, freezes lifecycle changes and never replays seeks', () => {
  const props: MeterDiceProps = { map, glowWindows: [{ startMs: 1200, endMs: 1800 }, { startMs: 4500, endMs: 5500 }],
    playbackMsRef: { current: 1200 }, playback: { progress_ms: 1200, is_playing: true },
    matching: true, soundLabels: { start: 'Start', stop: 'Stop', unlock: 'Unlock', unavailable: 'Unavailable' }, label: 'Localized' };
  const h = diceHarness(props);
  const root = h.nodes.get('div')!;
  const state = (glow: string, motion: string) => {
    assert.equal(root.dataset.glow, glow);
    assert.equal(root.dataset.glowMotion, motion);
  };
  try {
    state('active', 'running');
    assert.equal(h.nodes.get('glow')!.style.opacity, '1');
    const writes = () => root.dataWrites.filter(([key]) => key.startsWith('glow')).length;
    const before = writes();
    h.step(1216); h.step(1232);
    assert.equal(writes(), before, 'no repeated glow dataset writes within a window');
    props.playbackMsRef.current = null;
    const paused = { ...props, playback: { progress_ms: 1500, is_playing: false } };
    h.render(paused);
    state('active', 'paused');
    assert.equal(h.frames.size, 0);
    h.reduce(true); state('active', 'static');
    h.reduce(false); state('active', 'paused');
    props.playbackMsRef.current = 5000;
    h.render({ ...paused, playback: { progress_ms: 1500, is_playing: false } });
    state('active', 'paused');
    props.playbackMsRef.current = 1800;
    h.render({ ...paused, playback: { progress_ms: 1500, is_playing: false } });
    state('off', 'paused');
    h.render(props);
    h.step(4500); state('active', 'running');
    h.hide(true); state('active', 'paused');
    assert.equal(h.frames.size, 0);
    h.reduce(true); state('active', 'static');
    h.reduce(false); state('active', 'paused');
    props.playbackMsRef.current = 5500;
    h.hide(false); state('off', 'paused');
    assert.equal(h.frames.size, 1);
    h.step(1500); state('active', 'running');
    h.reduce(true); state('active', 'static');
    h.reduce(false); state('active', 'running');
    h.step(6000); state('off', 'paused');
    h.step(5000); state('active', 'running');
    h.render({ ...props, matching: false }); state('off', 'paused');
    h.render({ ...props, playback: null }); state('off', 'paused');
    h.render({ ...props, map: { ...map, bars: [] } }); state('off', 'paused');
    h.render({ ...props, glowWindows: undefined }); state('off', 'paused');
    h.render(props); state('active', 'running');
    h.hide(true);
    h.render({ ...props, matching: false }); state('off', 'paused');
    h.hide(false);
    h.render(props); state('active', 'running');
  } finally { h.close(); }
  assert.equal(root.dataset.glowMotion, 'paused');
  assert.equal(h.frames.size, 0);
  assert.equal(h.visibility.size, 0);
  assert.equal(h.preference.size, 0);
});

test('BPM intensity shares caption tempo, writes only changes and preserves other layers across lifecycle', () => {
  const tempoMap: MeterMap = { ...map, tempoChanges: [
    { startMs: 1000, bpm: 165 }, { startMs: 1750, bpm: 197.5 },
    { startMs: 4500, bpm: 230 },
  ] };
  const props: MeterDiceProps = { map: tempoMap,
    glowWindows: [{ startMs: 1200, endMs: 5500 }],
    getGlowIntensity: getOddDiceGlowIntensity,
    playbackMsRef: { current: 1200 }, playback: { progress_ms: 1200, is_playing: true },
    matching: true, soundLabels: { start: 'Start', stop: 'Stop', unlock: 'Unlock', unavailable: 'Unavailable' }, label: 'Localized' };
  const h = diceHarness(props);
  try {
    const glow = h.nodes.get('glow')!;
    const caption = h.nodes.get('span')!;
    const originalPips = h.nodes.get('g')!.children.flatMap((pip) => [pip, ...pip.children]);
    assert.notEqual(glow, caption);
    assert.equal(glow.style.opacity, '0.2');
    assert.equal(caption.textContent, '165 BPM');
    assert.deepEqual(h.styleSnapshots.filter((s) => s.node === glow).map((s) =>
      [s.opacity, s.opacityWrites]), [['0', ['0']]], '0 is committed before any target write');
    h.step(1216); h.step(1232);
    assert.deepEqual(glow.opacityWrites, ['0', '0.2'], 'normalized opacity never rewrites trailing zeroes');
    h.step(1750);
    assert.equal(glow.style.opacity, '0.6');
    assert.equal(caption.textContent, '198 BPM');
    h.step(4500);
    assert.equal(glow.style.opacity, '1');
    h.step(1200);
    assert.equal(glow.style.opacity, '0.2');
    const paused = { ...props, playback: { progress_ms: 1200, is_playing: false } };
    h.render(paused);
    assert.equal(glow.style.opacity, '0.2');
    assert.equal(h.frames.size, 0);
    props.playbackMsRef.current = 4500;
    h.render({ ...paused, playback: { ...paused.playback } });
    assert.equal(glow.style.opacity, '1', 'confirmed paused seek overrides old snapshot');
    props.playbackMsRef.current = 1750;
    h.render(paused);
    assert.equal(glow.style.opacity, '0.6');
    h.reduce(true);
    assert.equal(glow.style.opacity, '0.6');
    assert.equal(h.nodes.get('div')!.dataset.glowMotion, 'static');
    h.render(props);
    h.step(1200);
    assert.equal(glow.style.opacity, '0.2', 'reduced motion still follows BPM');
    h.reduce(false);
    h.hide(true);
    assert.equal(glow.style.opacity, '0.2');
    props.playbackMsRef.current = 4500;
    h.hide(false);
    assert.equal(glow.style.opacity, '1');
    h.step(5500);
    assert.equal(glow.style.opacity, '0');
    for (const changed of [{ matching: false }, { playback: null },
      { map: { ...tempoMap, bars: [] } }, { map: { ...tempoMap, tempoChanges: undefined } }]) {
      h.step(4500);
      h.render({ ...props, ...changed });
      assert.equal(glow.style.opacity, '0');
      h.render(props);
    }
    props.playbackMsRef.current = null;
    h.render({ ...props, playback: { ...props.playback! } });
    assert.equal(glow.style.opacity, '0', 'missing playing clock');
    h.step(4500);
    h.hide(true);
    h.render({ ...props, matching: false });
    assert.equal(glow.style.opacity, '0', 'hidden mismatch clears inline intensity');
    assert.equal(h.styleReads.filter((node) => node === glow).length, 1, 'no re-entry reset or per-frame glow read');
    for (const node of [...h.nodes.values(), ...originalPips]) {
      if (node !== glow) assert.deepEqual(node.opacityWrites, [], 'only glow wrapper receives opacity');
    }
  } finally { h.close(); }
});

test('component clamps nonfinite and out-of-range intensity resolvers', () => {
  const props: MeterDiceProps = { map, glowWindows: [{ startMs: 1200, endMs: 5500 }],
    playbackMsRef: { current: 1500 }, playback: { progress_ms: 1500, is_playing: true },
    matching: true, soundLabels: { start: 'Start', stop: 'Stop', unlock: 'Unlock', unavailable: 'Unavailable' }, label: 'Localized' };
  const h = diceHarness(props);
  try {
    for (const [value, expected] of [[NaN, '0'], [Infinity, '0'], [-Infinity, '0'],
      [-0.5, '0'], [1.5, '1'], [0.123456, '0.1235']] as const) {
      h.render({ ...props, getGlowIntensity: () => value });
      assert.equal(h.nodes.get('glow')!.style.opacity, expected);
    }
  } finally { h.close(); }
});


test('ignitions are one-shot new-beat events, repeat downbeats, and cancel without replay', () => {
  const repeated: MeterMap = { id: 'ignitions', durationMs: 1800, bars: [0, 600, 1200].map((startMs) => ({
    startMs, endMs: startMs + 600, numerator: 3, denominator: 4,
    beatTimesMs: [startMs, startMs + 200, startMs + 400],
  })) };
  const props: MeterDiceProps = { map: repeated, playbackMsRef: { current: 0 },
    playback: { progress_ms: 0, is_playing: true }, matching: true, soundLabels: { start: 'Start', stop: 'Stop', unlock: 'Unlock', unavailable: 'Unavailable' }, label: 'Localized' };
  const h = diceHarness(props);
  const pips = h.nodes.get('g')!.children;
  const layers = pips.flatMap((pip) => pip.children.slice(1));
  const count = () => layers.reduce((sum, layer) => sum + layer.animations.length, 0);
  const cancelled = () => assert.ok(layers.every((layer) => layer.animations.every((a) => a.cancelled)));
  try {
    assert.equal(count(), 0, 'initial positioning does not ignite history');
    h.step(200, 200);
    assert.equal(count(), 4);
    for (const [index, layer] of pips[1].children.slice(1).entries()) {
      const animation = layer.animations[0];
      assert.deepEqual(animation.options, { duration: 140, easing: 'linear' });
      assert.deepEqual(animation.keyframes.map((k) => k.offset), [0, 40 / 140, 1]);
      const values = animation.keyframes.map((k) => Number(k.opacity));
      assert.equal(values[0], 0);
      assert.ok(values[1] > values[2] && values[1] <= 1);
      assert.equal(values[2], [0.08, 0.16, 0.85, 0.9][index]);
    }
    h.step(216); assert.equal(count(), 4);
    pips[1].children[4].animations[0].onfinish?.();
    cancelled();
    h.step(400, 184); h.step(600, 200);
    assert.equal(pips[0].children[4].animations.length, 1);
    h.step(800, 200); h.step(1000, 200); h.step(1200, 200);
    assert.equal(pips[0].children[4].animations.length, 2, 'same-meter first lamp retriggers on retained node');
    assert.equal(h.nodes.get('g')!.children, pips);
    const total = count();
    h.render({ ...props, playback: { ...props.playback! } }); cancelled();
    h.step(1216); assert.equal(count(), total, 'poll does not replay');
    h.reduce(true); h.reduce(false); h.step(1232); assert.equal(count(), total);
    h.render({ ...props, playback: { progress_ms: 1232, is_playing: false } });
    h.render(props); h.step(1248); assert.equal(count(), total, 'resume does not flash row');
    h.hide(true); props.playbackMsRef.current = 1600; h.hide(false);
    assert.equal(count(), total, 'restore does not replay skipped beats');
    h.step(0); assert.equal(count(), total, 'seek does not ignite');
    h.step(200, 200); assert.equal(count(), total + 4);
    h.reduce(true); cancelled();
    h.step(400, 200); assert.equal(count(), total + 4);
    h.reduce(false); h.step(600, 200);
  } finally { h.close(); }
  cancelled();
  assert.equal(h.frames.size + h.visibility.size + h.preference.size, 0);
});


test('initial reduced motion sets a static glow target without style flush or ignition', () => {
  const h = diceHarness({ map, glowWindows: [{ startMs: 1200, endMs: 5500 }],
    getGlowIntensity: () => 0.2, playbackMsRef: { current: 1500 },
    playback: { progress_ms: 1500, is_playing: true }, matching: true, soundLabels: { start: 'Start', stop: 'Stop', unlock: 'Unlock', unavailable: 'Unavailable' }, label: 'Localized' }, true);
  try {
    const glow = h.nodes.get('glow')!;
    assert.equal(glow.style.opacity, '0.2');
    assert.equal(h.nodes.get('div')!.dataset.glowMotion, 'static');
    assert.ok(!h.styleReads.includes(glow));
    h.step(1516); h.reduce(false); h.step(1532);
    assert.ok(h.nodes.get('g')!.children.every((pip) => pip.children.every((layer) => !layer.animations.length)));
    assert.deepEqual(glow.opacityWrites, ['0', '0.2']);
  } finally { h.close(); }
});

test('glow shares face dimensions and keeps the SVG outer contour stationary', () => {
  const css = readFileSync(new URL('../components/song/MeterDice.module.css', import.meta.url), 'utf8');
  assert.match(css, /--dice-face-size: 48px/);
  assert.match(css, /--dice-face-size: 72px/);
  for (const name of ['face', 'glow']) {
    const rule = css.match(new RegExp('\\.' + name + ' \\{([^}]+)'))![1];
    assert.match(rule, /width: var\(--dice-face-size\)/);
    assert.match(rule, /height: var\(--dice-face-size\)/);
  }
  assert.match(css, /inset: 1%;/);
  assert.match(css, /border-radius: calc\(var\(--dice-face-size\) \* 0\.23\)/);
  assert.match(css, /border: calc\(var\(--dice-face-size\) \* 0\.02\) solid/);
  assert.doesNotMatch(css.match(/@keyframes diceGlowBreath \{[\s\S]*?\n\}/)![0], /transform/);
  assert.doesNotMatch(css, /data-glow='active'\] \.glow \{ opacity/);
});


test('native trigger keeps image label; touch ignores hover/leave, keyboard blur/Escape stop', () => {
  const h = diceHarness({ map, playbackMsRef: { current: 1200 }, playback: { progress_ms: 1200, is_playing: true }, matching: true,
    label: 'Localized', soundLabels: { start: 'Start', stop: 'Stop', unlock: 'Unlock', unavailable: 'Unavailable' } });
  try {
    const button = h.nodes.get('button')!;
    const events = h.trigger();
    events.onPointerEnter({ pointerType: 'touch' });
    assert.equal(button.attributes['aria-pressed'], 'false');
    events.onPointerDown({ pointerType: 'touch' }); events.onClick({ detail: 1 });
    assert.equal(button.attributes['aria-pressed'], 'true');
    assert.equal(h.nodes.get('hint')!.textContent, 'Unavailable');
    events.onPointerLeave({}); assert.equal(button.attributes['aria-pressed'], 'true');
    events.onClick({ detail: 1 }); assert.equal(button.attributes['aria-pressed'], 'false');
    events.onClick({ detail: 0 }); assert.equal(button.attributes['aria-pressed'], 'true');
    events.onBlur({}); assert.equal(button.attributes['aria-pressed'], 'false');
    events.onClick({ detail: 0 }); events.onKeyDown({ key: 'Escape' });
    assert.equal(button.attributes['aria-pressed'], 'false');
    events.onPointerDown({ pointerType: 'mouse' }); events.onClick({ detail: 1 });
    events.onPointerLeave({}); assert.equal(button.attributes['aria-pressed'], 'false');
  } finally { h.close(); }
});

test('actual paint drives reduced-motion audio; poll, seek, hide and mouseleave silence it', () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
  let clicks = 0;
  let stopped = 0;
  let closed = 0;
  class Audio {
    state = 'running'; currentTime = 0; destination = {};
    resume() { this.state = 'running'; return Promise.resolve(); }
    suspend() { this.state = 'suspended'; return Promise.resolve(); }
    close() { closed++; this.state = 'closed'; return Promise.resolve(); }
    createOscillator() { return { frequency: { setValueAtTime() {} }, connect() {}, disconnect() {}, start() { clicks++; }, stop(at?: number) { if (at == null) stopped++; }, onended: null }; }
    createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }; }
  }
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: Audio });
  const props: MeterDiceProps = { map, playbackMsRef: { current: 2480 }, playback: { progress_ms: 2480, is_playing: true }, matching: true,
    label: 'Localized', soundLabels: { start: 'Start', stop: 'Stop', unlock: 'Unlock', unavailable: 'Unavailable' } };
  const h = diceHarness(props, true);
  try {
    h.trigger().onPointerEnter({ pointerType: 'mouse' });
    assert.equal(clicks, 0);
    h.step(2496); h.step(2512);
    assert.equal(clicks, 1, 'reduced motion still sounds authored downbeat');
    h.step(2528); assert.equal(clicks, 1);
    h.render({ ...props, playback: { ...props.playback! } });
    assert.ok(stopped > 0, 'snapshot stops active click');
    h.step(4000); assert.equal(clicks, 1, 'seek cannot catch up');
    h.hide(true); props.playbackMsRef.current = 4500; h.hide(false);
    assert.equal(clicks, 1);
    h.trigger().onPointerLeave({});
    h.step(4750, 250); assert.equal(clicks, 1, 'leave revokes subsequent beats');
  } finally {
    h.close();
    if (saved) Object.defineProperty(globalThis, 'AudioContext', saved); else Reflect.deleteProperty(globalThis, 'AudioContext');
  }
  assert.equal(closed, 1);
});

test('interactive zoom keeps visible hit targets and bounds rotating ambient boxes', () => {
  const css = readFileSync(new URL('../components/song/MeterDice.module.css', import.meta.url), 'utf8');
  const visual = css.match(/\.visual \{([^}]+)\}/)![1];
  assert.match(visual, /transform-origin: 99% top/);
  assert.match(visual, /pointer-events: auto/);
  assert.match(visual, /transition: transform 200ms/);
  assert.match(css, /data-active='true'\] \.visual \{ transform: scale\(1\.5\)/);
  const viewport = css.match(/\.lightViewport \{([^}]+)\}/)![1];
  assert.match(viewport, /position: absolute/);
  assert.match(viewport, /inset: 0/);
  assert.match(viewport, /border-radius: inherit/);
  assert.match(viewport, /overflow: clip/);
  assert.doesNotMatch(viewport, /transform|animation|filter/);
  const field = css.match(/\.lightField \{([^}]+)\}/)![1];
  assert.match(field, /inset: 0/);
  assert.match(field, /ellipse at 50% 2%/);
  assert.match(field, /3\.2s linear infinite paused/);
  assert.match(css, /4\.4s linear infinite reverse paused/);
  assert.match(css, /\.light \{ filter: blur\(7px\); \}/);
  assert.match(css, /\.light\[data-meter-light='secondary'\] \{ filter: blur\(6px\); \}/);
  assert.doesNotMatch(css, /inset: 15%|overflow-x:/);
  assert.doesNotMatch(css.match(/@keyframes diceGlowOrbit \{[\s\S]*?\n\}/)![0], /filter|opacity|translate/);
  assert.match(css, /inset: 1%/, 'the emitting contour remains aligned with the painted SVG outline');
});


test('independent edge lights share existing glow lifecycle selectors and static clipping wrappers', () => {
  const Dice = loadDice();
  const html = renderToStaticMarkup(React.createElement(Dice, {
    map, playback: null, matching: true, playbackMsRef: { current: null }, label: 'Dice',
    soundLabels: { start: 'Start', stop: 'Stop', unlock: 'Unlock', unavailable: 'Unavailable' },
  }));
  for (const source of ['primary', 'secondary']) {
    assert.equal(html.split(`data-meter-light="${source}"`).length - 1, 1);
    assert.ok(html.includes(`data-meter-light="${source}" class="light"><span class="lightViewport"><span class="lightField"></span></span></span>`));
  }
  const css = readFileSync(new URL('../components/song/MeterDice.module.css', import.meta.url), 'utf8');
  assert.match(css, /\.dice\[data-glow='active'\]\[data-glow-motion='running'\] \.lightField,[\s\S]*?animation-play-state: running/);
  assert.match(css, /\.dice\[data-glow-motion='static'\] \.lightField,[\s\S]*?animation: none/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.glow \{ transition: none; \}\s*\.dice \.lightField,.*animation: none/);
  // The existing lifecycle harness covers pause, hide, seek, reduce, mismatch and cleanup;
  // both fields inherit those root selectors without adding any JS animation owner.
  assert.doesNotMatch(componentSource, /setTimeout|setInterval/);
});


test('zoom reserves real inline space with the same timing and immediate reduced-motion sizing', () => {
  const css = readFileSync(new URL('../components/song/MeterDice.module.css', import.meta.url), 'utf8');
  const trigger = css.match(/\.trigger \{([^}]+)\}/)![1];
  const visual = css.match(/\.visual \{([^}]+)\}/)![1];
  const timing = '200ms cubic-bezier(0.23, 1, 0.32, 1)';
  assert.ok(trigger.includes(`transition: padding-inline-start ${timing};`));
  assert.ok(visual.includes(`transition: transform ${timing};`));
  assert.match(trigger, /padding-inline-start: 0;/);
  assert.match(trigger, /flex: 0 0 auto;/);
  assert.match(trigger, /margin-inline-start: auto;/);
  assert.doesNotMatch(trigger, /(?:^|[;\n])\s*(?:width|max-width|inline-size|max-inline-size):/);
  assert.match(css, /\.trigger\[data-active='true'\] \{\s*padding-inline-start: calc\(var\(--dice-face-size\) \* 0\.5\);\s*\}/);
  assert.match(visual, /transform-origin: 99% top;/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.trigger, \.visual \{ transition: none; \}/);
  assert.match(css, /\.trigger\[data-active='true'\] \.meter \{ transform: translateY\(calc\(var\(--dice-face-size\) \* 0\.5\)\); \}/);
  assert.match(css, /font-size: 10px;/);
  assert.doesNotMatch(componentSource, /ResizeObserver/);
});

test('painted stroke right edge stays anchored while the real layout reserve grows', () => {
  const css = readFileSync(new URL('../components/song/MeterDice.module.css', import.meta.url), 'utf8');
  const originFraction = Number(css.match(/transform-origin: (\d+)% top/)![1]) / 100;
  assert.equal(originFraction, (2 + 96 + 2 / 2) / 100, 'rect x + width + half stroke');
  for (const [face, slot] of [[48, 52], [72, 78]]) {
    const initialStart = 1000 - slot + (slot - face) / 2;
    const initialRight = initialStart + face * originFraction;
    const initialNeighbor = 1000 - slot - 12;
    for (const progress of [0, 0.125, 0.25, 0.5, 0.75, 1, 0.75, 0.25, 0]) {
      const reserve = face * 0.5 * progress;
      const contentStart = 1000 - (slot + reserve) + reserve;
      const visualStart = contentStart + (slot - face) / 2;
      const origin = face * originFraction;
      const scale = 1 + 0.5 * progress;
      const paintedRight = visualStart + origin + (face * 0.99 - origin) * scale;
      const paintedLeft = visualStart + origin + (face * 0.01 - origin) * scale;
      const neighborRight = 1000 - (slot + reserve) - 12;
      assert.ok(Math.abs(paintedRight - initialRight) < 1e-9);
      assert.ok(Math.abs(initialNeighbor - neighborRight - reserve) < 1e-9);
      assert.ok(neighborRight < paintedLeft, 'the new space pushes, rather than covers, its neighbor');
    }
  }
});
