import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleSpotifyPlayback } from './spotify-playback.ts';

const trackId = '4uLU6hMCjMI75M1A2tKUQC';

function request(body: unknown = { action: 'play' }): Request {
  return new Request('http://localhost/api/spotify/playback', {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: 'jplrc_session=test' },
    body: JSON.stringify(body),
  });
}

function harness(responses: (Response | Error)[] = [new Response(null, { status: 204 })]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const authRequests: Request[] = [];
  const tokenEmails: string[] = [];
  const dependencies = {
    getAuthUser: async (input: Request): Promise<{ email: string } | null> => {
      authRequests.push(input);
      return { email: 'spotify:current-user' };
    },
    getSpotifyTokenForUser: async (email: string): Promise<string | null> => {
      tokenEmails.push(email);
      return 'user-token';
    },
    fetch: (async (input, init) => {
      calls.push({ url: String(input), init });
      const response = responses.shift();
      if (response instanceof Error) throw response;
      assert.ok(response, 'unexpected Spotify request');
      return response;
    }) as typeof fetch,
  };
  return { dependencies, calls, authRequests, tokenEmails };
}

async function expectError(response: Response, status: number, error: string) {
  assert.equal(response.status, status);
  assert.deepEqual(await response.json(), { error });
  assert.match(error, /^[a-z_]+$/);
}

test('auth uses the actual request and token lookup uses only its authenticated email', async () => {
  const h = harness();
  const input = request();
  const response = await handleSpotifyPlayback(input, h.dependencies);
  assert.equal(h.authRequests[0], input);
  assert.deepEqual(h.tokenEmails, ['spotify:current-user']);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});

test('unauthenticated requests never parse a body, refresh a token or call Spotify', async () => {
  const h = harness();
  h.dependencies.getAuthUser = async () => null;
  const input = request();
  input.json = async () => { throw new Error('must not parse'); };
  await expectError(await handleSpotifyPlayback(input, h.dependencies), 401, 'unauthorized');
  assert.deepEqual(h.tokenEmails, []);
  assert.deepEqual(h.calls, []);
});

test('auth errors fail closed without leaking details', async () => {
  const h = harness();
  h.dependencies.getAuthUser = async () => { throw new Error('private db error'); };
  await expectError(await handleSpotifyPlayback(request(), h.dependencies), 503, 'auth_unavailable');
  assert.equal(h.calls.length, 0);
  assert.equal(h.tokenEmails.length, 0);
});

const invalidBodies: [unknown, string][] = [
  [null, 'invalid_body'], [[], 'invalid_body'], ['play', 'invalid_body'],
  [{}, 'invalid_action'], [{ action: 'stop' }, 'invalid_action'],
  [{ action: 'PLAY' }, 'invalid_action'], [{ action: null }, 'invalid_action'],
  [{ action: 1 }, 'invalid_action'],
  [{ action: 'play', uris: ['spotify:track:other'] }, 'invalid_body'],
  [{ action: 'play', device_id: 'another-device' }, 'invalid_body'],
  [{ action: 'play', email: 'other-user' }, 'invalid_body'],
  [{ action: 'play', expected_track_id: null }, 'invalid_track_id'],
  [{ action: 'play', expected_track_id: '' }, 'invalid_track_id'],
  [{ action: 'play', expected_track_id: 123 }, 'invalid_track_id'],
  [{ action: 'play', expected_track_id: 'spotify:track:123' }, 'invalid_track_id'],
  [{ action: 'play', expected_track_id: ' abc' }, 'invalid_track_id'],
  [{ action: 'play', expected_track_id: 'a'.repeat(129) }, 'invalid_track_id'],
];
for (const [body, error] of invalidBodies) {
  test(`invalid input ${JSON.stringify(body)} is rejected before token refresh or fetch`, async () => {
    const h = harness();
    await expectError(await handleSpotifyPlayback(request(body), h.dependencies), 400, error);
    assert.deepEqual(h.tokenEmails, []);
    assert.deepEqual(h.calls, []);
  });
}

test('malformed JSON returns a clean invalid_body response', async () => {
  const h = harness();
  const input = new Request('http://localhost/api/spotify/playback', { method: 'PUT', body: '{' });
  await expectError(await handleSpotifyPlayback(input, h.dependencies), 400, 'invalid_body');
  assert.equal(h.tokenEmails.length, 0);
  assert.equal(h.calls.length, 0);
});

test('disconnected Spotify returns 401 without playback requests', async () => {
  const h = harness();
  h.dependencies.getSpotifyTokenForUser = async () => null;
  await expectError(await handleSpotifyPlayback(request(), h.dependencies), 401, 'spotify_not_connected');
  assert.equal(h.calls.length, 0);
});

test('token refresh network errors are caught', async () => {
  const h = harness();
  h.dependencies.getSpotifyTokenForUser = async () => { throw new Error('token secret'); };
  await expectError(await handleSpotifyPlayback(request(), h.dependencies), 503, 'spotify_unavailable');
  assert.equal(h.calls.length, 0);
});

