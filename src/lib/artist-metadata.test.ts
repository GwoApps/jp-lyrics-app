import test from 'node:test';
import assert from 'node:assert/strict';
import { createArtistMetadataResolver } from './artist-metadata.ts';

const exact = { id: 42, name: 'YOASOBI', picture_xl: 'https://cdn-images.dzcdn.net/images/artist/abc/1000x1000.jpg', link: 'https://www.deezer.com/artist/42' };
const response = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });

test('Deezer exact-only, safe avatar/source, never a song cover or synthesized biography', async () => {
  const resolve = createArtistMetadataResolver({ fetch: async () => response({ data: [exact] }) });
  const result = await resolve(' yoasobi ');
  assert.equal(result.name, 'YOASOBI');
  assert.equal(result.source, 'Deezer');
  assert.equal(result.imageUrl, exact.picture_xl);
  assert.equal(result.description, null);
  assert.deepEqual(result.genres, []);
  assert.equal(result.sourceUrl, exact.link);
});

test('fuzzy matches and duplicate exact names are rejected regardless of fan counts', async () => {
  for (const data of [[{ ...exact, name: 'YOASOBI tribute' }], [exact, { ...exact, id: 99, nb_fan: 999999999 }]]) {
    const resolve = createArtistMetadataResolver({ fetch: async () => response({ data }) });
    assert.equal((await resolve('YOASOBI')).source, null);
  }
});

test('known HTTPS image and source hosts only; artist identity validates source id', async () => {
  for (const picture_xl of ['http://cdn-images.dzcdn.net/images/artist/x.jpg', 'https://evil.test/a.jpg', 'https://cdn-images.dzcdn.net.evil.test/a.jpg', 'https://cdn-images.dzcdn.net/images/cover/abc.jpg']) {
    const resolve = createArtistMetadataResolver({ fetch: async () => response({ data: [{ ...exact, picture_xl, link: 'https://evil.test/artist/42' }] }) });
    const result = await resolve('YOASOBI');
    assert.equal(result.imageUrl, null);
    assert.equal(result.sourceUrl, null);
  }
});

test('bounded cache, TTL, singleflight and short neutral retry caching', async () => {
  let calls = 0;
  let now = 0;
  const resolve = createArtistMetadataResolver({
    fetch: async () => { calls++; await new Promise((r) => setTimeout(r, 5)); return response({ data: [exact] }); },
    now: () => now, maxEntries: 2, successTtlMs: 100, failureTtlMs: 10,
  });
  await Promise.all([resolve('YOASOBI'), resolve('yoasobi'), resolve(' YOASOBI ')]);
  assert.equal(calls, 1);
  now = 101;
  await resolve('YOASOBI');
  assert.equal(calls, 2);
  await resolve('Missing');
  await resolve('Missing');
  assert.equal(calls, 3);
  now = 112;
  await resolve('Missing');
  assert.equal(calls, 4);
  await resolve('Third');
  await resolve('YOASOBI');
  assert.equal(calls, 6);
});

test('upstream network, invalid JSON, HTTP errors and ignored-abort hangs resolve neutral', async () => {
  const fetchers: Array<typeof fetch> = [
    async () => { throw new Error('offline'); },
    async () => new Response('not json'),
    async () => new Response('', { status: 429 }),
    async () => new Promise(() => {}),
  ];
  for (const fetch of fetchers) {
    const resolve = createArtistMetadataResolver({ fetch, timeoutMs: 15 });
    assert.equal((await resolve('YOASOBI')).source, null);
  }
});

test('Spotify track artist identity verifies avatar and genres, separate from anonymous neutral cache', async () => {
  const calls: string[] = [];
  const resolve = createArtistMetadataResolver({
    getAccessToken: async (email) => email === 'me' ? 'token' : null,
    fetch: async (input, options) => {
      const url = String(input); calls.push(url);
      if (url.includes('api.spotify.com')) assert.equal(new Headers(options?.headers).get('Authorization'), 'Bearer token');
      if (url.includes('/tracks/')) return response({ artists: [{ id: 'abc123', name: 'HACHI' }] });
      if (url.includes('/artists/')) return response({ id: 'abc123', name: 'HACHI', images: [{ url: 'https://i.scdn.co/image/abc', width: 640 }], genres: ['j-pop'], external_urls: { spotify: 'https://open.spotify.com/artist/abc123' } });
      return response({ data: [] });
    },
  });
  assert.equal((await resolve('HACHI')).source, null);
  const songs = [{ spotify_track_id: 'track123' }];
  const result = await resolve('HACHI', songs, 'me');
  assert.equal(result.source, 'Spotify');
  assert.deepEqual(result.genres, ['j-pop']);
  assert.equal(result.imageUrl, 'https://i.scdn.co/image/abc');
  assert.equal((await resolve('HACHI')).source, null);
  assert.equal((await resolve('HACHI', songs, 'me')).source, 'Spotify');
  assert.equal(calls.filter((url) => url.includes('/artists/')).length, 1);
  assert.equal(calls.filter((url) => url.includes('/tracks/')).length, 1);
});

test('Spotify fuzzy artist names are rejected', async () => {
  const resolve = createArtistMetadataResolver({
    getAccessToken: async () => 'token',
    fetch: async (input) => String(input).includes('/tracks/')
      ? response({ artists: [{ id: '1', name: 'A tribute' }] })
      : response({ data: [] }),
  });
  assert.equal((await resolve('A', [{ spotify_track_id: 'track' }], 'me')).source, null);
});

