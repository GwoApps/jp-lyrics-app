import test from 'node:test';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { createTestDb, createSongsTable } from './test-db.ts';
import { sql } from 'drizzle-orm';
import { applySyncWrite, resolveSyncBaseline } from './sync-write.ts';
import { songs } from './schema.ts';

/**
 * CAS persistence tests for the lyrics-sync route (issue #120).
 *
 * The sync endpoint used to write fetched lyrics unconditionally — a request
 * started in tab B while tab A edited the song would silently clobber the
 * newer lyrics AND wipe the derived caches (furigana / translation /
 * glossary). Covers the two guards added:
 *   1. `resolveSyncBaseline` fast-fails a request whose `source_lyrics`
 *      snapshot no longer matches the stored lyrics (before any fetch);
 *   2. `applySyncWrite` persists under `id AND lyrics_raw = <snapshot>` and
 *      refuses (`stale_source`) when the lyrics moved on mid-flight —
 *      leaving lyricsRaw / lyricsSynced and every derived cache untouched.
 *
 * Uses a real local libsql DB (same driver family as D1) like the
 * translation-cache tests.
 */

type TestDb = ReturnType<typeof makeTestDb>;

function makeTestDb(ctx: TestContext, label: string) {
  return createTestDb(ctx, label, { songs });
}

const SONG_ID = 'song-sync-1';
const OLD_LYRICS = 'line one\nline two\nline three';
const OLD_SYNCED = '[00:01.000]line one\n[00:02.000]line two\n[00:03.000]line three';
const NEW_LYRICS = 'brand new line one\nbrand new line two';
const NEW_SYNCED = '[00:01.000]brand new line one\n[00:02.000]brand new line two';

async function seedSong(t: TestDb) {
  await t.db.insert(songs).values({
    id: SONG_ID,
    title: 'Test',
    artist: 'Artist',
    lyricsRaw: OLD_LYRICS,
    lyricsSynced: OLD_SYNCED,
    // Derived caches the user has already confirmed / paid AI quota for.
    lyricsFurigana: '["か","な",""]',
    lyricsTranslation: '["译一","译二","译三"]',
    lyricsTranslationReasoning: 'reasoning',
    lyricsGlossary: 'glossary',
  }).run();
}

async function readSong(t: TestDb) {
  return t.db.select({
    lyricsRaw: songs.lyricsRaw,
    lyricsSynced: songs.lyricsSynced,
    lyricsFurigana: songs.lyricsFurigana,
    lyricsTranslation: songs.lyricsTranslation,
    lyricsTranslationReasoning: songs.lyricsTranslationReasoning,
    lyricsGlossary: songs.lyricsGlossary,
    lyricsSource: songs.lyricsSource,
    lyricsNeedsReview: songs.lyricsNeedsReview,
  }).from(songs).where(sql`id = ${SONG_ID}`).get() as Promise<{
    lyricsRaw: string;
    lyricsSynced: string;
    lyricsFurigana: string;
    lyricsTranslation: string;
    lyricsTranslationReasoning: string | null;
    lyricsGlossary: string | null;
    lyricsSource: string;
    lyricsNeedsReview: number;
  } | undefined>;
}

function syncPatch() {
  return {
    lyricsRaw: NEW_LYRICS,
    lyricsSynced: NEW_SYNCED,
    lyricsSource: 'utaten',
    lyricsConfidence: 90,
    lyricsNeedsReview: 0,
    lyricsFetchedAt: '2026-08-16T00:00:00.000Z',
    lyricsFurigana: '[]',
    lyricsTranslation: '[]',
    lyricsTranslationReasoning: null,
    lyricsGlossary: null,
  };
}

test('resolveSyncBaseline accepts a snapshot matching the stored lyrics', () => {
  const result = resolveSyncBaseline(OLD_LYRICS, OLD_LYRICS);
  assert.deepEqual(result, { ok: true, sourceLyrics: OLD_LYRICS });
});

