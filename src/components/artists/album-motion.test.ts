import assert from 'node:assert/strict';
import test from 'node:test';
import { createArtistAlbumMotion } from './album-motion.ts';

function fixture() {
  let height = 74; const animations: { frames: Keyframe[]; cancel: () => void; finish: () => void }[] = [];
  const animate = (frames: Keyframe[]) => {
    let finish!: () => void;
    const animation = { frames, finished: new Promise<void>(resolve => { finish = resolve; }), cancel() {}, finish: () => finish() };
    animations.push(animation); return animation as unknown as Animation;
  };
  const body = { style: { opacity: '' }, getBoundingClientRect: () => ({ height: 200 }), animate };
  const element = { style: { height: '' }, offsetHeight: 74, clientHeight: 72, getBoundingClientRect: () => ({ height }), querySelector: () => ({ getBoundingClientRect: () => ({ height: 72 }) }), ownerDocument: { defaultView: { getComputedStyle: () => ({ opacity: '0.6' }) } }, animate };
  return { element: element as unknown as HTMLElement, body: body as unknown as HTMLElement, animations, setHeight: (v: number) => { height = v; } };
}

test('album disclosure animates opening and closing, samples a reversal before cancellation, and ignores stale finishes', async () => {
  const f = fixture(), motion = createArtistAlbumMotion(), settled: boolean[] = [];
  motion.transition(f.element, f.body, false, false, open => settled.push(open));
  motion.transition(f.element, f.body, true, false, open => settled.push(open));
  assert.equal(f.animations[0].frames[0].height, '74px');
  assert.equal(f.animations[0].frames[1].height, '274px');
  f.setHeight(180);
  motion.transition(f.element, f.body, false, false, open => settled.push(open));
  assert.equal(f.animations[2].frames[0].height, '180px');
  assert.equal(f.animations[2].frames[1].height, '74px');
  f.animations[0].finish(); f.animations[1].finish(); await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(settled, []);
  f.animations[2].finish(); f.animations[3].finish(); await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(settled, [false]);
  assert.equal(f.element.style.height, '74px');
});

test('unsupported animation API still closes cleanly without scheduling effects', async () => {
  const f = fixture(), motion = createArtistAlbumMotion(); let closed = false;
  motion.transition(f.element, f.body, true, false, () => {});
  Object.defineProperty(f.element, 'animate', { value: undefined });
  motion.transition(f.element, f.body, false, false, open => { closed = !open; });
  await Promise.resolve(); assert.equal(closed, true); assert.equal(f.animations.length, 0);
});

test('restored initial state, reduced motion, and unsupported WAAPI settle without animation; cancellation owns callbacks', async () => {
  const f = fixture(), motion = createArtistAlbumMotion(); let settles = 0;
  motion.transition(f.element, f.body, true, false, () => settles++);
  assert.equal(f.animations.length, 0);
  motion.transition(f.element, f.body, false, true, () => settles++);
  await Promise.resolve(); assert.equal(f.animations.length, 0); assert.equal(settles, 1);
  motion.transition(f.element, f.body, true, false, () => settles++);
  motion.cancel();
  for (const a of f.animations) a.finish();
  await Promise.resolve(); await Promise.resolve(); assert.equal(settles, 1);
});
