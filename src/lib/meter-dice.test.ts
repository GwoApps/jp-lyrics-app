import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import * as engine from './meter-dice.ts';
import {
  getDicePips, getMeterFrame, isValidMeterMap, meterPlaybackMs, shouldRotateMeterDice,
  type MeterBar, type MeterMap,
} from './meter-dice.ts';
import type { MeterDiceProps } from '../components/song/MeterDice.tsx';

// Synthetic fixtures exercise the generic engine; none purports to chart a song.
const map: MeterMap = {
  id: 'test-only', durationMs: 7000,
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
    if (id.endsWith('.module.css')) return { default: { dice: 'dice', face: 'face', pip: 'pip', outline: 'outline', meter: 'meter' } };
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
  dataset: Record<string, string> = {};
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
    createElementNS: () => new FakeElement(),
    addEventListener: (_: string, fn: () => void) => visibility.add(fn),
    removeEventListener: (_: string, fn: () => void) => visibility.delete(fn),
  });
  install('window', { matchMedia: () => ({
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
    nodes, frames, visibility, preference, render,
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
    assert.equal(meter.textContent, '4/4');
    assert.equal(group.children.length, 4);
    assert.equal(group.children.filter((pip) => pip.dataset.lit === 'true').length, 1);
    assert.equal(face.animations.length, 1);
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
    assert.equal(meter.textContent, '3/4');
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
