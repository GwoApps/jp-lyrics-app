import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FetchTimeoutError,
  SPOTIFY_CLIENT_POLL_TIMEOUT_MS,
  SPOTIFY_REQUEST_TIMEOUT_MS,
  createTimeoutBudget,
  fetchJsonWithTimeout,
  fetchWithTimeout,
  isFetchTimeoutError,
  withFetchDeadline,
} from './fetch-timeout.ts';

/**
 * A fetch that accepts the connection and then never answers (issue #370).
 * `respectSignal` mirrors real `fetch`, which rejects with AbortError when its
 * signal fires; the ignoring variant proves the budget holds on its own.
 */
function hangingFetch(opts: { respectSignal?: boolean } = {}): typeof fetch {
  return (async (_input, init) => {
    const signal = init?.signal;
    if (opts.respectSignal && signal?.aborted) throw new DOMException('aborted', 'AbortError');
    return await new Promise<Response>((_resolve, reject) => {
      if (!opts.respectSignal || !signal) return;
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    });
  }) as typeof fetch;
}

/** A fetch that answers headers but then stalls while the body is read. */
function hangingBodyFetch(): typeof fetch {
  return (async () => new Response(new ReadableStream({
    start() { /* never enqueue, never close */ },
  }), { status: 200 })) as unknown as typeof fetch;
}

test('a hanging upstream rejects with FetchTimeoutError instead of staying pending', async () => {
  const started = Date.now();
  await assert.rejects(
    fetchWithTimeout(hangingFetch(), 'https://example.test/slow', {}, 15),
    (error: unknown) => {
      assert.ok(isFetchTimeoutError(error));
      assert.equal((error as FetchTimeoutError).timeoutMs, 15);
      return true;
    },
  );
  assert.ok(Date.now() - started < 1000, 'deadline fired promptly');
});

test('the deadline also covers reading the response body', async () => {
  await assert.rejects(
    fetchJsonWithTimeout(hangingBodyFetch(), 'https://example.test/body', {}, 15),
    (error: unknown) => isFetchTimeoutError(error),
  );
});

test('a caller cancel keeps its AbortError so it is never mistaken for a timeout', async () => {
  const controller = new AbortController();
  const run = fetchWithTimeout(
    hangingFetch({ respectSignal: true }),
    'https://example.test/cancel',
    { signal: controller.signal },
    5000,
  );
  await new Promise((resolve) => setTimeout(resolve, 5));
  controller.abort();
  await assert.rejects(run, (error: unknown) => {
    assert.equal((error as { name?: string }).name, 'AbortError');
    assert.equal(isFetchTimeoutError(error), false);
    return true;
  });
});

test('an already-cancelled caller rejects as an abort and never consumes a response', async () => {
  const controller = new AbortController();
  controller.abort();
  let consumed = 0;
  const abortedFetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    assert.equal(init?.signal?.aborted, true, 'the caller cancel reaches the composed signal');
    throw new DOMException('aborted', 'AbortError');
  }) as typeof fetch;
  await assert.rejects(
    withFetchDeadline(abortedFetch, 'https://example.test/aborted', { signal: controller.signal }, 1000,
      async (response) => { consumed += 1; return response.json(); }),
    (error: unknown) => {
      assert.equal((error as { name?: string }).name, 'AbortError');
      assert.equal(isFetchTimeoutError(error), false);
      return true;
    },
  );
  assert.equal(consumed, 0);
});

test('a success passes through untouched and the composed signal reaches fetch', async () => {
  let signalSeen: AbortSignal | null | undefined;
  const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
    signalSeen = init?.signal;
    return Response.json({ ok: true });
  }) as typeof fetch;
  const { response, data } = await fetchJsonWithTimeout<{ ok: boolean }>(fetchImpl, 'https://example.test/x', {}, 1000);
  assert.equal(response.status, 200);
  assert.deepEqual(data, { ok: true });
  assert.ok(signalSeen, 'a signal was bound');
  assert.equal(signalSeen!.aborted, false);
});

test('createTimeoutBudget flags the deadline and composes with a caller signal', async () => {
  const budget = createTimeoutBudget(5);
  assert.equal(budget.timedOut(), false);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(budget.timedOut(), true);
  assert.equal(budget.signal.aborted, true);
  budget.dispose();

  const caller = new AbortController();
  const composed = createTimeoutBudget(10_000, caller.signal);
  caller.abort();
  assert.equal(composed.signal.aborted, true);
  assert.equal(composed.timedOut(), false, 'a caller cancel is not our deadline');
  composed.dispose();
});

test('the client poll budget outlasts a single server-side Spotify call', () => {
  assert.ok(SPOTIFY_CLIENT_POLL_TIMEOUT_MS > SPOTIFY_REQUEST_TIMEOUT_MS);
});