test('Spotify conflicting exact-name ids are rejected and unsafe image/source URLs are stripped', async () => {
  let artistCalls = 0;
  const ambiguous = createArtistMetadataResolver({
    getAccessToken: async () => 'token',
    fetch: async (input) => {
      const url = String(input);
      if (url.includes('/artists/')) artistCalls++;
      return url.includes('/tracks/') ? response({ artists: [{ id: url.endsWith('/one') ? 'one' : 'two', name: 'A' }] }) : response({ data: [] });
    },
  });
  assert.equal((await ambiguous('A', [{ spotify_track_id: 'one' }, { spotify_track_id: 'two' }], 'me')).source, null);
  assert.equal(artistCalls, 0);
  const unsafe = createArtistMetadataResolver({
    getAccessToken: async () => 'token',
    fetch: async (input) => String(input).includes('/tracks/')
      ? response({ artists: [{ id: 'one', name: 'A' }] })
      : response({ id: 'one', name: 'A', images: [{ url: 'https://evil.test/a.jpg' }], external_urls: { spotify: 'https://open.spotify.com/artist/not-one' } }),
  });
  const result = await unsafe('A', [{ spotify_track_id: 'one' }], 'me');
  assert.equal(result.source, 'Spotify');
  assert.equal(result.imageUrl, null);
  assert.equal(result.sourceUrl, null);
});

test('paginated Deezer search is not treated as evidence of unique identity', async () => {
  const resolve = createArtistMetadataResolver({ fetch: async () => response({ data: [exact], next: 'https://api.deezer.com/search/artist?index=25' }) });
  assert.equal((await resolve('YOASOBI')).source, null);
});

test('Spotify 429 honors Retry-After for repeated navigation without poisoning other users', async () => {
  let now = 0;
  let calls = 0;
  const resolve = createArtistMetadataResolver({
    now: () => now, failureTtlMs: 10,
    getAccessToken: async (email) => email,
    fetch: async (input, options) => {
      if (!String(input).includes('api.spotify.com')) return response({ data: [] });
      calls++;
      if (new Headers(options?.headers).get('Authorization') === 'Bearer throttled') {
        return new Response('', { status: 429, headers: { 'Retry-After': '60' } });
      }
      return String(input).includes('/tracks/')
        ? response({ artists: [{ id: 'A1', name: 'A' }] })
        : response({ id: 'A1', name: 'A', images: [], external_urls: {} });
    },
  });
  const songs = [{ spotify_track_id: 'T1' }];
  await resolve('A', songs, 'throttled');
  await resolve('A', songs, 'throttled');
  now = 59_999;
  await resolve('A', songs, 'throttled');
  assert.equal(calls, 1);
  now = 60_001;
  await resolve('A', songs, 'throttled');
  assert.equal(calls, 2);
  assert.equal((await resolve('A', songs, 'healthy')).source, 'Spotify');
  assert.equal(calls, 4);
});

test('a concurrent track 429 prevents subsequent artist enrichment during its cooldown', async () => {
  let artistCalls = 0;
  const resolve = createArtistMetadataResolver({
    getAccessToken: async () => 'token',
    fetch: async (input) => {
      const url = String(input);
      if (url.endsWith('/good')) return response({ artists: [{ id: 'A1', name: 'A' }] });
      if (url.endsWith('/throttled')) return new Response('', { status: 429, headers: { 'Retry-After': '60' } });
      if (url.includes('/artists/')) { artistCalls++; return response({ id: 'A1', name: 'A', images: [] }); }
      return response({ data: [] });
    },
  });
  const result = await resolve('A', [{ spotify_track_id: 'good' }, { spotify_track_id: 'throttled' }], 'me');
  assert.equal(artistCalls, 0);
  assert.equal(result.source, null);
});

test('Spotify artist errors have a short user-scoped cooldown and retry after expiry', async () => {
  let now = 0;
  let artistCalls = 0;
  const resolve = createArtistMetadataResolver({
    now: () => now, failureTtlMs: 50,
    getAccessToken: async () => 'token',
    fetch: async (input) => {
      if (String(input).includes('/tracks/')) return response({ artists: [{ id: 'A1', name: 'A' }] });
      if (String(input).includes('api.spotify.com')) { artistCalls++; return new Response('', { status: 503 }); }
      return response({ data: [] });
    },
  });
  await resolve('A', [{ spotify_track_id: 'T1' }], 'me');
  await resolve('A', [{ spotify_track_id: 'T1' }], 'me');
  assert.equal(artistCalls, 1);
  now = 51;
  await resolve('A', [{ spotify_track_id: 'T1' }], 'me');
  assert.equal(artistCalls, 2);
});

test('token lookup failure/timeout falls back to public metadata and empty names make no requests', async () => {
  let requests = 0;
  const resolve = createArtistMetadataResolver({
    timeoutMs: 10,
    getAccessToken: async () => new Promise(() => {}),
    fetch: async () => { requests++; return response({ data: [exact] }); },
  });
  assert.equal((await resolve('  ')).source, null);
  assert.equal(requests, 0);
  assert.equal((await resolve('YOASOBI', [{ spotify_track_id: '../bad' }], 'me')).source, 'Deezer');
});
