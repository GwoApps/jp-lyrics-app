import test from 'node:test';
import assert from 'node:assert/strict';
import { unlinkSync } from 'node:fs';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { sql } from 'drizzle-orm';
import { mergeSliceIntoCache, writeSongField } from './translation-cache.ts';
import { parseTranslationCache } from './translation/parse.ts';
import { songs } from './schema.ts';

/**
 * CAS persistence tests for the translation cache.
 *
 * Covers the three invariants the translate route relies on:
 *   1. "done"/JSON responses are only emitted after the merged cache has
 *      actually committed — verified by reading the row back immediately
 *      after `await`ing the merge.
 *   2. A song whose lyrics were edited mid-flight rejects the write
 *      (`stale_source`) instead of resurrecting stale output.
 *   3. Two overlapping slice merges (multi-tab / parallel resume) both
 *      survive — the optimistic-lock re-read + CAS prevents last-write-wins
 *      from dropping a slice.
 *
 * Uses a real local libsql DB (same driver family as D1) exactly like the
 * ai-usage concurrency test: every "request" gets its own connection and the
 * busy timeout lets concurrent writers serialise on the write lock.
 */

type TestDb = ReturnType<typeof makeTestDb>;

function makeTestDb(path: string, opts: { fresh?: boolean } = {}) {
  if (opts.fresh !== false) {
    try { unlinkSync(path); } catch { /* fresh */ }
  }
  const client = createClient({ url: `file:${path}`, timeout: 15_000 });
  const db = drizzle(client, { schema: { songs } });
  return { db, client, path };
}

const SONG_ID = 'song-1';
const LYRICS = 'line one\nline two\nline three\nline four';

async function createTables(t: TestDb) {
  await t.client.execute('PRAGMA journal_mode=WAL');
  await t.client.execute('PRAGMA busy_timeout=15000');
  await t.db.run(sql`CREATE TABLE songs (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    artist TEXT NOT NULL DEFAULT '',
    lyrics_raw TEXT NOT NULL DEFAULT '',
    lyrics_furigana TEXT NOT NULL DEFAULT '[]',
    reading_scheme TEXT NOT NULL DEFAULT 'ja-kana',
    reading_scheme_confirmed INTEGER NOT NULL DEFAULT 0,
    lyrics_synced TEXT NOT NULL DEFAULT '',
    lyrics_translation TEXT NOT NULL DEFAULT '[]',
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
  )`);
}

async function seedSong(t: TestDb, opts: { lyrics?: string; cache?: string | null } = {}) {
  await t.db.insert(songs).values({
    id: SONG_ID,
    title: 'Test',
    artist: 'Artist',
    lyricsRaw: opts.lyrics ?? LYRICS,
    lyricsTranslation: opts.cache ?? '[]',
  }).run();
}

function readSong(t: TestDb): Promise<{ lyricsRaw: string; lyricsTranslation: string } | undefined> {
  return t.db.select({
    lyricsRaw: songs.lyricsRaw,
    lyricsTranslation: songs.lyricsTranslation,
  }).from(songs).where(sql`id = ${SONG_ID}`).get() as Promise<{ lyricsRaw: string; lyricsTranslation: string } | undefined>;
}

function makeResolved(values: (string | null)[]): (string | null)[] {
  return values;
}

test('merge persists the merged cache before returning — immediately readable after await', async () => {
  const t = makeTestDb(`/tmp/translation-cache-commit-${process.pid}-${Date.now()}.db`);
  await createTables(t);
  await seedSong(t);

  const result = await mergeSliceIntoCache(t.db, {
    id: SONG_ID,
    sourceLyrics: LYRICS,
    totalLines: 4,
    start: 0,
    resolved: makeResolved(['一', '二', null, null]),
  });
  assert.deepEqual(result, { ok: true, cache: ['一', '二', '', ''] });

  // The whole point: once the merge resolves, the row ALREADY reflects it —
  // no void-dropped promise, no refresh race.
  const row = await readSong(t);
  assert.equal(row?.lyricsTranslation, '["一","二","",""]');
});

