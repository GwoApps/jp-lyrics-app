import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, createSongsTable } from './test-db.ts';
import * as schema from './schema.ts';
import { createArtistApiHandlers, getArtistLibrary, listVisibleArtistSongs } from './artist-library.ts';
import type { ArtistProfile } from './artists.ts';

async function fixture(t: Parameters<typeof createTestDb>[0]) {
  const { db, client } = createTestDb(t, 'artists', schema);
  await createSongsTable(client);
  await db.insert(schema.songs).values([
    { id: '1', title: 'Single', artist: ' A, a, B ', spotifyAlbum: 'Single', isPublic: 1 },
    { id: '2', title: 'Mine', artist: 'a', spotifyAlbum: 'Private', createdBy: 'me' },
    { id: '3', title: 'Secret', artist: 'Hidden', spotifyAlbum: 'Secret', createdBy: 'other' },
    { id: '4', title: 'Other', artist: 'AA', isPublic: 1 },
    { id: '5', title: 'Unicode', artist: '東京/事変 & 100%?', isPublic: 1 },
    { id: '6', title: 'No album', artist: 'A', isPublic: 1 },
  ]);
  return db;
}

test('real SQLite ACL precedes all artist counts, songs and albums; exact credit match', async (t) => {
  const db = await fixture(t);
  const anon = await getArtistLibrary(db, null, ' a ');
  assert.deepEqual(anon?.artist, { name: 'A', songCount: 2, albumCount: 1 });
  assert.deepEqual(anon?.songs.map((song) => song.id).sort(), ['1', '6']);
  assert.equal(anon?.albums[0].title, 'Single');
  const own = await getArtistLibrary(db, { email: 'me' }, 'A');
  assert.deepEqual(own?.artist, { name: 'A', songCount: 3, albumCount: 2 });
  assert.equal(await getArtistLibrary(db, null, 'Hidden'), null);
  assert.equal(await getArtistLibrary(db, { email: 'me' }, 'Hidden'), null);
  assert.equal((await getArtistLibrary(db, { isAdmin: true }, 'Hidden'))?.artist.songCount, 1);
  assert.equal((await listVisibleArtistSongs(db, null)).length, 4);
  assert.equal((await getArtistLibrary(db, null, '東京/事変 & 100%?'))?.songs[0].id, '5');
});

test('all songs returned beyond common query caps', async (t) => {
  const db = await fixture(t);
  for (let batch = 0; batch < 6; batch++) {
    await db.insert(schema.songs).values(Array.from({ length: 200 }, (_, i) => ({
      id: `bulk-${batch}-${i}`, title: 'Track', artist: 'Large', spotifyAlbum: 'Album', isPublic: 1,
    })));
  }
  const result = await getArtistLibrary(db, null, 'Large');
  assert.equal(result?.songs.length, 1200);
  assert.equal(result?.albums[0].songs.length, 1200);
  assert.equal(result?.artist.songCount, 1200);
});

test('HTTP contracts, private/no-store on all statuses, profile membership checked before provider', async (t) => {
  const db = await fixture(t);
  const lookups: string[] = [];
  const handlers = createArtistApiHandlers({
    getDB: () => db,
    getUser: async () => null,
    getProfile: async (name): Promise<ArtistProfile> => {
      lookups.push(name);
      return { name, imageUrl: null, description: null, genres: [], source: null, sourceUrl: null };
    },
  });
  const req = new Request('https://example.test/api/artists');
  const list = await handlers.list(req);
  assert.deepEqual((await list.json()).artists.map((a: {name: string}) => a.name), ['A', 'AA', 'B', '東京/事変 & 100%?']);
  const detail = await handlers.detail(req, 'A');
  assert.equal((await detail.json()).songs.length, 2);
  const missing = await handlers.detail(req, 'Hidden');
  assert.equal(missing.status, 404);
  const privateProfile = await handlers.profile(req, 'Hidden');
  assert.equal(privateProfile.status, 404);
  assert.deepEqual(lookups, []);
  const profile = await handlers.profile(req, ' a ');
  assert.equal((await profile.json()).profile.name, 'A');
  assert.deepEqual(lookups, ['A']);
  for (const response of [list, detail, missing, privateProfile, profile]) {
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  }
});

test('profile upstream errors are neutral and ACL/database failures remain no-store', async (t) => {
  const db = await fixture(t);
  const deps = { getDB: () => db, getUser: async () => null, getProfile: async (): Promise<ArtistProfile> => { throw new Error('upstream'); } };
  const req = new Request('https://example.test/api/artists');
  const result = await createArtistApiHandlers(deps).profile(req, 'A');
  assert.equal(result.status, 200);
  assert.equal((await result.json()).profile.source, null);
  const broken = createArtistApiHandlers({ ...deps, getUser: async () => { throw new Error('db'); } });
  for (const call of [() => broken.list(req), () => broken.detail(req, 'A'), () => broken.profile(req, 'A')]) {
    const response = await call();
    assert.equal(response.status, 500);
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  }
});
