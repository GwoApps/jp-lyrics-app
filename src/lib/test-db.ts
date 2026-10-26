import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';

/**
 * An isolated file-backed libSQL DB per test. Concurrent requests can open
 * independent connections to the same file; the test owns every connection.
 * The after hook closes them before removing the database and its WAL files,
 * including when an assertion throws.
 */
export function createTestDb<TSchema extends Record<string, unknown>>(
  t: TestContext,
  label: string,
  schema: TSchema,
) {
  const directory = mkdtempSync(join(tmpdir(), `jplrc-${label}-`));
  const path = join(directory, 'test.db');
  const clients = new Set<ReturnType<typeof createClient>>();
  const open = () => {
    const client = createClient({ url: `file:${path}`, timeout: 15_000 });
    clients.add(client);
    return {
      db: drizzle(client, { schema }),
      client,
      path,
      close: () => { client.close(); clients.delete(client); },
    };
  };
  t.after(() => {
    try {
      for (const client of clients) client.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  return { ...open(), open };
}

/** WAL and busy-wait policy shared by the integration-test schemas. */
export async function prepareTestDb(client: ReturnType<typeof createClient>) {
  await client.execute('PRAGMA journal_mode=WAL');
  await client.execute('PRAGMA busy_timeout=15000');
}

/** The three song-write suites use exactly the same minimal table schema. */
export async function createSongsTable(client: ReturnType<typeof createClient>) {
  await prepareTestDb(client);
  await client.execute(`CREATE TABLE songs (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    artist TEXT NOT NULL DEFAULT '',
    lyrics_raw TEXT NOT NULL DEFAULT '',
    lyrics_furigana TEXT NOT NULL DEFAULT '[]',
    reading_scheme TEXT NOT NULL DEFAULT 'ja-kana',
    reading_scheme_confirmed INTEGER NOT NULL DEFAULT 0,
    lyrics_synced TEXT NOT NULL DEFAULT '',
    lyrics_translation TEXT NOT NULL DEFAULT '[]',
    lyrics_translation_lang TEXT,
    lyrics_translation_reasoning TEXT,
    lyrics_glossary TEXT,
    cover_url TEXT,
    cover_palette TEXT,
    spotify_track_id TEXT,
    spotify_uri TEXT,
    spotify_album TEXT,
    spotify_duration_ms INTEGER,
    spotify_canonical_title TEXT,
    spotify_canonical_artist TEXT,
    lyrics_source TEXT NOT NULL DEFAULT 'manual',
    lyrics_confidence INTEGER NOT NULL DEFAULT 100,
    lyrics_needs_review INTEGER NOT NULL DEFAULT 0,
    lyrics_fetched_at TEXT,
    created_by TEXT NOT NULL DEFAULT '',
    created_by_name TEXT NOT NULL DEFAULT '',
    is_public INTEGER NOT NULL DEFAULT 0,
    public_requested INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  )
  `);
}