test('merge into an existing partial cache keeps earlier lines', async () => {
  const t = makeTestDb(`/tmp/translation-cache-partial-${process.pid}-${Date.now()}.db`);
  await createTables(t);
  await seedSong(t, { cache: '["早","","",""]' });

  const result = await mergeSliceIntoCache(t.db, {
    id: SONG_ID,
    sourceLyrics: LYRICS,
    totalLines: 4,
    start: 2,
    resolved: makeResolved(['晚', '好']),
  });
  assert.equal(result.ok, true);
  const row = await readSong(t);
  assert.equal(row?.lyricsTranslation, '["早","","晚","好"]');
});

test('rejects the write when lyrics were edited mid-flight (stale source)', async () => {
  const t = makeTestDb(`/tmp/translation-cache-stale-${process.pid}-${Date.now()}.db`);
  await createTables(t);
  await seedSong(t);

  // The user edits the lyrics while the AI request is running: the edit API
  // clears the translation cache AND rewrites lyrics_raw.
  await t.db.update(songs).set({
    lyricsRaw: 'line one EDITED\nline two\nline three\nline four',
    lyricsTranslation: '[]',
  }).where(sql`id = ${SONG_ID}`).run();

  const result = await mergeSliceIntoCache(t.db, {
    id: SONG_ID,
    sourceLyrics: LYRICS, // stale snapshot from the request start
    totalLines: 4,
    start: 0,
    resolved: makeResolved(['一', '二', '三', '四']),
  });
  assert.deepEqual(result, { ok: false, reason: 'stale_source' });

  // Nothing was written — the cleared cache stays cleared.
  const row = await readSong(t);
  assert.equal(row?.lyricsRaw, 'line one EDITED\nline two\nline three\nline four');
  assert.equal(row?.lyricsTranslation, '[]');
});

test('overlapping slice merges both survive (optimistic lock, no last-write-wins)', async () => {
  const t = makeTestDb(`/tmp/translation-cache-conc-${process.pid}-${Date.now()}.db`);
  await createTables(t);
  await seedSong(t);

  // Two "requests" on their own connections merge different slices in parallel.
  const own1 = makeTestDb(t.path, { fresh: false });
  const own2 = makeTestDb(t.path, { fresh: false });
  try {
    await own1.client.execute('PRAGMA busy_timeout=15000');
    await own2.client.execute('PRAGMA busy_timeout=15000');

    const [r1, r2] = await Promise.all([
      mergeSliceIntoCache(own1.db, {
        id: SONG_ID,
        sourceLyrics: LYRICS,
        totalLines: 4,
        start: 0,
        resolved: makeResolved(['一', '二', null, null]),
      }),
      mergeSliceIntoCache(own2.db, {
        id: SONG_ID,
        sourceLyrics: LYRICS,
        totalLines: 4,
        start: 2,
        resolved: makeResolved(['三', '四']),
      }),
    ]);

    // Both slices must commit — neither may be dropped by the other writer.
    assert.equal(r1.ok, true, 'slice 0 must commit');
    assert.equal(r2.ok, true, 'slice 2 must commit');
    const row = await readSong(t);
    assert.equal(row?.lyricsTranslation, '["一","二","三","四"]');
  } finally {
    own1.client.close();
    own2.client.close();
  }
});

test('CAS retry merges on top of a concurrent write instead of clobbering it', async () => {
  const t = makeTestDb(`/tmp/translation-cache-cas-${process.pid}-${Date.now()}.db`);
  await createTables(t);
  await seedSong(t);

  // Simulate the race directly: the loser read the cache, then the winner
  // commits a different slice before the loser's write lands. Because the
  // merge re-reads + CASes on the exact value it saw, the loser retries and
  // merges on top of the winner's cache instead of overwriting it.
  const loser = await mergeSliceIntoCache(t.db, {
    id: SONG_ID,
    sourceLyrics: LYRICS,
    totalLines: 4,
    start: 0,
    resolved: makeResolved(['一', '二', null, null]),
  });
  assert.equal(loser.ok, true);

  // A second merge for the remaining slice lands after — both survive.
  const winner = await mergeSliceIntoCache(t.db, {
    id: SONG_ID,
    sourceLyrics: LYRICS,
    totalLines: 4,
    start: 2,
    resolved: makeResolved(['三', '四']),
  });
  assert.equal(winner.ok, true);
  const row = await readSong(t);
  assert.equal(row?.lyricsTranslation, '["一","二","三","四"]');
});

