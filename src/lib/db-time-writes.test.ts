import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTestDb, createSongsTable, prepareTestDb } from './test-db.ts';
import * as schema from './schema.ts';
import { parseDbTimestamp } from './db-time.ts';
import { nowUtcSql } from './db-time-sql.ts';
import { eq } from 'drizzle-orm';

const ROOT = process.cwd();
const ISO_UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;

test('an INSERT that omits created_at/updated_at writes a UTC ISO instant', async (t) => {
  const { db, client } = createTestDb(t, 'db-time-writes', schema);
  await createSongsTable(client);

  // Omitting the timestamps is the interesting case: the value then comes from
  // the schema default, which drizzle inlines for every backend (D1 included,
  // where the startup migrator never runs).
  await db.insert(schema.songs).values({ id: 's1', title: 't', artist: 'a' });
  const stored = (await client.execute(`SELECT created_at, updated_at FROM songs WHERE id = 's1'`)).rows[0] as unknown as {
    created_at: string;
    updated_at: string;
  };
  assert.match(stored.created_at, ISO_UTC);
  assert.match(stored.updated_at, ISO_UTC);
  // The stored string reads back as the moment it was written, not as a local
  // wall clock that every visitor would re-interpret differently.
  assert.ok(Math.abs(Date.now() - parseDbTimestamp(stored.created_at)!.getTime()) < 60_000);
});

test('an UPDATE stamps updated_at with the same UTC ISO shape', async (t) => {
  const { db, client } = createTestDb(t, 'db-time-updates', schema);
  await createSongsTable(client);
  await db.insert(schema.songs).values({ id: 's1', title: 't', artist: 'a' });
  await db.update(schema.songs).set({ title: 'changed', updatedAt: nowUtcSql() }).where(eq(schema.songs.id, 's1'));
  const stored = (await client.execute(`SELECT updated_at FROM songs WHERE id = 's1'`)).rows[0] as unknown as { updated_at: string };
  assert.match(stored.updated_at, ISO_UTC);
  assert.ok(Math.abs(Date.now() - parseDbTimestamp(stored.updated_at)!.getTime()) < 60_000);
});

test('migration 0024 normalises naive wall-clock rows and leaves ISO rows alone', async (t) => {
  const { client } = createTestDb(t, 'db-time-migration', {});
  await prepareTestDb(client);
  for (const ddl of [
    `CREATE TABLE songs (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, lyrics_fetched_at TEXT)`,
    `CREATE TABLE users (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE TABLE spotify_auth (user_email TEXT PRIMARY KEY, updated_at TEXT NOT NULL)`,
    `CREATE TABLE favorites (user_email TEXT, song_id TEXT, created_at TEXT NOT NULL, PRIMARY KEY (user_email, song_id))`,
    `CREATE TABLE collections (id TEXT PRIMARY KEY, created_at TEXT NOT NULL)`,
    `CREATE TABLE lyrics_provider_configs (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, checked_at TEXT)`,
    `CREATE TABLE user_settings (user_id TEXT, key TEXT, updated_at TEXT NOT NULL, PRIMARY KEY (user_id, key))`,
    `CREATE TABLE song_covers (song_id TEXT PRIMARY KEY, updated_at TEXT NOT NULL)`,
    `CREATE TABLE playlist_import_jobs (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE TABLE admin_audit_log (id TEXT PRIMARY KEY, occurred_at TEXT NOT NULL)`,
    `CREATE TABLE playlist_import_track_results (job_id TEXT, track_index INTEGER, created_at TEXT NOT NULL)`,
  ]) await client.execute(ddl);

  await client.execute(`INSERT INTO songs VALUES
    ('naive', '2026-09-25 23:08:47', '2026-09-25 23:08:47', '2026-09-25T23:08:47.000Z'),
    ('iso', '2026-09-25T23:08:47.000Z', '2026-09-26T07:08:47.000Z', NULL)`);
  await client.execute(`INSERT INTO admin_audit_log VALUES ('a1', '2026-09-25 23:08:47')`);
  await client.execute(`INSERT INTO playlist_import_jobs VALUES ('j1', '2026-09-25 23:08:47', '2026-09-26 01:00:00')`);
  await client.execute(`INSERT INTO lyrics_provider_configs VALUES ('p1', '2026-09-25 23:08:47', '2026-09-25 23:08:47', '2026-09-25T23:08:47.000Z')`);

  const migration = readFileSync(`${ROOT}/drizzle/0024_normalize_timestamps_to_utc.sql`, 'utf-8');
  const run = async () => {
    for (const statement of migration.split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean)) {
      await client.execute(statement);
    }
  };
  await run();
  await run(); // idempotent: a second pass must not shift anything again

  const row = async (query: string) => (await client.execute(query)).rows[0] as Record<string, string | null>;
  const naive = await row(`SELECT * FROM songs WHERE id = 'naive'`);
  assert.equal(naive.created_at, '2026-09-25T23:08:47.000Z');
  assert.equal(naive.updated_at, '2026-09-25T23:08:47.000Z');
  // Already-ISO timestamps (lyrics_fetched_at, checked_at) stay byte-identical.
  assert.equal(naive.lyrics_fetched_at, '2026-09-25T23:08:47.000Z');

  const iso = await row(`SELECT * FROM songs WHERE id = 'iso'`);
  assert.equal(iso.created_at, '2026-09-25T23:08:47.000Z');
  assert.equal(iso.updated_at, '2026-09-26T07:08:47.000Z');
  assert.equal(iso.lyrics_fetched_at, null);

  assert.equal((await row('SELECT occurred_at FROM admin_audit_log')).occurred_at, '2026-09-25T23:08:47.000Z');
  const job = await row('SELECT * FROM playlist_import_jobs');
  assert.equal(job.created_at, '2026-09-25T23:08:47.000Z');
  assert.equal(job.updated_at, '2026-09-26T01:00:00.000Z');
  const provider = await row('SELECT * FROM lyrics_provider_configs');
  assert.equal(provider.created_at, '2026-09-25T23:08:47.000Z');
  assert.equal(provider.updated_at, '2026-09-25T23:08:47.000Z');
  assert.equal(provider.checked_at, '2026-09-25T23:08:47.000Z');

  // The converted value still means the instant the old row meant.
  assert.equal(parseDbTimestamp(naive.created_at)?.toISOString(), '2026-09-25T23:08:47.000Z');
});
