/**
 * Terminology persistence across lyrics edits (issue #341).
 *
 * Drives the exact UPDATE set `buildSongUpdateSet` produces against a real
 * libSQL database, because the interesting part is the SQL `CASE`: a lyrics
 * change must drop the auto-extracted terms while keeping the ones the user
 * wrote by hand.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import { createSongsTable, createTestDb } from './test-db.ts';
import { buildSongUpdateSet } from './song-update.ts';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from './schema.ts';

const SONG_ID = 'song-glossary-1';
const OLD_LYRICS = 'line one\nline two';

const AUTO = { original: '花火', translation: '焰火' };
const PINNED = { original: '花火', translation: '烟花', manual: true as const };

async function seed(client: Parameters<typeof createSongsTable>[0], glossary: string | null) {
  await client.execute({
    sql: 'INSERT INTO songs (id, title, artist, lyrics_raw, lyrics_glossary) VALUES (?, ?, ?, ?, ?)',
    args: [SONG_ID, 'T', 'A', OLD_LYRICS, glossary],
  });
}

test('a lyrics edit keeps hand-pinned terms and drops the extracted ones', async (ctx) => {
  const t = createTestDb(ctx, 'glossary-persist', schema);
  await createSongsTable(t.client);
  await seed(t.client, JSON.stringify([AUTO, PINNED]));

  const existing = { lyrics_raw: OLD_LYRICS, lyrics_synced: '', lyrics_glossary: JSON.stringify([AUTO, PINNED]) };
  const set = buildSongUpdateSet(existing, { lyrics_raw: 'brand new line' });
  await drizzle(t.client, { schema }).update(schema.songs)
    .set(set as never)
    .where(sql`id = ${SONG_ID}`)
    .run();

  const row = await t.client.execute(`SELECT lyrics_glossary, lyrics_raw FROM songs WHERE id = '${SONG_ID}'`);
  const stored = JSON.parse(String(row.rows[0].lyrics_glossary));
  assert.deepEqual(stored, [PINNED], 'the pin must outlive the edit, the auto entry must not');
  assert.equal(row.rows[0].lyrics_raw, 'brand new line');
});

test('without pins the whole table is invalidated as before', async (ctx) => {
  const t = createTestDb(ctx, 'glossary-persist-auto', schema);
  await createSongsTable(t.client);
  await seed(t.client, JSON.stringify([AUTO]));

  const set = buildSongUpdateSet(
    { lyrics_raw: OLD_LYRICS, lyrics_synced: '', lyrics_glossary: JSON.stringify([AUTO]) },
    { lyrics_raw: 'brand new line' },
  );
  await drizzle(t.client, { schema }).update(schema.songs)
    .set(set as never)
    .where(sql`id = ${SONG_ID}`)
    .run();

  const row = await t.client.execute(`SELECT lyrics_glossary FROM songs WHERE id = '${SONG_ID}'`);
  assert.equal(row.rows[0].lyrics_glossary, null);
});

test('editing only timestamps leaves the table untouched', async (ctx) => {
  const t = createTestDb(ctx, 'glossary-persist-keep', schema);
  await createSongsTable(t.client);
  await seed(t.client, JSON.stringify([AUTO]));

  const set = buildSongUpdateSet(
    { lyrics_raw: OLD_LYRICS, lyrics_synced: '', lyrics_glossary: JSON.stringify([AUTO]) },
    { lyrics_raw: OLD_LYRICS },
  );
  await drizzle(t.client, { schema }).update(schema.songs)
    .set(set as never)
    .where(sql`id = ${SONG_ID}`)
    .run();

  const row = await t.client.execute(`SELECT lyrics_glossary FROM songs WHERE id = '${SONG_ID}'`);
  assert.deepEqual(JSON.parse(String(row.rows[0].lyrics_glossary)), [AUTO]);
});
