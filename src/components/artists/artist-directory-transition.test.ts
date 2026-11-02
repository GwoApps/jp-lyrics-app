import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startArtistViewTransition, waitForArtistDirectorySnapshot } from './artist-directory-transition';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
function fixture() {
  let mutation = () => {};
  let disconnected = 0;
  const listeners = new Map<string, () => void>();
  class Observer {
    constructor(callback: () => void) { mutation = callback; }
    observe() {}
    disconnect() { disconnected++; }
  }
  const directory = { dataset: { artistDirectoryState: 'loading' }, querySelectorAll: () => [] as unknown[] };
  const window = {
    location: { pathname: '/artists' },
    getComputedStyle: () => ({ viewTransitionName: 'artist-avatar-61' }),
    matchMedia: () => ({ matches: false }),
    addEventListener: (name: string, callback: () => void) => { listeners.set(name, callback); },
    removeEventListener: (name: string) => { listeners.delete(name); },
  };
  const document = {
    defaultView: window,
    documentElement: {},
    querySelector: (selector: string): unknown => selector === '[data-artist-directory-state]' ? directory : {},
  };
  return { document: document as unknown as Document, window, directory, Observer, mutate: () => mutation(), disconnected: () => disconnected, popstate: () => listeners.get('popstate')?.() };
}

test('snapshot waits for fresh directory commit; empty/error/revoked membership never uses old rows', async (t) => {
  for (const state of ['ready', 'error']) {
    const f = fixture();
    const original = globalThis.MutationObserver;
    globalThis.MutationObserver = f.Observer as unknown as typeof MutationObserver;
    t.after(() => { globalThis.MutationObserver = original; });
    let resolved = false;
    const ready = waitForArtistDirectorySnapshot(f.document, 'artist-avatar-61', new AbortController().signal).then(() => { resolved = true; });
    await Promise.resolve(); assert.equal(resolved, false);
    f.directory.dataset.artistDirectoryState = state;
    f.mutate(); await ready;
    assert.equal(f.disconnected(), 1);
  }
});

test('snapshot awaits the matching image decode rather than a sleep or unrelated avatars', async (t) => {
  const f = fixture(); const decoded = deferred();
  const original = globalThis.MutationObserver;
  globalThis.MutationObserver = f.Observer as unknown as typeof MutationObserver;
  t.after(() => { globalThis.MutationObserver = original; });
  const image = { isConnected: true, loading: 'lazy', decode: () => decoded.promise };
  f.directory.querySelectorAll = () => [{ isConnected: true, querySelector: () => image }];
  f.directory.dataset.artistDirectoryState = 'ready';
  let resolved = false;
  const ready = waitForArtistDirectorySnapshot(f.document, 'artist-avatar-61', new AbortController().signal).then(() => { resolved = true; });
  await Promise.resolve(); assert.equal(resolved, false); assert.equal(image.loading, 'eager');
  decoded.resolve(); await ready; assert.equal(f.disconnected(), 1);
});

test('aborted or interrupted snapshot releases its observer without waiting for data', async (t) => {
  const original = globalThis.MutationObserver;
  t.after(() => { globalThis.MutationObserver = original; });
  for (const interrupt of ['abort', 'navigation']) {
    const f = fixture(); globalThis.MutationObserver = f.Observer as unknown as typeof MutationObserver;
    const controller = new AbortController();
    const ready = waitForArtistDirectorySnapshot(f.document, 'artist-avatar-61', controller.signal);
    if (interrupt === 'abort') controller.abort();
    else { f.window.location.pathname = '/'; f.popstate(); }
    await ready; assert.equal(f.disconnected(), 1);
  }
});

test('extends the existing native callback only once and preserves options and cleanup', async () => {
  const f = fixture(); f.window.location.pathname = '/songs/example';
  const calls: Array<ViewTransitionUpdateCallback | StartViewTransitionOptions | undefined> = [];
  const finished = deferred();
  const native = ((options: ViewTransitionUpdateCallback | StartViewTransitionOptions | undefined) => {
    calls.push(options);
    const update = typeof options === 'function' ? options : options?.update;
    return { ready: Promise.resolve().then(() => update?.()), finished: finished.promise } as unknown as ViewTransition;
  }) as Document['startViewTransition'];
  f.document.startViewTransition = native;
  let updates = 0;
  const transition = startArtistViewTransition(f.document, { types: ['back'], update: () => { updates++; } });
  await transition.ready;
  assert.equal(calls.length, 1); assert.equal(updates, 1);
  assert.deepEqual((calls[0] as StartViewTransitionOptions).types, ['back']);
  assert.equal(f.document.startViewTransition, native, 'native API is never patched'); finished.resolve();
});

test('reduced-motion passes through without installing a global bridge', () => {
  const f = fixture();
  const options = () => {};
  let received: unknown;
  f.document.startViewTransition = ((argument: unknown) => { received = argument; return {}; }) as Document['startViewTransition'];
  f.window.matchMedia = () => ({ matches: true });
  const native = f.document.startViewTransition;
  startArtistViewTransition(f.document, options); assert.equal(received, options);
  assert.equal(f.document.startViewTransition, native);
});
