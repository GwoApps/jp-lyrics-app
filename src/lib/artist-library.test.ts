import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, createSongsTable } from './test-db.ts';
import * as schema from './schema.ts';
import { createArtistApiHandlers, getArtistLibrary, listVisibleArtistSongs } from './artist-library.ts';
import type { ArtistProfile } from './artists.ts';
import { drizzle } from 'drizzle-orm/libsql';

async function fixture(t: Parameters<typeof createTestDb>[0], queries?: string[]) {
  const { db: originalDb, client } = createTestDb(t, 'artists', schema);
  const db = queries ? drizzle(client, { schema, logger: { logQuery(query) { queries.push(query); } } }) : originalDb;
  await createSongsTable(client);
  await client.execute(`CREATE TABLE favorites (
    user_email TEXT NOT NULL, song_id TEXT NOT NULL,
    in_unclassified INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_email, song_id)
  )`);
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
  const queries: string[] = [];
  const db = await fixture(t, queries);
  for (let batch = 0; batch < 6; batch++) {
    await db.insert(schema.songs).values(Array.from({ length: 200 }, (_, i) => ({
      id: `bulk-${batch}-${i}`, title: 'Track', artist: 'Large', spotifyAlbum: 'Album', isPublic: 1,
    })));
  }
  queries.length = 0;
  const result = await getArtistLibrary(db, null, 'Large');
  assert.equal(queries.length, 2);
  assert.match(queries[1], /json_each/);
  assert.equal(result?.songs.length, 1200);
  assert.equal(result?.albums[0].songs.length, 1200);
  assert.equal(result?.artist.songCount, 1200);
  assert.ok(result?.songs.every((song) => song.has_lyrics === false && song.favorited === null));
  await db.insert(schema.favorites).values({ userEmail: 'me', songId: 'bulk-5-199' });
  queries.length = 0;
  const signedIn = await getArtistLibrary(db, { email: 'me' }, 'Large');
  assert.equal(queries.length, 2);
  assert.equal(signedIn?.songs.length, 1200);
  assert.deepEqual(signedIn?.songs.filter((song) => song.favorited).map((song) => song.id), ['bulk-5-199']);
});

