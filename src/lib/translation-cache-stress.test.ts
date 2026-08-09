import test from 'node:test';
import assert from 'node:assert/strict';
import { unlinkSync } from 'node:fs';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { sql } from 'drizzle-orm';
import { mergeSliceIntoCache } from './translation-cache.ts';

/**
 * Stress test for the optimistic-lock merge under heavy contention.
 *
 * The guarantee is: NO successful writer's line is ever lost. Writers whose
 * CAS loses the race report `contention` and — exactly like the client's
 * resume flow — simply retry on top of the latest cache. Under 20 concurrent
 * writers this converges to a COMPLETE cache; a plain last-write-wins merge
 * would silently drop 19 of the 20 lines.
 */
test('20 concurrent single-line slice merges converge to a complete cache', async () => {
  const path = `/tmp/stress-${process.pid}-${Date.now()}.db`;
  const client = createClient({ url: `file:${path}`, timeout: 15000 });
  const db = drizzle(client, { schema: {} });
  await client.execute('PRAGMA journal_mode=WAL');
  await client.execute('PRAGMA busy_timeout=15000');
  await db.run(sql`CREATE TABLE songs (
    id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', artist TEXT NOT NULL DEFAULT '',
    lyrics_raw TEXT NOT NULL DEFAULT '', lyrics_furigana TEXT NOT NULL DEFAULT '[]',
    reading_scheme TEXT NOT NULL DEFAULT 'ja-kana', reading_scheme_confirmed INTEGER NOT NULL DEFAULT 0,
    lyrics_synced TEXT NOT NULL DEFAULT '', lyrics_translation TEXT NOT NULL DEFAULT '[]',
    lyrics_translation_reasoning TEXT, lyrics_glossary TEXT, cover_url TEXT, cover_palette TEXT,
    spotify_track_id TEXT, spotify_uri TEXT, spotify_album TEXT, spotify_duration_ms INTEGER,
    spotify_canonical_title TEXT, spotify_canonical_artist TEXT, lyrics_source TEXT NOT NULL DEFAULT 'manual',
    lyrics_confidence INTEGER NOT NULL DEFAULT 100, lyrics_needs_review INTEGER NOT NULL DEFAULT 0,
    lyrics_fetched_at TEXT, created_by TEXT NOT NULL DEFAULT '', created_by_name TEXT NOT NULL DEFAULT '',
    is_public INTEGER NOT NULL DEFAULT 0, public_requested INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')), updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  )`);
  const LYRICS = Array.from({ length: 20 }, (_, i) => `L${i}`).join('\n');
  await db.run(sql`INSERT INTO songs (id, title, artist, lyrics_raw) VALUES ('s', 't', 'a', ${LYRICS})`);

  const N = 20;
  // Each writer owns a connection (D1 gives every request its own binding)
  // and retries until its line commits — mirroring the client's resume flow.
  const jobs = Array.from({ length: N }, (_, i) => {
    const own = createClient({ url: `file:${path}`, timeout: 15000 });
    const odb = drizzle(own, { schema: {} });
    return own.execute('PRAGMA busy_timeout=15000').then(async () => {
      for (let attempt = 0; attempt < 50; attempt++) {
        const r = await mergeSliceIntoCache(odb, {
          id: 's', sourceLyrics: LYRICS, totalLines: 20, start: i, resolved: [`T${i}`],
        });
        if (r.ok) return r;
        assert.notEqual(r.reason, 'stale_source', 'source never changes in this test');
      }
      throw new Error(`writer ${i} never committed`);
    }).finally(() => own.close());
  });
  await Promise.all(jobs);

  const row = await db.get(sql`SELECT lyrics_translation FROM songs WHERE id='s'`) as { lyrics_translation: string };
  const cache = JSON.parse(row.lyrics_translation) as string[];
  assert.equal(cache.filter(Boolean).length, N, 'every slice line must be present in the final cache');
  assert.equal(new Set(cache.filter(Boolean)).size, N, 'every slice line must be unique');
  client.close();
  unlinkSync(path);
});