test('writeSongField persists reasoning under the same source CAS', async () => {
  const t = makeTestDb(`/tmp/translation-cache-field-${process.pid}-${Date.now()}.db`);
  await createTables(t);
  await seedSong(t);

  const ok = await writeSongField(t.db, {
    id: SONG_ID,
    sourceLyrics: LYRICS,
    patch: { lyricsTranslationReasoning: 'thinking…' },
  });
  assert.deepEqual(ok, { ok: true });

  // Lyrics edited → reasoning write must be refused.
  await t.db.update(songs).set({ lyricsRaw: 'edited\nline two\nline three\nline four' }).where(sql`id = ${SONG_ID}`).run();
  const stale = await writeSongField(t.db, {
    id: SONG_ID,
    sourceLyrics: LYRICS,
    patch: { lyricsTranslationReasoning: 'stale thinking…' },
  });
  assert.deepEqual(stale, { ok: false, reason: 'stale_source' });
});

test('parseTranslationCache maps non-string entries to empty strings without shifting lines', () => {
  // Regression for issue #85: ["第一行译文", null, "第三行译文"] must NOT become
  // ["第一行译文", "第三行译文"] — the null slot is kept as '' so the third line
  // stays aligned to index 2 instead of being shown on line 2.
  assert.deepEqual(
    parseTranslationCache('["第一行译文", null, "第三行译文"]'),
    ['第一行译文', '', '第三行译文'],
  );
  // Mixed non-string types, with a total line count that pads/truncates.
  assert.deepEqual(
    parseTranslationCache('["一", null, "三", 4]', 5),
    ['一', '', '三', '', ''],
  );
  // Extra entries beyond totalLines are dropped.
  assert.deepEqual(
    parseTranslationCache('["一", "二", "三", "四"]', 3),
    ['一', '二', '三'],
  );
  // Damaged / missing / empty cache → all-empty seed of the right length.
  assert.deepEqual(parseTranslationCache('', 3), ['', '', '']);
  assert.deepEqual(parseTranslationCache('bad-json', 2), ['', '']);
  assert.deepEqual(parseTranslationCache(null, 1), ['']);
  assert.deepEqual(parseTranslationCache('[]', 4), ['', '', '', '']);
});

test('a padded empty cache must not count as "has translation" (untranslated songs)', () => {
  // Regression: the DB column defaults to '[]' for untranslated songs, and the
  // frontend pads the parsed cache to the lyric line count. An all-empty array
  // still means "nothing translated" — consumers must test content, not length,
  // or the translate trigger / prompt never fire for untranslated songs.
  const cache = parseTranslationCache('[]', 4);
  assert.equal(cache.length, 4);
  assert.equal(cache.some((line) => line !== ''), false);
  // A partial translation flips the same check to true (used by the resume
  // prompt and the translation-toggle trigger).
  const partial = parseTranslationCache('["一", "", "", ""]', 4);
  assert.equal(partial.some((line) => line !== ''), true);
});

test('merge into a partial cache with a stale null slot does not shift later lines', async () => {
  const t = makeTestDb(`/tmp/translation-cache-nullslot-${process.pid}-${Date.now()}.db`);
  await createTables(t);
  // Damaged/legacy cache: line 2 is null. If the parser filtered it, line 3's
  // translation would shift up to line 2. It must stay at index 2.
  await seedSong(t, { cache: '["早", null, "晚"]' });

  const result = await mergeSliceIntoCache(t.db, {
    id: SONG_ID,
    sourceLyrics: LYRICS, // 4 lines
    totalLines: 4,
    start: 3,
    resolved: makeResolved(['夜']),
  });
  assert.equal(result.ok, true);
  const row = await readSong(t);
  // Index 1 stays '' (was null), index 2 keeps "晚", index 3 is the new merge.
  assert.equal(row?.lyricsTranslation, '["早","","晚","夜"]');
});