for (const action of ['play', 'pause']) {
  test(`${action} sends only a bodyless PUT for current session, with no device or URI`, async () => {
    const h = harness();
    const response = await handleSpotifyPlayback(request({ action }), h.dependencies);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.deepEqual(h.calls, [{
      url: `https://api.spotify.com/v1/me/player/${action}`,
      init: { method: 'PUT', headers: { Authorization: 'Bearer user-token' }, cache: 'no-store' },
    }]);
  });

  test(`${action} checks expected track before mutating and does not require a readback`, async () => {
    const h = harness([Response.json({ item: { id: trackId } }), new Response(null, { status: 204 })]);
    const response = await handleSpotifyPlayback(request({ action, expected_track_id: trackId }), h.dependencies);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(h.calls.length, 2);
    assert.deepEqual(h.calls[0], {
      url: 'https://api.spotify.com/v1/me/player/currently-playing',
      init: { headers: { Authorization: 'Bearer user-token' }, cache: 'no-store' },
    });
    assert.equal(h.calls[1].url, `https://api.spotify.com/v1/me/player/${action}`);
    assert.equal(h.calls[1].init?.body, undefined);
  });
}

for (const playback of [{ item: { id: 'otherTrack' } }, { item: null }, {}]) {
  test(`track guard refuses ${JSON.stringify(playback)} without mutation`, async () => {
    const h = harness([Response.json(playback)]);
    await expectError(await handleSpotifyPlayback(request({ action: 'pause', expected_track_id: trackId }), h.dependencies), 409, 'track_changed');
    assert.equal(h.calls.length, 1);
  });
}
for (const status of [202, 204]) {
  test(`track guard refuses empty ${status} playback without mutation`, async () => {
    const h = harness([new Response(null, { status })]);
    await expectError(await handleSpotifyPlayback(request({ action: 'play', expected_track_id: trackId }), h.dependencies), 409, 'track_changed');
    assert.equal(h.calls.length, 1);
  });
}

for (const upstream of [new Error('network secret'), new Response('{'), Response.json(null), Response.json([])]) {
  test(`unavailable or malformed playback state fails closed (${String(upstream)})`, async () => {
    const h = harness([upstream]);
    await expectError(await handleSpotifyPlayback(request({ action: 'play', expected_track_id: trackId }), h.dependencies), 503, 'playback_state_unavailable');
    assert.equal(h.calls.length, 1);
  });
}

const upstreamFailures: [number, unknown, number, string][] = [
  [401, { message: 'private expired token' }, 401, 'spotify_unauthorized'],
  [403, { reason: 'PREMIUM_REQUIRED', message: 'private account' }, 403, 'premium_required'],
  [403, { message: 'Player command failed: Premium required' }, 403, 'premium_required'],
  [403, { reason: 'INSUFFICIENT_SCOPE' }, 403, 'insufficient_scope'],
  [403, { message: 'Insufficient client scope' }, 403, 'insufficient_scope'],
  [403, { message: 'private account restriction' }, 403, 'playback_forbidden'],
  [404, { message: 'private device' }, 404, 'no_active_device'],
  [429, { message: 'private quota' }, 429, 'rate_limited'],
  [500, { message: 'private stack' }, 503, 'spotify_unavailable'],
  [502, { message: 'private stack' }, 503, 'spotify_unavailable'],
  [503, { message: 'private stack' }, 503, 'spotify_unavailable'],
  [400, { message: 'private bad request' }, 502, 'playback_failed'],
];
for (const stage of ['guard', 'mutation']) {
  for (const [upstreamStatus, errorBody, status, code] of upstreamFailures) {
    test(`${stage} maps Spotify ${upstreamStatus} to ${code} without leaking upstream details`, async () => {
      const h = harness([Response.json({ error: errorBody }, { status: upstreamStatus })]);
      const body = stage === 'guard' ? { action: 'play', expected_track_id: trackId } : { action: 'pause' };
      await expectError(await handleSpotifyPlayback(request(body), h.dependencies), status, code);
      assert.equal(h.calls.length, 1);
    });
  }
}

test('non-JSON Spotify 403 uses a safe fallback', async () => {
  const h = harness([new Response('private proxy error', { status: 403 })]);
  await expectError(await handleSpotifyPlayback(request(), h.dependencies), 403, 'playback_forbidden');
});

test('mutation network errors return a stable 503 code', async () => {
  const h = harness([new Error('network secret')]);
  await expectError(await handleSpotifyPlayback(request(), h.dependencies), 503, 'spotify_unavailable');
});

for (const retryAfter of ['30', 'not-a-delay']) {
  test(`rate limit only forwards valid Retry-After (${retryAfter})`, async () => {
    const h = harness([new Response(null, { status: 429, headers: { 'Retry-After': retryAfter } })]);
    const response = await handleSpotifyPlayback(request(), h.dependencies);
    await expectError(response, 429, 'rate_limited');
    assert.equal(response.headers.get('Retry-After'), retryAfter === '30' ? '30' : null);
  });
}
