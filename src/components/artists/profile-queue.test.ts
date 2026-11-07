import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { createProfileQueue, profileSourceHref } from './profile-queue';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const profile = { name: 'Artist', imageUrl: null, description: null, genres: [], source: null, sourceUrl: null };
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function controlledFetch() {
  const calls: Array<{ url: string; init?: RequestInit; resolve: (response: Response) => void; reject: (error: Error) => void }> = [];
  globalThis.fetch = ((url: string, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
    calls.push({ url, init, resolve, reject });
    init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  })) as typeof fetch;
  return calls;
}

const success = () => Response.json({ profile });

test('profile requests are bounded across cards and use encoded, no-store endpoints', async () => {
  const calls = controlledFetch();
  const queue = createProfileQueue(4);
  const requests = Array.from({ length: 10 }, (_, index) => queue(`Artist / ${index}`, new AbortController().signal));
  assert.equal(calls.length, 4);
  assert.equal(calls[0].url, '/api/artists/Artist%20%2F%200/profile');
  assert.equal(calls[0].init?.cache, 'no-store');
  for (let index = 0; index < 10; index += 1) {
    assert.ok(calls[index], `request ${index} eventually starts`);
    calls[index].resolve(success());
    await flush();
    assert.ok(calls.length <= Math.min(10, index + 5));
  }
  assert.equal((await Promise.all(requests)).length, 10);
});

test('aborted queued cards never make a request', async () => {
  const calls = controlledFetch();
  const queue = createProfileQueue(1);
  const first = queue('First', new AbortController().signal);
  const controller = new AbortController();
  const second = queue('Second', controller.signal);
  const rejected = assert.rejects(second, { name: 'AbortError' });
  controller.abort();
  await rejected;
  calls[0].resolve(success());
  await first;
  await flush();
  assert.equal(calls.length, 1);
});

test('aborted in-flight requests release their slot', async () => {
  const calls = controlledFetch();
  const queue = createProfileQueue(1);
  const controller = new AbortController();
  const first = queue('First', controller.signal);
  const rejected = assert.rejects(first, { name: 'AbortError' });
  const second = queue('Second', new AbortController().signal);
  controller.abort();
  await rejected;
  await flush();
  assert.equal(calls.length, 2);
  calls[1].resolve(success());
  assert.deepEqual(await second, profile);
});

test('HTTP and invalid-profile failures do not block subsequent portraits', async () => {
  const calls = controlledFetch();
  const queue = createProfileQueue(1);
  const first = queue('First', new AbortController().signal);
  const firstRejected = assert.rejects(first, /profile_load_failed/);
  const second = queue('Second', new AbortController().signal);
  const secondRejected = assert.rejects(second, /invalid_profile/);
  const third = queue('Third', new AbortController().signal);
  calls[0].resolve(new Response(null, { status: 503 }));
  await firstRejected;
  await flush();
  calls[1].resolve(Response.json({ profile: null }));
  await secondRejected;
  await flush();
  calls[2].resolve(success());
  assert.deepEqual(await third, profile);
});

test('already aborted requests do not enter the queue', async () => {
  const calls = controlledFetch();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(createProfileQueue()('Never', controller.signal), { name: 'AbortError' });
  assert.equal(calls.length, 0);
});

test('late JSON results cannot resolve after cancellation', async () => {
  const calls = controlledFetch();
  const controller = new AbortController();
  const pending = createProfileQueue()('Artist', controller.signal);
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  let finishJson: ((value: unknown) => void) | undefined;
  const response = { ok: true, json: () => new Promise((resolve) => { finishJson = resolve; }) } as Response;
  calls[0].resolve(response);
  await flush();
  controller.abort();
  finishJson?.({ profile });
  await rejected;
});

test('source attribution accepts HTTP(S) only', () => {
  assert.equal(profileSourceHref('https://example.com/artist'), 'https://example.com/artist');
  assert.equal(profileSourceHref('http://example.com/artist'), 'http://example.com/artist');
  for (const unsafe of [null, '', 'javascript:alert(1)', 'data:text/html,test', '/relative', 'not a url']) {
    assert.equal(profileSourceHref(unsafe), undefined);
  }
});
