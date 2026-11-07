import test from 'node:test';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { createTestDb, createSongsTable } from './test-db.ts';
import * as schema from './schema.ts';
import { getArtistProfileOverride, setArtistProfileOverride, deleteArtistProfileOverride } from './artist-profile-store.ts';
import { createArtistProfileAdminHandlers } from './artist-profile-admin.ts';
import { createManagedArtistProfileResolver, mergeArtistProfile } from './artist-profile-managed.ts';
import { createArtistApiHandlers } from './artist-library.ts';
import { emptyManagedArtistProfile } from './artist-profile-lookup.ts';
import type { ArtistProfile } from './artists.ts';
import { ArtistProfileError } from './artist-profile-validation.ts';
const MB = '0383dadf-2a4e-4d10-a46a-e9e041da8eb3';
const req = (body?: unknown) => new Request('https://example.com/api/admin/artists/Queen', { method: body === undefined ? 'GET' : 'PUT', ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
async function fixture(t: Parameters<typeof createTestDb>[0]) {
  const fixture = createTestDb(t, 'artist-profile', schema);
  await fixture.client.execute('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  return fixture;
}

test('isolated SQLite persistence: canonical key, replace not patch, timestamp, independent connection readback and idempotent reset', async (t) => {
  const f = await fixture(t);
  const input = { aliases: ['A'], country: 'JP', descriptions: { en: 'Description' } };
  const saved = await setArtistProfileOverride(f.db, ' Queen ', input, new Date('2026-11-02T00:00:00.000Z'));
  assert.deepEqual(saved, { ...input, updatedAt: '2026-11-02T00:00:00.000Z' });
  const independent = f.open();
  assert.deepEqual(await getArtistProfileOverride(independent.db, 'QUEEN'), saved);
  await setArtistProfileOverride(f.db, 'Queen', { country: null });
  assert.equal((await getArtistProfileOverride(independent.db, 'queen'))?.country, null);
  assert.equal((await getArtistProfileOverride(independent.db, 'queen'))?.aliases, undefined);
  await deleteArtistProfileOverride(f.db, 'Queen');
  assert.equal(await getArtistProfileOverride(independent.db, 'queen'), null);
  await deleteArtistProfileOverride(f.db, 'QUEEN');
  assert.equal((await f.client.execute('SELECT count(*) AS n FROM settings')).rows[0].n, 0);
});
test('stored corrupt/unknown/unsafe/oversized records fail closed, never enable namesake fallback, and return a stable admin 500', async (t) => {
  const { db, client } = await fixture(t);
  let automatic = 0, lookups = 0;
  const getOverride = (name: string) => getArtistProfileOverride(db, name);
  const lookup = async () => { lookups++; return emptyManagedArtistProfile('wrong identity'); };
  const resolve = createManagedArtistProfileResolver({ getOverride, lookup, automatic: async () => { automatic++; return emptyManagedArtistProfile('wrong namesake'); } });
  const h = createArtistProfileAdminHandlers({ getUser: async () => ({ isAdmin: true }), getOverride, setOverride: (name, value) => setArtistProfileOverride(db, name, value), deleteOverride: (name) => deleteArtistProfileOverride(db, name), lookup });
  assert.equal(await getOverride('Queen'), null); // Only a genuinely missing row is absent.
  for (const value of ['{', 'null', '{"credentials":"secret"}', JSON.stringify({ musicbrainzId: MB, imageUrl: 'https://localhost/x' }), 'x'.repeat(33000)]) {
    await client.execute({ sql: 'INSERT OR REPLACE INTO settings(key,value) VALUES (?,?)', args: ['artist_profile:queen', value] });
    await assert.rejects(getOverride('Queen'), (error: unknown) => error instanceof ArtistProfileError && error.message === 'artist_profile_load_failed' && error.status === 500);
    const profile = await resolve('Queen');
    assert.equal(profile.name, 'Queen'); assert.equal(profile.source, null); assert.equal(profile.imageUrl, null);
    const response = await h.get(req(), 'Queen');
    assert.equal(response.status, 500); assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
    assert.deepEqual(await response.json(), { error: 'artist_profile_load_failed' });
  }
  assert.equal(automatic, 0); assert.equal(lookups, 0);
  await assert.rejects(setArtistProfileOverride(db, 'Queen', { country: 'ZZ' }), /artist_profile_invalid_override/);
});
test('admin ACL on every verb checks auth before malformed body, KV access, or upstream call', async () => {
  for (const user of [null, { isAdmin: false }]) {
    let accessed = false;
    const forbidden = async (): Promise<never> => { accessed = true; throw new Error('forbidden access'); };
    const h = createArtistProfileAdminHandlers({ getUser: async () => user, getOverride: forbidden, setOverride: forbidden, deleteOverride: forbidden, lookup: forbidden });
    for (const call of [() => h.get(req(), 'Queen'), () => h.put(new Request('https://example.com', { method: 'PUT', body: '{' }), 'Queen'), () => h.delete(req(), 'Queen'), () => h.lookup(req({ source: 'wikidata', id: 'Q1' }))]) {
      const result = await call(); assert.equal(result.status, 403); assert.equal(result.headers.get('Cache-Control'), 'private, no-store');
    }
    assert.equal(accessed, false);
  }
});
test('admin same-origin guard precedes parsing and all mutation/provider side effects, with auth first', async () => {
  let writes = 0, deletes = 0, lookups = 0, auth = 0;
  let admin = true;
  const h = createArtistProfileAdminHandlers({ getUser: async () => { auth++; return { isAdmin: admin }; }, getOverride: async () => null, setOverride: async (_name, value) => { writes++; return value; }, deleteOverride: async () => { deletes++; }, lookup: async () => { lookups++; return emptyManagedArtistProfile('Queen'); } });
  const request = (method: string, origin?: string, body?: string, host?: string) => new Request('https://example.com:8443/api/admin/artists/Queen', {
    method, headers: { 'Content-Type': 'text/plain', ...(origin === undefined ? {} : { Origin: origin }), ...(host ? { Host: host } : {}) }, ...(body === undefined ? {} : { body }),
  });
  for (const origin of ['https://evil.example', 'null', 'not-a-url', 'https://example.com', 'https://example.com:9443']) {
    const put = request('PUT', origin, '{', 'evil.example');
    const lookup = request('POST', origin, '{');
    for (const response of [await h.put(put, 'Queen'), await h.delete(request('DELETE', origin), 'Queen'), await h.lookup(lookup)]) {
      assert.equal(response.status, 403); assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
      assert.deepEqual(await response.json(), { error: 'forbidden' });
    }
    assert.equal(put.bodyUsed, false); assert.equal(lookup.bodyUsed, false);
  }
  assert.equal(writes, 0); assert.equal(deletes, 0); assert.equal(lookups, 0);
  // Plain Request has no Host/nextUrl: its actual URL, including port, is authoritative.
  for (const origin of ['https://example.com:8443', undefined]) {
    assert.equal((await h.put(request('PUT', origin, '{"override":{}}', 'internal:3000'), 'Queen')).status, 200);
    assert.equal((await h.delete(request('DELETE', origin), 'Queen')).status, 200);
    assert.equal((await h.lookup(request('POST', origin, '{"source":"wikidata","id":"Q1"}'))).status, 200);
  }
  assert.equal(writes, 2); assert.equal(deletes, 2); assert.equal(lookups, 2);
  // A real NextRequest retains the public HTTP Host even if its URL was rewritten.
  const publicRequest = () => Object.assign(request('PUT', 'https://public.example:8443', '{"override":{}}', 'public.example:8443'), { nextUrl: new URL('https://public.example:8443/api/admin/artists/Queen') });
  assert.equal((await h.put(publicRequest(), 'Queen')).status, 200);
  const forged = Object.assign(request('PUT', 'https://example.com:8443', '{"override":{}}'), { nextUrl: new URL('https://public.example:8443') });
  assert.equal((await h.put(forged, 'Queen')).status, 403);
  admin = false;
  const unauthorized = publicRequest();
  Object.defineProperty(unauthorized, 'nextUrl', { get: () => { throw new Error('origin checked before auth'); } });
  assert.equal((await h.put(unauthorized, 'Queen')).status, 403);
  assert.equal(writes, 3); assert.equal(deletes, 2); assert.equal(lookups, 2);
  assert.equal(auth, 24);
});

test('real NextRequest origin checks retain HTTP authority despite loopback URL normalization', async () => {
  const { NextRequest } = createRequire(import.meta.url)('next/server') as typeof import('next/server');
  let writes = 0;
  const h = createArtistProfileAdminHandlers({ getUser: async () => ({ isAdmin: true }), getOverride: async () => null, setOverride: async (_name, value) => { writes++; return value; }, deleteOverride: async () => {}, lookup: async () => emptyManagedArtistProfile('Queen') });
  for (const [origin, status] of [['http://127.0.0.1:3100', 200], ['http://localhost:3100', 403], ['http://127.0.0.1:3101', 403], ['https://foreign.invalid', 403]] as const) {
    const request = new NextRequest('http://127.0.0.1:3100/api/admin/artists/Queen', { method: 'PUT', headers: { Host: '127.0.0.1:3100', Origin: origin }, body: '{"override":{}}' });
    assert.equal(request.nextUrl.host, 'localhost:3100');
    assert.equal((await h.put(request, 'Queen')).status, status);
  }
  assert.equal(writes, 1);
});

test('admin exact preview is read-only; explicit confirmation then persisted GET/PUT/DELETE and public resolver readback', async (t) => {
  const { db } = await fixture(t);
  let upstreams = 0;
  const publicProfile: ArtistProfile = { ...emptyManagedArtistProfile('Queen canonical'), country: 'GB', source: 'MusicBrainz', sourceUrl: `https://musicbrainz.org/artist/${MB}`, bindings: { musicbrainzId: MB } };
  const lookup = async (source: string, id: string) => { upstreams++; assert.equal(source, 'musicbrainz'); assert.equal(id, MB); return publicProfile; };
  const h = createArtistProfileAdminHandlers({ getUser: async () => ({ isAdmin: true, email: 'admin' }), getOverride: (name) => getArtistProfileOverride(db, name), setOverride: (name, input) => setArtistProfileOverride(db, name, input), deleteOverride: (name) => deleteArtistProfileOverride(db, name), lookup });
  const preview = await h.lookup(req({ source: 'musicbrainz', id: MB }));
  assert.equal(preview.status, 200); assert.equal((await preview.json()).profile.name, 'Queen canonical');
  assert.equal(await getArtistProfileOverride(db, 'Queen'), null);
  const override = { musicbrainzId: MB, descriptions: { en: 'Corrected', ja: '訂正' }, imageUrl: null, genres: [], aliases: ['クイーン'], sourceUrl: 'https://queenonline.com' };
  const denied = await h.put(req({ override }), 'Queen');
  assert.equal(denied.status, 400); assert.equal((await denied.json()).error, 'artist_profile_confirmation_required');
  assert.equal(await getArtistProfileOverride(db, 'Queen'), null);
  const saved = await h.put(req({ override, confirmIdentity: true }), 'Queen');
  assert.equal(saved.status, 200);
  const read = await h.get(req(), 'QUEEN'); const stored = (await read.json()).override;
  assert.deepEqual(stored.descriptions, override.descriptions); assert.ok(stored.updatedAt);
  const resolver = createManagedArtistProfileResolver({ getOverride: (name) => getArtistProfileOverride(db, name), lookup, automatic: async () => { throw new Error('bound artists must not name-search'); } });
  const profile = await resolver('Queen');
  assert.equal(profile.name, 'Queen'); assert.equal(profile.country, 'GB'); assert.equal(profile.description, 'Corrected');
  assert.ok(profile.sources?.find((s) => s.label === 'Manual')?.fields.includes('descriptions.en'));
  assert.equal(upstreams, 2);
  const deleted = await h.delete(req(), 'Queen'); assert.equal(deleted.status, 200);
  assert.deepEqual(await deleted.json(), { override: null }); assert.equal((await (await h.get(req(), 'Queen')).json()).override, null);
  assert.equal((await h.delete(req(), 'Queen')).status, 200);
});
test('admin rejects invalid, unknown, oversized body and unsafe values before any write/lookup', async () => {
  let writes = 0, lookups = 0;
  const h = createArtistProfileAdminHandlers({ getUser: async () => ({ isAdmin: true }), getOverride: async () => null, setOverride: async (name, v) => { writes++; return v; }, deleteOverride: async () => {}, lookup: async () => { lookups++; return emptyManagedArtistProfile('x'); } });
  for (const body of [null, [], {}, { override: {}, x: true }, { override: {}, confirmIdentity: 'true' }, { override: { kind: [] } }, { override: { imageUrl: 'http://example.com' } }, { override: { descriptions: { en: 'x'.repeat(33000) } } }]) {
    const result = await h.put(req(body), 'Queen'); assert.equal(result.status, 400); assert.equal(result.headers.get('Cache-Control'), 'private, no-store');
  }
  assert.equal((await h.put(new Request('https://example.com', { method: 'PUT', body: '{' }), 'Queen')).status, 400);
  for (const body of [{ source: 'wikidata', id: 'Q1 ' }, { source: ['wikidata'], id: 'Q1' }, { source: 'fuzzy', id: 'Queen' }, { source: 'wikidata', id: 'Q1', url: 'https://evil.com' }]) assert.equal((await h.lookup(req(body))).status, 400);
  assert.equal(writes, 0); assert.equal(lookups, 0);
});
test('private/no-store and stable error codes survive DB/upstream failures on every admin verb', async () => {
  const broken = async (): Promise<never> => { throw new Error('private credentials must not leak'); };
  const h = createArtistProfileAdminHandlers({ getUser: async () => ({ isAdmin: true }), getOverride: broken, setOverride: broken, deleteOverride: broken, lookup: async () => { throw new ArtistProfileError('artist_profile_lookup_rate_limited', 429); } });
  for (const [call, status, code] of [
    [() => h.get(req(), 'Queen'), 500, 'artist_profile_load_failed'],
    [() => h.put(req({ override: {} }), 'Queen'), 500, 'artist_profile_save_failed'],
    [() => h.delete(req(), 'Queen'), 500, 'artist_profile_save_failed'],
    [() => h.lookup(req({ source: 'wikidata', id: 'Q1' })), 429, 'artist_profile_lookup_rate_limited'],
  ] as const) { const r = await call(); assert.equal(r.status, status); assert.equal(r.headers.get('Cache-Control'), 'private, no-store'); assert.deepEqual(await r.json(), { error: code }); }
});
test('manual fields survive all upstream failures; confirmed identity never falls back to a namesake', async () => {
  let automatic = 0;
  const resolve = createManagedArtistProfileResolver({ getOverride: async () => ({ musicbrainzId: MB, imageUrl: 'https://example.com/artist.jpg', country: null, aliases: [], genres: [], descriptions: { en: '', ja: '編集' } }), lookup: async () => { throw new Error('offline'); }, automatic: async () => { automatic++; return emptyManagedArtistProfile('wrong'); } });
  const p = await resolve('Queen');
  assert.equal(p.name, 'Queen'); assert.equal(p.imageUrl, 'https://example.com/artist.jpg'); assert.equal(p.country, null); assert.equal(p.description, null);
  assert.deepEqual(p.aliases, []); assert.equal(p.descriptions?.ja, '編集'); assert.equal(automatic, 0);
});
test('field ownership removes stale automatic attribution after manual null/empty corrections', () => {
  const auto: ArtistProfile = { ...emptyManagedArtistProfile('Queen'), imageUrl: 'https://example.com/auto.jpg', genres: ['rock'], description: 'Auto', descriptions: { en: 'Auto', ja: '自動' }, source: 'Spotify', sourceUrl: 'https://open.spotify.com/artist/1dfeR4HaWDbWqFHLkxsg1d', links: { website: 'https://auto.example.com' } };
  const p = mergeArtistProfile('Queen', [auto], { imageUrl: null, genres: [], descriptions: { en: '' }, sourceUrl: 'https://manual.example.com' });
  assert.equal(p.imageUrl, null); assert.equal(p.description, null); assert.deepEqual(p.genres, []);
  assert.equal(p.descriptions?.ja, '自動'); assert.equal(p.links?.website, 'https://auto.example.com');
  const manual = p.sources?.find((s) => s.label === 'Manual'); assert.ok(manual?.fields.includes('imageUrl')); assert.equal(manual?.url, 'https://manual.example.com');
  const spotify = p.sources?.find((s) => s.label === 'Spotify'); assert.ok(!spotify?.fields.includes('imageUrl')); assert.ok(!spotify?.fields.includes('genres')); assert.ok(!spotify?.fields.includes('description'));
});
test('legacy resolver behavior remains injectable; KV/automatic failures yield neutral profile', async () => {
  const songs = [{ spotify_track_id: 'public-id' }]; let seen: unknown;
  const resolve = createManagedArtistProfileResolver({ getOverride: async () => null, automatic: async (name, input, email) => { seen = { name, input, email }; return { ...emptyManagedArtistProfile(name), source: 'Deezer' }; } });
  assert.equal((await resolve('Queen', songs, 'user')).source, 'Deezer'); assert.deepEqual(seen, { name: 'Queen', input: songs, email: 'user' });
  let unsafeFallbacks = 0;
  const broken = createManagedArtistProfileResolver({ getOverride: async () => { throw new Error('KV'); }, automatic: async (name) => { unsafeFallbacks++; return emptyManagedArtistProfile(name); } });
  const p = await broken('Queen'); assert.equal(p.name, 'Queen'); assert.equal(p.imageUrl, null); assert.equal(p.source, null); assert.equal(unsafeFallbacks, 0);
});
test('real SQLite public membership denies private artist BEFORE managed override/cache access', async (t) => {
  const { db, client } = await fixture(t); await createSongsTable(client);
  await db.insert(schema.songs).values([{ id: 'private', artist: 'Hidden', title: 'Secret', createdBy: 'other' }, { id: 'public', artist: 'Queen', title: 'Public', isPublic: 1 }]);
  let reads = 0;
  const managed = createManagedArtistProfileResolver({ getOverride: async () => { reads++; return { descriptions: { en: 'Admin correction' } }; }, automatic: async (name) => emptyManagedArtistProfile(name) });
  const h = createArtistApiHandlers({ getDB: () => db, getUser: async () => null, getProfile: (name, songs, viewer) => managed(name, songs, viewer?.email) });
  assert.equal((await h.profile(req(), 'Hidden')).status, 404); assert.equal(reads, 0);
  const r = await h.profile(req(), 'Queen'); assert.equal(r.status, 200); assert.equal((await r.json()).profile.description, 'Admin correction'); assert.equal(reads, 1);
});
