import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SpotifyApiClient,
  createSpotifyClient,
  normalizeSpotifyTrack,
  pickLargestImage,
} from './spotify-api.ts';
import { isFetchTimeoutError } from './fetch-timeout.ts';

interface Call {
  url: string;
  init: RequestInit;
}

/** Records every request and replays the queued responses in order. */
function transport(responses: (Response | Error)[]) {
  const calls: Call[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    const next = responses.shift();
    assert.ok(next, `unexpected request to ${String(input)}`);
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  return { calls, impl };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** A user-scoped client wired to the fake transport. */
function client(fetchImpl: typeof fetch, extra: Partial<ConstructorParameters<typeof SpotifyApiClient>[0]> = {}) {
  return new SpotifyApiClient({ accessToken: 'at', fetchImpl, ...extra });
}

test('normalizeSpotifyTrack keeps metadata and the largest cover, and rejects nameless tracks', () => {
  const track = normalizeSpotifyTrack({
    id: 'abc', name: '夜', duration_ms: 1234.6,
    artists: [{ name: 'A' }, { name: '' }, { name: 'B' }],
    album: { name: 'Album', images: [{ width: 64, url: 'small' }, { width: 640, url: 'big' }] },
  });
  assert.deepEqual(track, {
    id: 'abc', uri: 'spotify:track:abc', title: '夜', artist: 'A, B',
    album: 'Album', durationMs: 1235, coverUrl: 'big',
  });
  assert.equal(normalizeSpotifyTrack({ id: 'abc' }), null);
  assert.equal(normalizeSpotifyTrack(null), null);
  assert.equal(pickLargestImage([]), null);
});

test('a user-scoped client sends the bearer token it was created with', async () => {
  const t = transport([json(200, { id: 'trk1', name: '歌' })]);
  const track = await client(t.impl).fetchTrack('trk1');
  assert.ok(track.ok);
  assert.equal(track.ok && track.data?.name, '歌');
  // The token is the client's state, not a per-call argument.
  const headers = new Headers(t.calls[0].init.headers);
  assert.equal(headers.get('Authorization'), 'Bearer at');
  assert.equal(t.calls[0].url, 'https://api.spotify.com/v1/tracks/trk1');
});

test('request/requestUrl cover paged reads, so a paging link needs no second endpoint', async () => {
  const t = transport([
    json(200, { items: [{ track: { id: 'a' } }], total: 2, next: 'https://api.spotify.com/v1/playlists/p/tracks?offset=100' }),
    json(200, { items: [], total: 2, next: null }),
    json(401, { error: { status: 401 } }),
  ]);
  const spotify = client(t.impl);
  const first = await spotify.request<{ next: string | null }>('/playlists/p/tracks?limit=100');
  assert.ok(first.ok);
  // Spotify reports `next` as an absolute URL; the client must follow it as-is.
  const second = await spotify.requestUrl(String(first.ok && first.data.next));
  assert.ok(second.ok);
  assert.deepEqual(t.calls.map(call => call.url), [
    'https://api.spotify.com/v1/playlists/p/tracks?limit=100',
    'https://api.spotify.com/v1/playlists/p/tracks?offset=100',
  ]);

  const rejected = await spotify.request('/me');
  assert.ok(!rejected.ok);
  assert.equal(rejected.ok === false && rejected.failure.status, 401);
  // Every request is authenticated from the client's own state.
  assert.equal(new Headers(t.calls[0].init.headers).get('Authorization'), 'Bearer at');
});

test('withAccessToken swaps the session without touching the transport', async () => {
  const t = transport([json(200, { id: 'other' })]);
  const anonymous = createSpotifyClient({ fetchImpl: t.impl });
  assert.equal(anonymous.accessToken, undefined);
  await assert.rejects(anonymous.fetchTrack('x'), /spotify_access_token_missing/);

  const session = anonymous.withAccessToken('fresh');
  await session.fetchTrack('other');
  assert.equal(new Headers(t.calls[0].init.headers).get('Authorization'), 'Bearer fresh');
});

test('authorization code exchange posts form-encoded credentials and validates the body', async () => {
  const ok = transport([json(200, { access_token: 'at', refresh_token: 'rt', expires_in: 3600 })]);
  const exchanged = await createSpotifyClient({ fetchImpl: ok.impl }).exchangeAuthorizationCode('the-code');
  assert.ok(exchanged.ok);
  assert.deepEqual(exchanged.data, { access_token: 'at', refresh_token: 'rt', expires_in: 3600 });
  assert.equal(ok.calls[0].url, 'https://accounts.spotify.com/api/token');
  assert.equal(ok.calls[0].init.method, 'POST');
  const headers = ok.calls[0].init.headers as Record<string, string>;
  assert.match(headers.Authorization, /^Basic /);
  assert.equal(String((ok.calls[0].init.body as URLSearchParams).get('grant_type')), 'authorization_code');
  assert.equal(String((ok.calls[0].init.body as URLSearchParams).get('code')), 'the-code');

  const rejected = await createSpotifyClient({ fetchImpl: transport([json(400, { error: 'invalid_grant' })]).impl })
    .exchangeAuthorizationCode('the-code');
  assert.deepEqual(rejected, {
    ok: false, failure: { status: 400, body: { error: 'invalid_grant' }, retryAfter: null },
  });

  // A 2xx body without a token is a transport-level failure, never a silent empty token.
  const unusable = await createSpotifyClient({ fetchImpl: transport([json(200, {})]).impl })
    .exchangeAuthorizationCode('the-code');
  assert.ok(!unusable.ok);
  assert.equal(unusable.failure.unparsable, true);
});

test('the token endpoint can be pointed at injected credentials and redirect URI', async () => {
  const t = transport([json(200, { access_token: 'at', expires_in: 60 })]);
  const spotify = createSpotifyClient({
    fetchImpl: t.impl, clientId: 'id', clientSecret: 'secret', redirectUri: 'https://example.test/cb',
  });
  await spotify.exchangeAuthorizationCode('code');
  assert.equal(
    new Headers(t.calls[0].init.headers).get('Authorization'),
    `Basic ${Buffer.from('id:secret').toString('base64')}`,
  );
  assert.equal(String((t.calls[0].init.body as URLSearchParams).get('redirect_uri')), 'https://example.test/cb');
});

test('token refresh sends the refresh grant and never leaks the secret in the body', async () => {
  const t = transport([json(200, { access_token: 'new', expires_in: 3600 })]);
  const refreshed = await createSpotifyClient({ fetchImpl: t.impl }).refreshAccessToken('refresh-me');
  assert.ok(refreshed.ok);
  assert.equal(refreshed.data.access_token, 'new');
  const body = t.calls[0].init.body as URLSearchParams;
  assert.equal(body.get('grant_type'), 'refresh_token');
  assert.equal(body.get('refresh_token'), 'refresh-me');
});

test('profile fetch returns identity fields and null when Spotify rejects it', async () => {
  const profile = await client(transport([json(200, {
    id: 'legacy', account_id: 'acc', email: 'a@b.c', display_name: 'Name',
  })]).impl).fetchProfile();
  assert.deepEqual(profile, { id: 'legacy', account_id: 'acc', email: 'a@b.c', display_name: 'Name' });
  assert.equal(await client(transport([json(401, { error: 'nope' })]).impl).fetchProfile(), null);
});

test('now-playing reads classify idle, failed and playing states', async () => {
  for (const status of [202, 204]) {
    const idle = await client(transport([new Response(null, { status })]).impl).readNowPlaying();
    assert.deepEqual(idle, { kind: 'idle' });
  }

  const failed = await client(transport([
    new Response('{}', { status: 429, headers: { 'Retry-After': '7' } }),
  ]).impl).readNowPlaying();
  assert.equal(failed.kind, 'failed');
  assert.deepEqual(failed.kind === 'failed' && failed.failure, { status: 429, body: {}, retryAfter: '7' });

  const playing = await client(transport([json(200, {
    is_playing: true, progress_ms: 42.4, item: { id: 'trk', name: '歌', duration_ms: 1000 },
  })]).impl).readNowPlaying();
  assert.equal(playing.kind, 'playing');
  assert.deepEqual(playing.kind === 'playing' && {
    trackId: playing.trackId, isPlaying: playing.isPlaying, progressMs: playing.progressMs,
    durationMs: playing.durationMs, title: playing.track?.title,
  }, { trackId: 'trk', isPlaying: true, progressMs: 42, durationMs: 1000, title: '歌' });

  // 2xx with no item means "nothing playing", not an error.
  const empty = await client(transport([json(200, { is_playing: false, item: null })]).impl).readNowPlaying();
  assert.deepEqual(empty, { kind: 'idle' });

  // A 2xx body that is not an object is unusable state, not an idle session.
  const garbage = await client(transport([json(200, [])]).impl).readNowPlaying();
  assert.equal(garbage.kind, 'failed');
  assert.equal(garbage.kind === 'failed' && garbage.failure.unparsable, true);
});

test('playback commands are bodyless PUTs to the current session', async () => {
  const t = transport([new Response(null, { status: 204 })]);
  assert.deepEqual(await client(t.impl).sendPlaybackCommand('play'), { ok: true, data: null });
  assert.equal(t.calls[0].url, 'https://api.spotify.com/v1/me/player/play');
  assert.equal(t.calls[0].init.method, 'PUT');
  assert.equal(t.calls[0].init.body, undefined);

  const denied = await client(transport([json(403, { error: { reason: 'PREMIUM_REQUIRED' } })]).impl)
    .sendPlaybackCommand('pause');
  assert.ok(!denied.ok);
  assert.equal(denied.failure.status, 403);
});

test('seek rounds the position into the query string and reports upstream failures', async () => {
  const t = transport([new Response(null, { status: 204 })]);
  assert.deepEqual(await client(t.impl).seekPlaybackPosition(1234.6), { ok: true, data: null });
  assert.equal(t.calls[0].url, 'https://api.spotify.com/v1/me/player/seek?position_ms=1235');
  assert.equal(t.calls[0].init.method, 'PUT');

  const failed = await client(transport([new Response(null, { status: 500 })]).impl).seekPlaybackPosition(10);
  assert.ok(!failed.ok);
  assert.equal(failed.failure.status, 500);
});

test('search sends only the query the caller passes', async () => {
  const searched = transport([json(200, { tracks: { items: [{ id: 'trk2', name: '曲' }] } })]);
  const found = await client(searched.impl).searchTracks('track:夜 artist:AAA');
  assert.ok(found.ok);
  assert.equal(found.ok && found.data?.id, 'trk2');
  assert.equal(
    searched.calls[0].url,
    'https://api.spotify.com/v1/search?q=track%3A%E5%A4%9C%20artist%3AAAA&type=track&limit=1',
  );

  // An empty result page is "no match", not a failure.
  const none = await client(transport([json(200, { tracks: { items: [] } })]).impl).searchTracks('x');
  assert.deepEqual(none, { ok: true, data: null });
});

test('every Spotify call runs inside the shared deadline instead of hanging', async () => {
  // An upstream that accepts the connection and never answers rejected the
  // promise in #370; the client must give up on its own budget.
  const hang: typeof fetch = (async () => new Promise<Response>(() => {})) as typeof fetch;
  const deadline = (extra: Record<string, unknown> = {}) => createSpotifyClient({
    fetchImpl: hang, timeoutMs: 10, accessToken: 'at', ...extra,
  });
  await assert.rejects(deadline().readNowPlaying(), (error: unknown) => isFetchTimeoutError(error));
  await assert.rejects(deadline().sendPlaybackCommand('play'), (error: unknown) => isFetchTimeoutError(error));
  await assert.rejects(deadline().seekPlaybackPosition(10), (error: unknown) => isFetchTimeoutError(error));
  await assert.rejects(deadline().exchangeAuthorizationCode('code'), (error: unknown) => isFetchTimeoutError(error));
});

test('the deadline also covers reading the response body', async () => {
  // Headers arrived, the body never does — the same hang, one layer later.
  const stalledBody: typeof fetch = (async () => new Response(
    new ReadableStream({ start() { /* never enqueue */ } }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )) as typeof fetch;
  await assert.rejects(
    createSpotifyClient({ accessToken: 'at', fetchImpl: stalledBody, timeoutMs: 10 }).fetchTrack('trk'),
    (error: unknown) => isFetchTimeoutError(error),
  );
});

test('a caller cancel keeps its AbortError instead of becoming a timeout', async () => {
  const controller = new AbortController();
  const hang: typeof fetch = (async (_input, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  })) as typeof fetch;
  const run = createSpotifyClient({
    accessToken: 'at', fetchImpl: hang, timeoutMs: 5_000, signal: controller.signal,
  }).sendPlaybackCommand('pause');
  controller.abort();
  await assert.rejects(run, (error: unknown) => !isFetchTimeoutError(error));
});
