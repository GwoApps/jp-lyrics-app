import test from 'node:test';
import assert from 'node:assert/strict';
import { MeterMetronome } from './meter-metronome.ts';

const frame = (beatIndex: number, barIndex = 0) => ({ beatIndex, barIndex, numerator: 4, denominator: 4, litCount: beatIndex + 1 });
function audio() {
  const voices: { frequency: number; peak: number; envelope: [string, number, number][]; stopAt?: number; stopped: boolean; disconnected: boolean; onended: (() => void) | null }[] = [];
  let state = 'running';
  let resolve: (() => void) | null = null;
  let deferred = false;
  let closed = 0;
  const ctx = {
    get state() { return state; }, currentTime: 1, destination: {},
    resume() { return deferred ? new Promise<void>((r) => { resolve = () => { state = 'running'; r(); }; }) : Promise.resolve(); },
    suspend() { state = 'suspended'; return Promise.resolve(); },
    close() { state = 'closed'; closed++; return Promise.resolve(); },
    createOscillator() {
      const voice = { frequency: 0, peak: 0, envelope: [] as [string, number, number][], stopAt: undefined as number | undefined, stopped: false, disconnected: false, onended: null as (() => void) | null };
      voices.push(voice);
      return { frequency: { setValueAtTime: (v: number) => { voice.frequency = v; } },
        connect() {}, disconnect() { voice.disconnected = true; }, start() {}, stop(at?: number) { if (at == null) voice.stopped = true; else voice.stopAt = at; },
        set onended(fn: (() => void) | null) { voice.onended = fn; } };
    },
    createGain() { const voice = voices.at(-1)!; return { gain: { setValueAtTime(v: number, t: number) { voice.envelope.push(['set', v, t]); }, linearRampToValueAtTime(v: number, t: number) { voice.peak = v; voice.envelope.push(['linear', v, t]); }, exponentialRampToValueAtTime(v: number, t: number) { voice.envelope.push(['exponential', v, t]); } }, connect() {}, disconnect() {} }; },
  };
  const statuses: string[] = [];
  let created = 0;
  const owner = new MeterMetronome(() => { created++; return ctx as unknown as AudioContext; }, (s) => statuses.push(s));
  return { owner, voices, statuses, ctx, created: () => created, closed: () => closed,
    defer() { deferred = true; state = 'suspended'; }, resolve() { resolve?.(); } };
}

test('lazy audio, one click per adjacent beat, distinct downbeat pitch and gain', () => {
  const a = audio();
  a.owner.sample(frame(0), true);
  assert.equal(a.created(), 0);
  a.owner.enable(frame(2));
  assert.equal(a.voices.length, 0);
  a.owner.sample(frame(3), true);
  a.owner.sample(frame(3), true);
  a.owner.sample(frame(0, 1), true);
  assert.deepEqual(a.voices.map((v) => [v.frequency, v.peak]), [[880, 0.14], [1320, 0.24]]);
  assert.equal(a.voices[1].peak / a.voices[0].peak, 0.12 / 0.07);
  for (const voice of a.voices) {
    assert.ok(voice.peak > 0 && voice.peak < 1);
    assert.deepEqual(voice.envelope, [['set', 0, 1], ['linear', voice.peak, 1.002], ['exponential', 0.0001, 1.035]]);
    assert.equal(voice.stopAt, 1.04);
  }
  a.owner.dispose();
  assert.ok(a.voices.every((v) => v.stopped && v.disconnected));
  assert.equal(a.closed(), 1);
});

test('snapshot, seek, skipped beats, missing frame and resume never replay; disable cancels sources', () => {
  const a = audio(); a.owner.enable(frame(0));
  a.owner.sample(frame(1), false);
  a.owner.sample(frame(3), true);
  a.owner.sample(null, false);
  a.owner.sample(frame(0, 1), true);
  assert.equal(a.voices.length, 0);
  a.owner.sample(frame(1, 1), true);
  assert.equal(a.voices.length, 1);
  a.owner.disable();
  assert.ok(a.voices[0].stopped && a.voices[0].disconnected);
  a.owner.sample(frame(2, 1), true);
  assert.equal(a.voices.length, 1);
  a.owner.dispose();
});

test('late resume after disable cannot revive sound; unmount closes context', async () => {
  const a = audio(); a.defer(); a.owner.enable(frame(0));
  assert.equal(a.statuses.at(-1), 'blocked');
  a.owner.disable(); a.resolve(); await Promise.resolve();
  assert.equal(a.ctx.state, 'suspended');
  assert.equal(a.statuses.at(-1), 'off');
  a.owner.sample(frame(1), true); assert.equal(a.voices.length, 0);
  a.owner.dispose(); assert.equal(a.closed(), 1);
});

test('unsupported and rejected audio report readable unavailable state without rejection', async () => {
  const statuses: string[] = [];
  const a = new MeterMetronome(() => { throw new Error('unsupported'); }, (s) => statuses.push(s));
  a.enable(frame(0)); assert.deepEqual(statuses, ['unavailable']); a.dispose();
  const b = new MeterMetronome(() => ({ state: 'suspended', resume: () => Promise.reject(new Error('blocked')), suspend: () => Promise.resolve(), close: () => Promise.resolve() }) as unknown as AudioContext, (s) => statuses.push(s));
  b.enable(frame(0)); await Promise.resolve(); await Promise.resolve();
  assert.equal(statuses.at(-1), 'unavailable'); b.dispose();
});
