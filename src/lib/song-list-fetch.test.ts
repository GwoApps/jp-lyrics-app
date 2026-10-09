import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchSongList, requestSongList } from './song-list-fetch.ts';

type MockResponse = {
  ok: boolean;
  json: () => Promise<unknown>;
};

type FetchFn = (input: string, init?: { signal?: AbortSignal }) => Promise<MockResponse>;

function installFetch(fn: FetchFn) {
  const original = globalThis.fetch as unknown;
  globalThis.fetch = (async (input: unknown, init?: { signal?: AbortSignal }) =>
    fn(String(input), init)) as typeof fetch;
  return () => {
    globalThis.fetch = original as typeof fetch;
  };
}

test('song list fetch: returns songs on a successful array response', async () => {
  const restore = installFetch(async (url) => {
    assert.equal(url, '/api/songs');
    return { ok: true, json: async () => [{ id: 'a', title: 'A' }] };
  });
  try {
    const result = await requestSongList('all');
    assert.equal(result.ok, true);
    assert.equal(result.songs.length, 1);
  } finally {
    restore();
  }
});

const failedResponses: { name: string; scope: 'all' | 'mine'; respond: FetchFn }[] = [
  {
    name: 'network failure resolves to an empty failed result (not a throw)',
    scope: 'all',
    respond: async () => { throw new TypeError('Failed to fetch'); },
  },
  {
    name: 'HTTP 500 resolves to an empty failed result',
    scope: 'mine',
    respond: async () => ({ ok: false, json: async () => ({ error: 'boom' }) }),
  },
  {
    name: 'non-array JSON resolves to an empty failed result (invalid body is not trusted)',
    scope: 'all',
    respond: async () => ({ ok: true, json: async () => ({ error: 'session expired' }) }),
  },
  {
    name: 'non-JSON body resolves to an empty failed result',
    scope: 'all',
    respond: async () => ({
      ok: true,
      json: async () => { throw new SyntaxError('Unexpected token < in JSON'); },
    }),
  },
];

for (const { name, scope, respond } of failedResponses) {
  test(`song list fetch: ${name}`, async (t) => {
    t.after(installFetch(async (url, init) => {
      assert.equal(url, scope === 'mine' ? '/api/songs?mine=1' : '/api/songs');
      return respond(url, init);
    }));
    const result = await requestSongList(scope);
    assert.equal(result.ok, false);
    assert.deepEqual(result.songs, []);
  });
}

test('song list fetch: caller abort resolves to a failed result without waiting for the 8s timeout', async () => {
  let requestStarted!: () => void;
  const started = new Promise<void>((resolve) => { requestStarted = resolve; });
  const restore = installFetch(async (_url, init) => {
    const signal = init?.signal;
    assert.ok(signal, 'expected abort signal');
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      requestStarted();
    });
  });
  try {
    const controller = new AbortController();
    const pending = requestSongList('all', controller.signal);
    await started; // abort only after the mocked fetch is listening
    controller.abort();
    const result = await pending;
    assert.equal(result.ok, false);
    assert.deepEqual(result.songs, []);
  } finally {
    restore();
  }
});

test('fetchSongList: returns null on non-array body', async () => {
  const restore = installFetch(async () => ({ ok: true, json: async () => ({ nope: true }) }));
  try {
    assert.equal(await fetchSongList('all'), null);
  } finally {
    restore();
  }
});
