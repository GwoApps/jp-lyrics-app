import test from 'node:test';
import assert from 'node:assert/strict';
import { createSharePreviewRenderer, type SharePreviewStatus } from './share-preview-renderer.ts';

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

type Frame = { id: number; pixels: string; width: number; height: number };

function setup() {
  const created: Frame[] = [];
  const committed: Frame[] = [];
  const released: Frame[] = [];
  const statuses: SharePreviewStatus[] = [];
  const renderer = createSharePreviewRenderer<Frame>({
    createFrame() {
      const frame = { id: created.length, pixels: '', width: 1200, height: 630 };
      created.push(frame);
      return frame;
    },
    commit(frame) { committed.push(frame); },
    onStatus(status) { statuses.push(status); },
    release(frame) { released.push(frame); },
  });
  return { renderer, created, committed, released, statuses };
}

test('isolates async resizes and pixels; only the latest request can commit', async () => {
  const { renderer, created, committed, released, statuses } = setup();
  renderer.request(async (frame) => { frame.pixels = 'initial'; });
  await flush();
  const initial = committed[0];
  const stale = deferred();
  renderer.request(async (frame) => {
    await stale.promise;
    frame.width = 630;
    frame.height = 1200;
    frame.pixels = 'obsolete portrait';
  });
  renderer.request(async (frame) => { frame.pixels = 'latest landscape'; });
  assert.equal(statuses.at(-1), 'drawing');
  assert.equal(committed.at(-1), initial);
  assert.equal(initial.pixels, 'initial');
  assert.equal(created.length, 2, 'newest work waits rather than allocating another canvas');
  stale.resolve();
  await flush();
  assert.deepEqual(committed.map((frame) => frame.pixels), ['initial', 'latest landscape']);
  assert.equal(initial.width, 1200, 'a stale resize never touches the committed frame');
  assert.equal(initial.height, 630);
  assert.equal(released[0].pixels, 'obsolete portrait');
  assert.equal(statuses.at(-1), 'ready');
  assert.equal(committed.at(-1), created[2], 'export uses the actual complete full-resolution frame');
});

test('coalesces rapid updates to one active draw plus one latest callback', async () => {
  const { renderer, created, committed, released } = setup();
  const gate = deferred();
  let started = 0;
  renderer.request(async () => { started += 1; await gate.promise; });
  for (let i = 0; i < 1000; i += 1) {
    renderer.request(async (frame) => { started += 1; frame.pixels = String(i); });
  }
  assert.equal(created.length, 1);
  assert.equal(started, 1);
  gate.resolve();
  await flush();
  assert.equal(started, 2);
  assert.equal(created.length, 2);
  assert.equal(committed.length, 1);
  assert.equal(committed[0].pixels, '999');
  assert.equal(released.length, 1);
});

test('draw rejection preserves the last success and never reports ready', async () => {
  const { renderer, committed, released, statuses } = setup();
  renderer.request(async (frame) => { frame.pixels = 'good'; });
  await flush();
  const prior = committed[0];
  const statusOffset = statuses.length;
  renderer.request(async (frame) => {
    frame.pixels = 'partially rendered';
    throw new Error('QR load failed');
  });
  await flush();
  assert.deepEqual(committed, [prior]);
  assert.deepEqual(statuses.slice(statusOffset), ['drawing', 'error']);
  assert.equal(released[0].pixels, 'partially rendered');
  renderer.request(async (frame) => { frame.pixels = 'recovered'; });
  await flush();
  assert.equal(committed.at(-1)?.pixels, 'recovered');
  assert.equal(statuses.at(-1), 'ready');
});

test('obsolete rejection cannot reset newer readiness or stop the next job', async () => {
  const { renderer, committed, statuses } = setup();
  const stale = deferred();
  const latest = deferred();
  renderer.request(async () => { await stale.promise; });
  renderer.request(async (frame) => { await latest.promise; frame.pixels = 'latest'; });
  stale.reject(new Error('stale error'));
  await flush();
  assert.deepEqual(statuses, ['drawing', 'drawing']);
  assert.equal(committed.length, 0);
  latest.resolve();
  await flush();
  assert.equal(statuses.at(-1), 'ready');
  assert.equal(committed[0].pixels, 'latest');
});

test('disabling invalidates work and drops queued requests without clearing the preview', async () => {
  const { renderer, committed, created, statuses } = setup();
  renderer.request(async (frame) => { frame.pixels = 'keep'; });
  await flush();
  const gate = deferred();
  renderer.request(async () => { await gate.promise; });
  renderer.request(async (frame) => { frame.pixels = 'must not run'; });
  renderer.request(null);
  gate.resolve();
  await flush();
  assert.deepEqual(committed.map((frame) => frame.pixels), ['keep']);
  assert.equal(created.length, 2);
  assert.equal(statuses.at(-1), 'idle');
  renderer.request(async (frame) => { frame.pixels = 'reenabled'; });
  await flush();
  assert.equal(committed.at(-1)?.pixels, 'reenabled');
});

test('dispose drops pending work, suppresses late callbacks and releases only after draw settles', async () => {
  const { renderer, created, committed, released, statuses } = setup();
  const gate = deferred();
  renderer.request(async (frame) => {
    await gate.promise;
    frame.width = 630;
    frame.pixels = 'late';
  });
  renderer.request(async () => { assert.fail('pending draw ran after unmount'); });
  renderer.dispose();
  renderer.dispose();
  renderer.request(async () => { assert.fail('disposed renderer accepted new work'); });
  assert.equal(released.length, 0, 'the asynchronous draw still owns its canvas');
  const finalStatuses = [...statuses];
  gate.resolve();
  await flush();
  assert.equal(created.length, 1);
  assert.equal(committed.length, 0);
  assert.deepEqual(released, created);
  assert.deepEqual(statuses, finalStatuses);
  assert.equal(statuses.at(-1), 'idle');
});

test('dispose also catches a late rejection without publishing an error', async () => {
  const { renderer, committed, released, statuses } = setup();
  const gate = deferred();
  renderer.request(async () => { await gate.promise; });
  renderer.dispose();
  gate.reject(new Error('after unmount'));
  await flush();
  assert.deepEqual(statuses, ['drawing', 'idle']);
  assert.equal(released.length, 1);
  assert.equal(committed.length, 0);
});

test('catches synchronous draw, frame creation and commit failures without false readiness', async () => {
  for (const failure of ['create', 'draw', 'commit'] as const) {
    const statuses: SharePreviewStatus[] = [];
    const released: object[] = [];
    const frame = {};
    const renderer = createSharePreviewRenderer({
      createFrame() {
        if (failure === 'create') throw new Error('create failed');
        return frame;
      },
      commit() { if (failure === 'commit') throw new Error('commit failed'); },
      onStatus(status) { statuses.push(status); },
      release(frame) { released.push(frame); },
    });
    renderer.request(() => {
      if (failure === 'draw') throw new Error('synchronous draw failure');
      return Promise.resolve();
    });
    await flush();
    assert.deepEqual(statuses, ['drawing', 'error'], failure);
    assert.deepEqual(released, failure === 'create' ? [] : [frame], failure);
  }
});
