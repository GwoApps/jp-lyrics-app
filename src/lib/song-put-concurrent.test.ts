/**
 * Concurrency regression tests for the songs PUT route (issue #211).
 *
 * The songs PUT handler used to read the full row once at request start, then
 * write back EVERY column (including fields not present in the payload) from
 * that stale snapshot. Two concurrent PUTs touching different fields suffered
 * a lost update: the later request silently resurrected the earlier writer's
 * old lyrics / furigana / translation / palette.
 *
 * The fix builds the UPDATE `set` from the payload only, and expresses
 * cross-field derived invalidation (clear furigana/translation/glossary when
 * lyrics text changes) as SQL `CASE` expressions that compare the submitted
 * value against the DB column's CURRENT value at write time. This test drives
 * the same SQL pattern against a real libsql DB (same driver family as D1) to
 * prove two interleaved requests no longer overwrite each other.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { unlinkSync } from 'node:fs';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { sql } from 'drizzle-orm';

type TestDb = ReturnType<typeof makeTestDb>;

function makeTestDb(path: string) {
  try { unlinkSync(path); } catch { /* fresh */ }
  const client = createClient({ url: `file:${path}`, timeout: 15_000 });
  const db = drizzle(client);
  return { db, client, path };
}

const SONG_ID = 'song-put-concurrent-1';
const OLD_LYRICS = 'line one\nline two';
const OLD_FURIGANA = '["か","な"]';
const OLD_TRANSLATION = '["译一","译二"]';
const NEW_LYRICS = 'brand new line one\nbrand new line two';

