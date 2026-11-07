import assert from 'node:assert/strict';
import test from 'node:test';
import { animateArtistSongArrival, artistRouteTransitionFinished, createArtistTabMotion } from './detail-motion';

type RecordedAnimation = { frames: Keyframe[]; options: KeyframeAnimationOptions; cancelled: boolean; finish: () => void; reject: () => void };
function panel(transform = 'none', opacity = '1') {
  const animations: RecordedAnimation[] = [];
  const element = {
    ownerDocument: { defaultView: { getComputedStyle: () => ({ transform, opacity }) } },
    animate(frames: Keyframe[], options: KeyframeAnimationOptions) {
      let finish!: () => void;
      let reject!: () => void;
      const finished = new Promise<void>((resolve, fail) => { finish = resolve; reject = () => fail(new Error('cancelled')); });
      const record = { frames, options, cancelled: false, finish, reject };
      animations.push(record);
      return { finished, cancel() { record.cancelled = true; } } as unknown as Animation;
    },
  } as unknown as HTMLElement;
  return { element, animations };
}

test('success arrival floats only the first eight rows with a bounded 40ms stagger', () => {
  const rows = Array.from({ length: 237 }, () => panel());
  const cancel = animateArtistSongArrival(rows.map((row) => row.element), false);
  assert.deepEqual(rows.map((row) => row.animations.length).slice(0, 10), [1, 1, 1, 1, 1, 1, 1, 1, 0, 0]);
  assert.deepEqual(rows[0].animations[0].frames, [{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'translateY(0)' }]);
  assert.equal(rows[7].animations[0].options.delay, 280);
  assert.equal(rows[0].animations[0].options.duration, 320);
  assert.equal(rows[0].animations[0].options.fill, 'backwards');
  cancel();
  assert.ok(rows.slice(0, 8).every((row) => row.animations[0].cancelled));
});

test('list arrival waits for the route snapshot to finish and cancellation cannot restart it', async () => {
  for (const cancelBeforeReady of [false, true]) {
    let finishRoute!: () => void;
    const route = new Promise<void>((resolve) => { finishRoute = resolve; });
    let pauses = 0; let plays = 0; let cancels = 0;
    const row = { animate: () => ({ finished: Promise.resolve(), pause: () => { pauses++; }, play: () => { plays++; }, cancel: () => { cancels++; } }) } as unknown as HTMLElement;
    const cancel = animateArtistSongArrival([row], false, route);
    assert.equal(pauses, 1); assert.equal(plays, 0);
    if (cancelBeforeReady) cancel();
    finishRoute(); await Promise.resolve(); await Promise.resolve();
    assert.equal(plays, cancelBeforeReady ? 0 : 1);
    if (!cancelBeforeReady) cancel();
    assert.equal(cancels, 1);
  }
});

test('a skipped route transition still releases the row entrance', async () => {
  let plays = 0;
  const row = { animate: () => ({ finished: Promise.resolve(), pause() {}, play: () => { plays++; }, cancel() {} }) } as unknown as HTMLElement;
  const cleanup = animateArtistSongArrival([row], false, Promise.reject(new Error('skipped')));
  await Promise.resolve(); await Promise.resolve();
  assert.equal(plays, 1); cleanup();
});

test('route completion uses the active transition or native-only animation fallback', async () => {
  const finished = Promise.resolve();
  assert.equal(artistRouteTransitionFinished({ activeViewTransition: { finished } } as unknown as Document), finished);
  assert.equal(artistRouteTransitionFinished({ getAnimations: () => [] } as unknown as Document), undefined);
  const pending = new Promise(() => {});
  const fallback = artistRouteTransitionFinished({ getAnimations: () => [
    { animationName: '-ua-view-transition-group-anim-root', finished },
    { animationName: 'artist-detail-pulse', finished: pending },
  ] } as unknown as Document);
  assert.ok(fallback); await fallback;
});

test('reduced motion and missing WAAPI leave song rows immediately visible', () => {
  const row = panel();
  animateArtistSongArrival([row.element], true)();
  assert.equal(row.animations.length, 0);
  assert.doesNotThrow(() => animateArtistSongArrival([{} as HTMLElement], false)());
});

test('forward tabs enter from the right and exit left; reverse uses the opposite direction', async () => {
  for (const direction of [1, -1] as const) {
    const incoming = panel();
    const outgoing = panel();
    let completed = 0;
    const motion = createArtistTabMotion();
    motion.transition(incoming.element, outgoing.element, direction, false, () => { completed++; });
    assert.equal(incoming.animations[0].frames[0].transform, `translateX(${direction * 32}px)`);
    assert.equal(outgoing.animations[0].frames[1].transform, `translateX(${-direction * 32}px)`);
    incoming.animations[0].finish();
    outgoing.animations[0].finish();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(completed, 1);
    motion.cancel();
    assert.ok(incoming.animations[0].cancelled);
  }
});

test('rapid reversals retarget the current frame and ignore stale animation completions', async () => {
  const songs = panel('matrix(1, 0, 0, 1, -11, 0)', '0.6');
  const albums = panel('matrix(1, 0, 0, 1, 15, 0)', '0.4');
  const motion = createArtistTabMotion();
  let stale = 0;
  let latest = 0;
  motion.transition(albums.element, songs.element, 1, false, () => { stale++; });
  motion.transition(songs.element, albums.element, -1, false, () => { latest++; });
  assert.equal(songs.animations[1].frames[0].transform, 'matrix(1, 0, 0, 1, -11, 0)');
  assert.equal(albums.animations[1].frames[0].opacity, '0.4');
  assert.ok(songs.animations[0].cancelled);
  for (const item of [...songs.animations, ...albums.animations]) item.finish();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(stale, 0);
  assert.equal(latest, 1);
  motion.cancel();
});

test('reduced-motion pane switches and unsupported browsers settle synchronously', () => {
  const motion = createArtistTabMotion();
  const incoming = panel();
  const outgoing = panel();
  let completed = 0;
  motion.transition(incoming.element, outgoing.element, 1, true, () => { completed++; });
  motion.transition({} as HTMLElement, {} as HTMLElement, 1, false, () => { completed++; });
  assert.equal(completed, 2);
  assert.equal(incoming.animations.length, 0);
});

test('a platform-cancelled transition settles instead of leaving the outgoing pane mounted', async () => {
  const motion = createArtistTabMotion();
  const incoming = panel();
  const outgoing = panel();
  let completed = false;
  motion.transition(incoming.element, outgoing.element, 1, false, () => { completed = true; });
  outgoing.animations[0].reject();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(completed, true);
  motion.cancel();
});

test('unmount cancellation prevents late pane completions', async () => {
  const motion = createArtistTabMotion();
  const incoming = panel();
  const outgoing = panel();
  let completed = false;
  motion.transition(incoming.element, outgoing.element, 1, false, () => { completed = true; });
  motion.cancel();
  incoming.animations[0].finish();
  outgoing.animations[0].finish();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(completed, false);
});
