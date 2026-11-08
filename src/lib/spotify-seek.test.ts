import assert from 'node:assert/strict';
import test from 'node:test';
import { handleSpotifySeek } from './spotify-seek.ts';

const trackId = '4uLU6hMCjMI75M1A2tKUQC';

function request(body: unknown = { position_ms: 1000 }): Request {
  return new Request('http://localhost/api/spotify/seek', {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: 'jplrc_session=test' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function harness(responses: (Response | Error | 'hang')[] = [new Response(null, { status: 204 })]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const dependencies: {
    getAuthUser: () => Promise<{ email: string } | null>;
    getSpotifyTokenForUser: () => Promise<string | null>;
    fetch: typeof fetch;
    timeoutMs?: number;
  } = {
    getAuthUser: async () => ({ email: 'spotify:current-user' }),
    getSpotifyTokenForUser: async () => 'user-token',
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      const next = responses.shift();
      assert.ok(next, `unexpected Spotify request to ${String(input)}`);
      if (next === 'hang') return await new Promise<Response>(() => {});
      if (next instanceof Error) throw next;
      return next;
    }) as typeof fetch,
  };
  return { dependencies, calls };
}

async function expectError(response: Response, status: number, error: string) {
  assert.equal(response.status, status);
  assert.deepEqual(await response.json(), { error });
}

test('seek without a guard only issues the seek PUT', async () => {
  const h = harness();
  const response = await handleSpotifySeek(request({ position_ms: 5000 }), h.dependencies);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(h.calls.map(call => call.url), [
    'https://api.spotify.com/v1/me/player/seek?position_ms=5000',
  ]);
  assert.equal(h.calls[0].init?.method, 'PUT');
  assert.ok(h.calls[0].init?.signal instanceof AbortSignal, 'the seek carries a deadline signal');
});

test('seek is refused before any Spotify call when auth or the token is missing', async () => {
  const noUser = harness();
  noUser.dependencies.getAuthUser = async () => null;
  await expectError(await handleSpotifySeek(request(), noUser.dependencies), 401, 'Unauthorized');
  assert.equal(noUser.calls.length, 0);

  const noToken = harness();
  noToken.dependencies.getSpotifyTokenForUser = async () => null;
  await expectError(await handleSpotifySeek(request(), noToken.dependencies), 401, 'Spotify not connected');
  assert.equal(noToken.calls.length, 0);
});

test('invalid bodies are rejected without touching Spotify', async () => {
  const cases: [unknown, string][] = [
    [{}, 'invalid_position_ms'], [{ position_ms: -1 }, 'invalid_position_ms'],
    [{ position_ms: '10' }, 'invalid_position_ms'], [{ position_ms: Infinity }, 'invalid_position_ms'],
    [{ position_ms: 10, expected_track_id: 'spotify:track:1' }, 'invalid_track_id'],
    [{ position_ms: 10, expected_track_id: 42 }, 'invalid_track_id'],
    ['{', 'invalid_body'],
  ];
  for (const [body, error] of cases) {
    const h = harness();
    const response = await handleSpotifySeek(request(body), h.dependencies);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.deepEqual(await response.json(), { error });
    assert.equal(h.calls.length, 0);
  }
});

test('track guard blocks the seek when playback moved on', async () => {
  const h = harness([Response.json({ item: { id: 'other' } })]);
  await expectError(
    await handleSpotifySeek(request({ position_ms: 10, expected_track_id: trackId }), h.dependencies),
    409, 'track_changed',
  );
  assert.equal(h.calls.length, 1);
});

test('track guard treats an unreadable playback state as unavailable, not a mismatch', async () => {
  for (const response of [new Response('{}', { status: 500 }), Response.json([])]) {
    const h = harness([response]);
    await expectError(
      await handleSpotifySeek(request({ position_ms: 10, expected_track_id: trackId }), h.dependencies),
      503, 'playback_state_unavailable',
    );
    assert.equal(h.calls.length, 1);
  }
});

test('a successful guarded seek reads back the track for the receipt', async () => {
  const h = harness([
    Response.json({ item: { id: trackId } }),
    new Response(null, { status: 204 }),
    Response.json({ item: { id: trackId } }),
  ]);
  const response = await handleSpotifySeek(
    request({ position_ms: 10, expected_track_id: trackId }), h.dependencies,
  );
  assert.equal(response.status, 200);
  const body = await response.json() as { ok: boolean; track_id: string; seek_applied_at: number };
  assert.equal(body.ok, true);
  assert.equal(body.track_id, trackId);
  assert.ok(Number.isFinite(body.seek_applied_at));
  assert.deepEqual(h.calls.map(call => call.url.split('/me/player')[1]), [
    '/currently-playing', '/seek?position_ms=10', '/currently-playing',
  ]);
});

test('a failed read-back still returns the guard-verified track id', async () => {
  const h = harness([
    Response.json({ item: { id: trackId } }),
    new Response(null, { status: 204 }),
    new Response('{}', { status: 502 }),
  ]);
  const response = await handleSpotifySeek(
    request({ position_ms: 10, expected_track_id: trackId }), h.dependencies,
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json() as { track_id: string }).track_id, trackId);
});

test('upstream seek failures are reported with the Spotify status', async () => {
  const h = harness([new Response('{}', { status: 500 })]);
  const response = await handleSpotifySeek(request({ position_ms: 10 }), h.dependencies);
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'Seek failed' });
});

test('transport errors during seek surface as spotify_unavailable', async () => {
  const h = harness([new Error('socket hang up')]);
  await expectError(await handleSpotifySeek(request({ position_ms: 10 }), h.dependencies), 503, 'spotify_unavailable');
});

test('a hung Spotify call becomes a retryable spotify_timeout instead of pending forever', async () => {
  const h = harness(['hang']);
  h.dependencies.timeoutMs = 10;
  const started = Date.now();
  await expectError(await handleSpotifySeek(request({ position_ms: 10 }), h.dependencies), 503, 'spotify_timeout');
  assert.ok(Date.now() - started < 2000, 'the request was abandoned, not left pending');
});

test('a hung track guard answers spotify_timeout rather than a false mismatch', async () => {
  const h = harness(['hang']);
  h.dependencies.timeoutMs = 10;
  await expectError(
    await handleSpotifySeek(request({ position_ms: 10, expected_track_id: trackId }), h.dependencies),
    503, 'spotify_timeout',
  );
});
