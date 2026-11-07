import test from 'node:test';
import assert from 'node:assert/strict';
import { createArtistProfileLookup } from './artist-profile-lookup.ts';

const MB = '0383dadf-2a4e-4d10-a46a-e9e041da8eb3';
const SP = '1dfeR4HaWDbWqFHLkxsg1d';
// Synthetic fixtures for deterministic tests, NOT live-source research results.
const mbFixture = { id: MB, name: 'Queen', type: 'Group', country: 'GB', aliases: [{ name: 'クイーン' }], disambiguation: 'UK rock group', relations: [
  { type: 'official homepage', 'target-type': 'url', url: { resource: 'https://queenonline.com' } },
  { type: 'youtube', 'target-type': 'url', url: { resource: 'javascript:bad' } },
  { type: 'wikidata', 'target-type': 'url', url: { resource: 'https://www.wikidata.org/wiki/Q15862' } },
] };
const claim = (value: unknown, rank = 'normal') => ({ rank, mainsnak: { datavalue: { value } } });
const wdFixture = { entities: { Q15862: { id: 'Q15862', type: 'item', labels: { en: { value: 'Queen' } }, descriptions: {
  en: { value: 'British rock band' }, ja: { value: 'イギリスのバンド' }, 'zh-hans': { value: '英国乐队' }, 'zh-hant': { value: '英國樂隊' },
}, aliases: { en: [{ value: 'Queen band' }] }, claims: { P31: [claim({ id: 'Q215380' })], P856: [claim('https://bad.local'), claim('https://queenonline.com')], P1902: [claim(SP)], P434: [claim(MB)] } } } };
const spFixture = { id: SP, type: 'artist', name: 'Queen', genres: ['rock'], images: [{ width: 640, url: 'https://i.scdn.co/image/public-art' }], external_urls: { spotify: 'https://evil.com' } };