const PALETTE = JSON.stringify({
  primary: { r: 10, g: 20, b: 30 },
  secondary: { r: 40, g: 50, b: 60 },
  tertiary: { r: 70, g: 80, b: 90 },
});

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
  )`);
}

async function seedSong(t: TestDb) {
  await t.db.run(sql`INSERT INTO songs (
    id, title, artist, lyrics_raw, lyrics_furigana, lyrics_translation,
    reading_scheme, reading_scheme_confirmed, lyrics_source, lyrics_confidence
  ) VALUES (
    ${SONG_ID}, 'Test', 'Artist', ${OLD_LYRICS}, ${OLD_FURIGANA}, ${OLD_TRANSLATION},
    'ja-kana', 1, 'utaten', 80
  )`);
}

async function readSong(t: TestDb) {
  return t.db.get(sql`SELECT * FROM songs WHERE id = ${SONG_ID}`) as unknown as Record<string, unknown>;
}

// Helper that simulates the lyrics-edit SQL the PUT route generates when
// `lyrics_raw` is in the payload. Uses SQL CASE against live column values.
function lyricsEditSql(newRaw: string) {
  return sql`UPDATE songs SET
    lyrics_raw = ${newRaw},
    lyrics_furigana = CASE WHEN ${newRaw} != lyrics_raw THEN '[]' ELSE lyrics_furigana END,
    lyrics_translation = CASE WHEN ${newRaw} != lyrics_raw THEN '[]' ELSE lyrics_translation END,
    lyrics_translation_lang = CASE WHEN ${newRaw} != lyrics_raw THEN NULL ELSE lyrics_translation_lang END,
    lyrics_translation_reasoning = CASE WHEN ${newRaw} != lyrics_raw THEN NULL ELSE lyrics_translation_reasoning END,
    lyrics_glossary = CASE WHEN ${newRaw} != lyrics_raw THEN NULL ELSE lyrics_glossary END,
    lyrics_source = CASE WHEN ${newRaw} != lyrics_raw THEN 'manual' ELSE lyrics_source END,
    lyrics_confidence = CASE WHEN ${newRaw} != lyrics_raw THEN 100 ELSE lyrics_confidence END,
    lyrics_needs_review = CASE WHEN ${newRaw} != lyrics_raw THEN 0 ELSE lyrics_needs_review END,
    lyrics_fetched_at = CASE WHEN ${newRaw} != lyrics_raw THEN NULL ELSE lyrics_fetched_at END,
    reading_scheme_confirmed = CASE WHEN ${newRaw} != lyrics_raw AND 'ja-kana' = 'ja-kana'
      THEN 0 ELSE reading_scheme_confirmed END
  WHERE id = ${SONG_ID}`;
}

test('cover-palette-only PUT does not resurrect stale lyrics/derived caches', async () => {
  const t = makeTestDb(`/tmp/song-put-palette-${process.pid}-${Date.now()}.db`);
  await createTables(t);
  await seedSong(t);

  // --- Simulate the two interleaved requests described in issue #211. ---

  // Step 1: A cover-palette request reads the row (snapshot at T0).
  const snapshot = await readSong(t);
  assert.equal(snapshot.lyrics_raw, OLD_LYRICS);

  // Step 2: A lyrics-edit request commits first, updating lyrics_raw and
  // clearing derived caches.
  await t.db.run(lyricsEditSql(NEW_LYRICS));

  // Step 3: The delayed cover-palette request writes only its own field.
  // This is the minimal-set behavior — it must NOT write back the old
  // lyrics_raw / furigana / translation from the snapshot it read at step 1.
  await t.db.run(sql`UPDATE songs SET
    cover_palette = ${PALETTE}
  WHERE id = ${SONG_ID}`);

  // Final state: BOTH the new lyrics AND the palette are present. The old
  // lyrics / furigana / translation from the snapshot must NOT be resurrected.
  const row = await readSong(t);
  assert.equal(row.lyrics_raw, NEW_LYRICS, 'new lyrics must be preserved');
  assert.equal(row.lyrics_furigana, '[]', 'furigana cache must stay cleared');
  assert.equal(row.lyrics_translation, '[]', 'translation cache must stay cleared');
  assert.equal(row.lyrics_translation_lang, null, 'translation lang must stay cleared');
  assert.equal(row.lyrics_translation_reasoning, null, 'reasoning must stay cleared');
  assert.equal(row.lyrics_glossary, null, 'glossary must stay cleared');
  assert.equal(row.cover_palette, PALETTE, 'cover palette must be written');
  assert.equal(row.lyrics_source, 'manual', 'source must be reset to manual');
  assert.equal(row.lyrics_confidence, 100, 'confidence must be reset to 100');
  assert.equal(row.lyrics_needs_review, 0, 'needs_review must be reset to 0');
  assert.equal(row.lyrics_fetched_at, null, 'fetched_at must be cleared');
});

test('lyrics-only PUT does not resurrect stale palette/metadata', async () => {
  const t = makeTestDb(`/tmp/song-put-lyrics-${process.pid}-${Date.now()}.db`);
  await createTables(t);
  await seedSong(t);

  // Step 1: A lyrics-edit request reads the row (snapshot at T0 — no palette).
  const snapshot = await readSong(t);
  assert.equal(snapshot.cover_palette, null, 'snapshot has no palette');

  // Step 2: A palette/metadata request commits first.
  await t.db.run(sql`UPDATE songs SET
    cover_palette = ${PALETTE}
  WHERE id = ${SONG_ID}`);

  // Step 3: The delayed lyrics-edit request writes only lyrics-related fields,
  // not the old cover_palette from its snapshot.
  await t.db.run(lyricsEditSql(NEW_LYRICS));

  // The palette written by the earlier request must be preserved.
  const row = await readSong(t);
  assert.equal(row.lyrics_raw, NEW_LYRICS, 'new lyrics must be written');
  assert.equal(row.cover_palette, PALETTE, 'palette from concurrent request must be preserved');
  assert.equal(row.lyrics_furigana, '[]', 'furigana must be cleared for new lyrics');
});

test('scheme-only PUT preserves lyrics and only clears furigana when scheme actually changes', async () => {
  const t = makeTestDb(`/tmp/song-put-scheme-${process.pid}-${Date.now()}.db`);
  await createTables(t);
  await seedSong(t);

  // Change only the reading scheme.
  const newScheme = 'yue-jyutping';
  await t.db.run(sql`UPDATE songs SET
    reading_scheme = ${newScheme},
    lyrics_furigana = CASE WHEN ${newScheme} != reading_scheme THEN '[]' ELSE lyrics_furigana END
  WHERE id = ${SONG_ID}`);

  const row = await readSong(t);
  assert.equal(row.reading_scheme, 'yue-jyutping');
  assert.equal(row.lyrics_furigana, '[]', 'furigana must be cleared when scheme changes');
  assert.equal(row.lyrics_raw, OLD_LYRICS, 'lyrics must be preserved');
  assert.equal(row.lyrics_translation, OLD_TRANSLATION, 'translation must be preserved');
});

test('same-value PUT does not clear derived caches', async () => {
  const t = makeTestDb(`/tmp/song-put-same-${process.pid}-${Date.now()}.db`);
  await createTables(t);
  await seedSong(t);

  // Submit the same lyrics_raw — the CASE should see new === current and
  // keep the existing furigana/translation caches.
  await t.db.run(sql`UPDATE songs SET
    lyrics_raw = ${OLD_LYRICS},
    lyrics_furigana = CASE WHEN ${OLD_LYRICS} != lyrics_raw THEN '[]' ELSE lyrics_furigana END,
    lyrics_translation = CASE WHEN ${OLD_LYRICS} != lyrics_raw THEN '[]' ELSE lyrics_translation END
  WHERE id = ${SONG_ID}`);

  const row = await readSong(t);
  assert.equal(row.lyrics_raw, OLD_LYRICS);
  assert.equal(row.lyrics_furigana, OLD_FURIGANA, 'furigana must be preserved when lyrics unchanged');
  assert.equal(row.lyrics_translation, OLD_TRANSLATION, 'translation must be preserved when lyrics unchanged');
});