test('resolveSyncBaseline rejects a missing / non-string snapshot', () => {
  assert.deepEqual(resolveSyncBaseline(undefined, OLD_LYRICS), { ok: false, error: 'missing_source_lyrics' });
  assert.deepEqual(resolveSyncBaseline(42, OLD_LYRICS), { ok: false, error: 'missing_source_lyrics' });
});

test('resolveSyncBaseline rejects a snapshot that no longer matches the stored lyrics', () => {
  assert.deepEqual(resolveSyncBaseline(OLD_LYRICS, 'someone else rewrote this'), {
    ok: false,
    error: 'stale_source',
  });
});

test('applySyncWrite commits the fetched result and clears derived caches when the baseline matches', async (ctx) => {
  const t = makeTestDb(ctx, 'sync-write-commit');
  await createSongsTable(t.client);
  await seedSong(t);

  const result = await applySyncWrite(t.db, { id: SONG_ID, sourceLyrics: OLD_LYRICS, patch: syncPatch() });
  assert.deepEqual(result, { ok: true });

  const row = await readSong(t);
  assert.equal(row?.lyricsRaw, NEW_LYRICS);
  assert.equal(row?.lyricsSynced, NEW_SYNCED);
  assert.equal(row?.lyricsSource, 'utaten');
  assert.equal(row?.lyricsNeedsReview, 0);
  // The wiped caches: user-confirmed furigana + consumed-AI-quota translation.
  assert.equal(row?.lyricsFurigana, '[]');
  assert.equal(row?.lyricsTranslation, '[]');
  assert.equal(row?.lyricsTranslationReasoning, null);
  assert.equal(row?.lyricsGlossary, null);
});

test('applySyncWrite refuses (stale_source) and leaves every column untouched when lyrics were edited mid-flight', async (ctx) => {
  const t = makeTestDb(ctx, 'sync-write-stale');
  await createSongsTable(t.client);
  await seedSong(t);

  // Another tab edits the lyrics while the sync fetch is in flight — the
  // edit API rewrites lyrics_raw (and clears the translation cache).
  const editedLyrics = 'line one EDITED\nline two\nline three';
  await t.db.update(songs).set({
    lyricsRaw: editedLyrics,
    lyricsTranslation: '[]',
  }).where(sql`id = ${SONG_ID}`).run();

  const result = await applySyncWrite(t.db, { id: SONG_ID, sourceLyrics: OLD_LYRICS, patch: syncPatch() });
  assert.deepEqual(result, { ok: false, reason: 'stale_source' });

  // NOTHING was persisted — not the fetched lyrics, not the cache wipe.
  const row = await readSong(t);
  assert.equal(row?.lyricsRaw, editedLyrics);
  assert.equal(row?.lyricsSynced, OLD_SYNCED);
  assert.equal(row?.lyricsFurigana, '["か","な",""]');
  assert.equal(row?.lyricsTranslation, '[]'); // cleared by the edit, not by sync
  assert.equal(row?.lyricsTranslationReasoning, 'reasoning');
  assert.equal(row?.lyricsGlossary, 'glossary');
});

test('applySyncWrite refuses (stale_source) when a concurrent sync already won the race', async (ctx) => {
  const t = makeTestDb(ctx, 'sync-write-race');
  await createSongsTable(t.client);
  await seedSong(t);

  // A concurrent request (started from the same baseline) committed first.
  await applySyncWrite(t.db, { id: SONG_ID, sourceLyrics: OLD_LYRICS, patch: syncPatch() });
  assert.equal((await readSong(t))?.lyricsRaw, NEW_LYRICS);

  // This request's CAS matches no row — the newer lyrics stay untouched.
  const result = await applySyncWrite(t.db, { id: SONG_ID, sourceLyrics: OLD_LYRICS, patch: syncPatch() });
  assert.deepEqual(result, { ok: false, reason: 'stale_source' });
  const row = await readSong(t);
  assert.equal(row?.lyricsRaw, NEW_LYRICS);
  assert.equal(row?.lyricsSynced, NEW_SYNCED);
});