test('detail summaries preserve present, empty and malformed states without lyrics bodies in songs or albums', async (t) => {
  const db = await fixture(t);
  await db.insert(schema.songs).values([
    {
      id: 'complete', title: 'Complete', artist: 'Summary', spotifyAlbum: 'Album', isPublic: 1,
      lyricsRaw: '秘密の歌詞', lyricsSynced: '[00:01.20]秘密の歌詞',
      lyricsFurigana: JSON.stringify([{ segments: [{ text: '秘密', reading: 'ひみつ' }] }]),
      lyricsTranslation: JSON.stringify(['Secret translation']), lyricsTranslationLang: 'zh-cn',
      spotifyDurationMs: 201234, lyricsNeedsReview: 1,
    },
    { id: 'empty', title: 'Empty', artist: 'Summary', spotifyAlbum: 'Album', isPublic: 1, spotifyDurationMs: 0 },
    {
      id: 'malformed', title: 'Malformed', artist: 'Summary', spotifyAlbum: 'Album', isPublic: 1,
      lyricsSynced: '[00:99]broken', lyricsFurigana: '{broken', lyricsTranslation: '["truncated',
      lyricsTranslationLang: 'not a language', spotifyDurationMs: -1,
    },
    {
      id: 'unmarked', title: 'Unmarked', artist: 'Summary', isPublic: 1,
      lyricsRaw: 'plain', lyricsSynced: '[ar:Artist]\nplain', spotifyDurationMs: 1.5,
      lyricsFurigana: JSON.stringify([{ segments: [{ text: 'かな', reading: 'かな' }] }]),
      lyricsTranslation: JSON.stringify([' ', '']),
    },
    {
      id: 'wrong-shape', title: 'Wrong shape', artist: 'Summary', isPublic: 1,
      lyricsFurigana: JSON.stringify([{ segments: [null] }]), lyricsTranslation: JSON.stringify([42]),
      lyricsTranslationLang: 'en-US',
    },
    { id: 'private-summary', title: 'Hidden', artist: 'Summary', createdBy: 'other', lyricsRaw: 'private body' },
  ]);
  const handlers = createArtistApiHandlers({
    getDB: () => db, getUser: async () => null,
    getProfile: async () => { throw new Error('not requested'); },
  });
  const response = await handlers.detail(new Request('https://example.test/api/artists/Summary'), 'Summary');
  assert.equal(response.status, 200);
  const payload = await response.json();
  const summaries = payload.songs.map((song: Record<string, unknown>) => ({
    id: song.id, duration: song.spotify_duration_ms, lyrics: song.has_lyrics,
    timeline: song.has_synced_timeline, furigana: song.has_furigana,
    translation: song.has_translation, lang: song.lyrics_translation_lang, favorited: song.favorited,
  })).sort((a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id));
  assert.deepEqual(summaries, [
    { id: 'complete', duration: 201234, lyrics: true, timeline: true, furigana: true, translation: true, lang: 'zh-CN', favorited: null },
    { id: 'empty', duration: null, lyrics: false, timeline: false, furigana: false, translation: false, lang: null, favorited: null },
    { id: 'malformed', duration: null, lyrics: false, timeline: null, furigana: null, translation: null, lang: null, favorited: null },
    { id: 'unmarked', duration: null, lyrics: true, timeline: false, furigana: false, translation: false, lang: null, favorited: null },
    { id: 'wrong-shape', duration: null, lyrics: false, timeline: false, furigana: null, translation: null, lang: null, favorited: null },
  ]);
  assert.equal(payload.songs.find((song: { id: string }) => song.id === 'complete').lyrics_needs_review, 1);
  for (const song of [...payload.songs, ...payload.albums.flatMap((album: { songs: unknown[] }) => album.songs)]) {
    for (const column of ['lyrics_raw', 'lyrics_synced', 'lyrics_furigana', 'lyrics_translation']) {
      assert.equal(Object.hasOwn(song, column), false, `${column} must never be serialized`);
    }
  }
  assert.equal(JSON.stringify(payload).includes('秘密の歌詞'), false);
  assert.equal(payload.artist.songCount, 5);
  assert.equal((await getArtistLibrary(db, { isAdmin: true }, 'Summary'))?.artist.songCount, 6);
});

test('favorites use the route email identity in bulk, include classified favorites and isolate users', async (t) => {
  const queries: string[] = [];
  const db = await fixture(t, queries);
  await db.insert(schema.favorites).values([
    { userEmail: 'me', songId: '1', inUnclassified: 0 },
    { userEmail: 'other', songId: '6' },
    { userEmail: 'me', songId: '3' },
  ]);
  queries.length = 0;
  const mine = await getArtistLibrary(db, { email: 'me' }, 'A');
  assert.deepEqual(mine?.songs.map((song) => [song.id, song.favorited]).sort(), [['1', true], ['2', false], ['6', false]]);
  assert.ok(queries.length <= 3, `bulk detail expected, saw ${queries.length} SQL queries`);
  const other = await getArtistLibrary(db, { email: 'other' }, 'A');
  assert.deepEqual(other?.songs.map((song) => [song.id, song.favorited]).sort(), [['1', false], ['6', true]]);
  const admin = await getArtistLibrary(db, { email: 'admin', isAdmin: true }, 'Hidden');
  assert.equal(admin?.songs[0].favorited, false);
  assert.equal(await getArtistLibrary(db, { email: 'me' }, 'Hidden'), null);
});

test('directory/profile membership reads do not load lyrics bodies or user favorites', async (t) => {
  const queries: string[] = [];
  const db = await fixture(t, queries);
  const handlers = createArtistApiHandlers({
    getDB: () => db, getUser: async () => ({ email: 'me' }),
    getProfile: async (name, songs) => {
      assert.ok(songs.every((song) => !Object.hasOwn(song, 'lyrics_raw')));
      return { name, imageUrl: null, description: null, genres: [], source: null, sourceUrl: null };
    },
  });
  queries.length = 0;
  const req = new Request('https://example.test/api/artists');
  assert.equal((await handlers.list(req)).status, 200);
  assert.equal((await handlers.profile(req, 'A')).status, 200);
  assert.equal(queries.length, 2);
  for (const query of queries) assert.doesNotMatch(query, /lyrics_raw|lyrics_synced|lyrics_furigana|lyrics_translation|favorites/);
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
