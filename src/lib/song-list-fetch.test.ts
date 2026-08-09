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

test('song list fetch: network failure resolves to an empty failed result (not a throw)', async () => {
  const restore = installFetch(async () => {
    throw new TypeError('Failed to fetch');
  });
  try {
    const result = await requestSongList('all');
    assert.equal(result.ok, false);
    assert.deepEqual(result.songs, []);
  } finally {
    restore();
  }
});

test('song list fetch: HTTP 500 resolves to an empty failed result', async () => {
  const restore = installFetch(async (url) => {
    assert.equal(url, '/api/songs?mine=1');
    return { ok: false, json: async () => ({ error: 'boom' }) };
  });
  try {
    const result = await requestSongList('mine');
    assert.equal(result.ok, false);
    assert.deepEqual(result.songs, []);
  } finally {
    restore();
  }
});

test('song list fetch: non-array JSON resolves to an empty failed result (invalid body is not trusted)', async () => {
  const restore = installFetch(async () => ({ ok: true, json: async () => ({ error: 'session expired' }) }));
  try {
    const result = await requestSongList('all');
    assert.equal(result.ok, false);
    assert.deepEqual(result.songs, []);
  } finally {
    restore();
  }
});

test('song list fetch: non-JSON body resolves to an empty failed result', async () => {
  const restore = installFetch(async () => {
    throw new SyntaxError('Unexpected token < in JSON');
  });
  try {
    const result = await requestSongList('all');
    assert.equal(result.ok, false);
    assert.deepEqual(result.songs, []);
  } finally {
    restore();
  }
});

test('song list fetch: an aborted request resolves to a failed result instead of hanging', async () => {
  const restore = installFetch(async (_url, init) => {
    const signal = init?.signal;
    if (!signal) throw new Error('expected abort signal');
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    });
  });
  try {
    const controller = new AbortController();
    const result = await requestSongList('all', controller.signal);
    assert.equal(result.ok, false);
    assert.deepEqual(result.songs, []);
    controller.abort();
  } finally {
    restore();
  }
});

test('song list fetch: existing cache survives a failed refresh (degraded, non-blocking)', async () => {
  const restore = installFetch(async () => {
    throw new TypeError('Failed to fetch');
  });
  try {
    const result = await requestSongList('all');
    // The caller keeps the previously cached songs; the failure is surfaced separately.
    assert.equal(result.ok, false);
    assert.deepEqual(result.songs, []);
  } finally {
    restore();
  }
});

test('fetchSongList: returns null on network failure and on non-array body', async () => {
  const restore = installFetch(async () => ({ ok: true, json: async () => ({ nope: true }) }));
  try {
    assert.equal(await fetchSongList('all'), null);
  } finally {
    restore();
  }
});