test('exact MusicBrainz endpoint, identity validation, safe metadata and per-field source paths', async () => {
  const calls: string[] = [];
  const lookup = createArtistProfileLookup({ fetch: async (url, init) => {
    calls.push(String(url)); assert.equal(init?.redirect, 'error'); assert.equal(init?.cache, 'no-store');
    assert.ok(new Headers(init?.headers).get('User-Agent')?.includes('jp-lyrics-app'));
    assert.equal(new Headers(init?.headers).get('Authorization'), null);
    return Response.json(mbFixture);
  } });
  const p = await lookup('musicbrainz', MB);
  assert.equal(p.name, 'Queen'); assert.equal(p.kind, 'group'); assert.equal(p.country, 'GB');
  assert.deepEqual(p.aliases, ['クイーン']); assert.equal(p.links?.youtube, undefined);
  assert.equal(p.links?.website, 'https://queenonline.com'); assert.equal(p.bindings?.musicbrainzId, MB);
  assert.ok(p.sources?.[0].fields.includes('country')); assert.ok(p.sources?.[0].fields.includes('descriptions.en'));
  assert.deepEqual(calls, [`https://musicbrainz.org/ws/2/artist/${MB}?fmt=json&inc=aliases%2Burl-rels`]);
  // Related URLs are links only, not additional upstream requests/bindings.
  assert.equal(p.bindings?.wikidataId, undefined);
});
test('Wikidata exact item descriptions in all four locales; no guessed country/genre/image', async () => {
  const calls: string[] = [];
  const lookup = createArtistProfileLookup({ fetch: async (url) => { calls.push(String(url)); return Response.json(wdFixture); } });
  const p = await lookup('wikidata', 'Q15862');
  assert.equal(p.kind, 'group'); assert.equal(p.imageUrl, null); assert.equal(p.country, undefined); assert.deepEqual(p.genres, []);
  assert.deepEqual(p.descriptions, { 'zh-CN': '英国乐队', 'zh-TW': '英國樂隊', en: 'British rock band', ja: 'イギリスのバンド' });
  assert.equal(p.links?.website, 'https://queenonline.com'); assert.equal(p.links?.spotify, 'https://open.spotify.com/artist/'+SP);
  assert.equal(p.bindings?.spotifyArtistId, undefined);
  assert.deepEqual(calls, ['https://www.wikidata.org/wiki/Special:EntityData/Q15862.json']);
});
test('Spotify preview uses existing token, exact ID (not name equality), fixed public link, safe image', async () => {
  let tokens = 0;
  const lookup = createArtistProfileLookup({ getAccessToken: async (email) => { assert.equal(email, 'admin'); tokens++; return 'secret-token'; }, fetch: async (url, init) => {
    assert.equal(String(url), 'https://api.spotify.com/v1/artists/'+SP);
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer secret-token');
    return Response.json(spFixture);
  } });
  const profile = await lookup('spotify', SP, 'admin');
  assert.equal(profile.imageUrl, 'https://i.scdn.co/image/public-art'); assert.equal(profile.sourceUrl, 'https://open.spotify.com/artist/'+SP);
  assert.deepEqual(profile.genres, ['rock']); assert.equal(tokens, 1);
  assert.ok(!JSON.stringify(profile).includes('secret-token')); assert.ok(!JSON.stringify(profile).includes('admin'));
  await lookup('spotify', SP); // Public success is shareable without credentials.
  assert.equal(tokens, 1);
});
test('Spotify unavailable token has stable code, no request, and cannot poison another user', async () => {
  let calls = 0;
  const lookup = createArtistProfileLookup({ getAccessToken: async (email) => email === 'good' ? 'token' : null, fetch: async () => { calls++; return Response.json(spFixture); } });
  await assert.rejects(lookup('spotify', SP), /artist_profile_spotify_not_connected/);
  await assert.rejects(lookup('spotify', SP, 'bad'), /artist_profile_spotify_not_connected/);
  assert.equal(calls, 0);
  assert.equal((await lookup('spotify', SP, 'good')).name, 'Queen');
});
test('invalid IDs never reach network or token resolution', async () => {
  const lookup = createArtistProfileLookup({ fetch: async () => { throw new Error('must not fetch'); }, getAccessToken: async () => { throw new Error('must not resolve token'); } });
  for (const id of [MB+' ', 'https://example.com/'+MB, 'x/../../y']) await assert.rejects(lookup('musicbrainz', id), /artist_profile_invalid_id/);
});
test('positive public cache is cloned, bounded and expires; rate-limits distinct uncached IDs', async () => {
  let now = 0; let calls = 0;
  const lookup = createArtistProfileLookup({ now: () => now, successTtlMs: 3000, maxEntries: 1, fetch: async (url) => {
    calls++; return Response.json(String(url).includes('musicbrainz') ? mbFixture : wdFixture);
  } });
  const p = await lookup('musicbrainz', MB); p.aliases!.push('mutation');
  assert.deepEqual((await lookup('musicbrainz', MB)).aliases, ['クイーン']); assert.equal(calls, 1);
  await assert.rejects(lookup('musicbrainz', '00000000-0000-0000-0000-000000000000'), /artist_profile_lookup_rate_limited/);
  now += 1200; await lookup('wikidata', 'Q15862');
  await lookup('musicbrainz', MB); assert.equal(calls, 3);
  now += 4000; await lookup('musicbrainz', MB); assert.equal(calls, 4);
});
test('failure negative TTL and Retry-After throttle are bounded and respected', async () => {
  let now = 0; let calls = 0;
  const lookup = createArtistProfileLookup({ now: () => now, failureTtlMs: 2000, fetch: async () => { calls++; return new Response('', { status: 429, headers: { 'Retry-After': '10' } }); } });
  await assert.rejects(lookup('musicbrainz', MB), /artist_profile_lookup_rate_limited/);
  now = 3000;
  await assert.rejects(lookup('musicbrainz', MB), /artist_profile_lookup_rate_limited/);
  assert.equal(calls, 1);
  now = 10001; await assert.rejects(lookup('musicbrainz', MB), /artist_profile_lookup_rate_limited/); assert.equal(calls, 2);
});
test('concurrent exact-ID lookups deduplicate and never start a second request', async () => {
  let calls = 0;
  const lookup = createArtistProfileLookup({ fetch: async () => { calls++; await new Promise((r) => setTimeout(r, 5)); return Response.json(mbFixture); } });
  const p = await Promise.all([lookup('musicbrainz', MB), lookup('musicbrainz', MB)]);
  assert.equal(calls, 1); assert.deepEqual(p[0], p[1]);
});
for (const [label, response, code] of [
  ['404', () => new Response('', { status: 404 }), 'artist_profile_lookup_not_found'],
  ['redirect', () => new Response('', { status: 302, headers: { Location: 'http://127.0.0.1' } }), 'artist_profile_lookup_unavailable'],
  ['HTML', () => new Response('<html>'), 'artist_profile_lookup_unavailable'],
  ['mismatched identity', () => Response.json({ ...mbFixture, id: '00000000-0000-0000-0000-000000000000' }), 'artist_profile_lookup_not_found'],
  ['oversize', () => new Response('{}', { headers: { 'Content-Type': 'application/json', 'Content-Length': '1048577' } }), 'artist_profile_lookup_unavailable'],
  ['malformed JSON', () => new Response('{', { headers: { 'Content-Type': 'application/json' } }), 'artist_profile_lookup_unavailable'],
] as const) test(`untrusted upstream fixture: ${label}`, async () => {
  let calls = 0;
  const lookup = createArtistProfileLookup({ fetch: async () => { calls++; return response(); } });
  await assert.rejects(lookup('musicbrainz', MB), new RegExp(code));
  await assert.rejects(lookup('musicbrainz', MB), new RegExp(code)); assert.equal(calls, 1);
});
test('successful exact-ID cache survives transient failure without changing fetch time; bounded stale age and no stale 404', async () => {
  let now = 100000; let mode = 'ok'; let calls = 0;
  const lookup = createArtistProfileLookup({ now: () => now, successTtlMs: 2000, failureTtlMs: 2000, fetch: async () => {
    calls++;
    if (mode === 'offline') throw new Error('offline');
    return mode === '404' ? new Response('', { status: 404 }) : Response.json(mbFixture);
  } });
  const original = await lookup('musicbrainz', MB);
  now += 1000;
  assert.equal((await lookup('musicbrainz', MB)).updatedAt, original.updatedAt);
  mode = 'offline'; now += 2000;
  const [a, b] = await Promise.all([lookup('musicbrainz', MB), lookup('musicbrainz', MB)]);
  assert.equal(a.updatedAt, original.updatedAt); assert.deepEqual(a, b); assert.equal(calls, 2);
  now += 1000; assert.equal((await lookup('musicbrainz', MB)).updatedAt, original.updatedAt); assert.equal(calls, 2);
  now += 86400001; await assert.rejects(lookup('musicbrainz', MB), /artist_profile_lookup_unavailable/);
  now += 3000; mode = 'ok'; await lookup('musicbrainz', MB);
  now += 3000; mode = '404'; await assert.rejects(lookup('musicbrainz', MB), /artist_profile_lookup_not_found/);
});

test('hard timeout bounds a fetch that ignores AbortSignal', async () => {
  const lookup = createArtistProfileLookup({ timeoutMs: 5, fetch: async () => new Promise<Response>(() => {}) });
  await assert.rejects(lookup('musicbrainz', MB), /artist_profile_lookup_unavailable/);
});
