import test from 'node:test';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { createTestDb, prepareTestDb } from './test-db.ts';
import { sql } from 'drizzle-orm';
import {
  existingResultsForChunk,
  getPersistedTrackResults,
  listFailedTrackSlots,
  listTrackResults,
  saveTrackResult,
} from './playlist-import.ts';
import {
  playlistImportJobs,
  playlistImportTrackResults,
} from './schema.ts';

/**
 * Idempotency + concurrency tests for `saveTrackResult` (ISSUE #212, ISSUE #347).
 *
 * #212 — the job-counter UPDATE ran unconditionally BEFORE the idempotent
 * INSERT, so retrying or concurrently submitting the same chunk kept bumping
 * `processed/imported/skipped/failed` even though the track-result row already
 * existed — the counters drifted above the real number of rows and could exceed
 * `total`. Fix: insert the track-result row FIRST (ON CONFLICT DO NOTHING) and
 * only bump the job counters when the INSERT actually added a NEW row.
 *
 * #347 — the row identity was the Spotify track id, so a playlist containing the
 * same song twice collapsed the second slot into the first: the INSERT hit
 * ON CONFLICT and `processed` could never reach `total`. Fix: the row identity
 * is now the playlist slot `(jobId, trackIndex)`, while the "first write wins,
 * duplicates are a no-op" semantics stay exactly the same.
 *
 * Uses a real local libsql DB (same driver family as D1), one connection per
 * "request" to mirror Cloudflare D1 where every Worker request has its own
 * binding; concurrent writers serialise on the write lock via the busy timeout.
 */

type TestDb = ReturnType<typeof makeTestDb>;

function makeTestDb(ctx: TestContext, label: string) {
  return createTestDb(ctx, label, { playlistImportJobs, playlistImportTrackResults });
}

async function createTables(t: TestDb) {
  await prepareTestDb(t.client);
  await t.db.run(sql`CREATE TABLE playlist_import_jobs (
    id TEXT PRIMARY KEY,
    user_email TEXT NOT NULL,
    playlist_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    total INTEGER NOT NULL DEFAULT 0,
    processed INTEGER NOT NULL DEFAULT 0,
    imported INTEGER NOT NULL DEFAULT 0,
    skipped INTEGER NOT NULL DEFAULT 0,
    failed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`);
  // Mirrors migrations 0022/0023: rows are identified by playlist slot, and
  // (job_id, track_index) is unique.
  // Mirrors migrations 0022/0023/0025: slot identity, unique `(job_id, track_index)`
  // and the persisted "why it failed" flag (ISSUE #325).
  await t.db.run(sql`CREATE TABLE playlist_import_track_results (
    job_id TEXT NOT NULL,
    spotify_track_id TEXT NOT NULL,
    track_index INTEGER NOT NULL DEFAULT 0,
    title TEXT NOT NULL,
    artist TEXT NOT NULL,
    status TEXT NOT NULL,
    needs_review INTEGER NOT NULL DEFAULT 0,
    rate_limited INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`);
  await t.db.run(sql`CREATE UNIQUE INDEX playlist_import_track_results_job_track_idx
    ON playlist_import_track_results (job_id, track_index)`);
}

async function insertJob(t: TestDb, id: string, total = 1) {
  await t.db.insert(playlistImportJobs).values({
    id,
    userEmail: 'u@example.com',
    playlistId: 'p1',
    status: 'pending',
    total,
    processed: 0,
    imported: 0,
    skipped: 0,
    failed: 0,
  }).run();
}

async function getJob(t: TestDb, id: string) {
  const row = await t.db.select().from(playlistImportJobs).where(sql`${playlistImportJobs.id} = ${id}`).get();
  assert.ok(row, `job ${id} must exist`);
  return row;
}

const track = { id: 'track-1', uri: 'spotify:track:track-1', title: 'Song', artist: 'Artist', album: '', durationMs: 200000, coverUrl: null };

test('a fresh insert increments counters once', async (ctx) => {
  const t = makeTestDb(ctx, 'pi-fresh');
  await createTables(t);
  await insertJob(t, 'j');

  await saveTrackResult('j', 0, track, { status: 'imported' }, t.db);

  const job = await getJob(t, 'j');
  assert.equal(job.processed, 1);
  assert.equal(job.imported, 1);
  assert.equal(job.skipped, 0);
  assert.equal(job.failed, 0);
  assert.equal(job.status, 'running');

  const rows = await t.db.select().from(playlistImportTrackResults).all();
  assert.equal(rows.length, 1);
});

test('a duplicate submit is an idempotent no-op for counters', async (ctx) => {
  const t = makeTestDb(ctx, 'pi-dup');
  await createTables(t);
  await insertJob(t, 'j');

  await saveTrackResult('j', 0, track, { status: 'imported' }, t.db);
  // Retry the exact same (job, track) — must NOT double-count.
  await saveTrackResult('j', 0, track, { status: 'imported' }, t.db);

  const job = await getJob(t, 'j');
  assert.equal(job.processed, 1, 'processed must not grow on retry');
  assert.equal(job.imported, 1, 'imported must not grow on retry');

  const rows = await t.db.select().from(playlistImportTrackResults).all();
  assert.equal(rows.length, 1, 'still exactly one track-result row');
});

test('sequential re-order retries are idempotent', async (ctx) => {
  const t = makeTestDb(ctx, 'pi-order');
  await createTables(t);
  await insertJob(t, 'j');

  await saveTrackResult('j', 0, track, { status: 'skipped' }, t.db);
  // Same track delivered again with a different status — the first row wins,
  // counters must reflect only the first (skipped) write.
  await saveTrackResult('j', 0, track, { status: 'imported' }, t.db);

  const job = await getJob(t, 'j');
  assert.equal(job.processed, 1);
  assert.equal(job.skipped, 1);
  assert.equal(job.imported, 0);

  const rows = await t.db.select().from(playlistImportTrackResults).all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'skipped');
});

test('concurrent duplicate submits never over-count', async (ctx) => {
  const t = makeTestDb(ctx, 'pi-conc');
  await createTables(t);
  await insertJob(t, 'j');

  // 8 concurrent "requests", each with its own connection, all submitting the
  // same (job, track). Exactly one must win the insert and the counter bump.
  const attempts = 8;
  await Promise.all(Array.from({ length: attempts }, async () => {
    const own = t.open();
    try {
      await own.client.execute('PRAGMA busy_timeout=15000');
      await saveTrackResult('j', 0, track, { status: 'imported' }, own.db);
    } finally {
      own.close();
    }
  }));

  const job = await getJob(t, 'j');
  assert.equal(job.processed, 1, 'processed must be 1 despite concurrent retries');
  assert.equal(job.imported, 1);

  const rows = await t.db.select().from(playlistImportTrackResults).all();
  assert.equal(rows.length, 1);
});

test('mixed statuses count independently and sum to processed', async (ctx) => {
  const t = makeTestDb(ctx, 'pi-mixed');
  await createTables(t);
  await insertJob(t, 'j', 3);

  const t1 = { ...track, id: 'a' };
  const t2 = { ...track, id: 'b' };
  const t3 = { ...track, id: 'c' };

  await saveTrackResult('j', 0, t1, { status: 'imported' }, t.db);
  await saveTrackResult('j', 1, t2, { status: 'skipped' }, t.db);
  await saveTrackResult('j', 2, t3, { status: 'failed' }, t.db);
  // A duplicate retry of an already-failed track must not move anything.
  await saveTrackResult('j', 2, t3, { status: 'imported' }, t.db);

  const job = await getJob(t, 'j');
  assert.equal(job.processed, 3);
  assert.equal(job.imported, 1);
  assert.equal(job.skipped, 1);
  assert.equal(job.failed, 1);
  assert.equal(job.imported + job.skipped + job.failed, job.processed,
    'classification counters must sum to processed');

  const rows = await t.db.select().from(playlistImportTrackResults).all();
  assert.equal(rows.length, 3);
});

test('the same song in two playlist slots counts twice (ISSUE #347)', async (ctx) => {
  const t = makeTestDb(ctx, 'pi-dup-track');
  await createTables(t);
  // Playlist [A, B, A] — the third slot repeats the first track.
  await insertJob(t, 'j', 3);

  await saveTrackResult('j', 0, { ...track, id: 'a' }, { status: 'imported' }, t.db);
  await saveTrackResult('j', 1, { ...track, id: 'b' }, { status: 'imported' }, t.db);
  await saveTrackResult('j', 2, { ...track, id: 'a' }, { status: 'imported' }, t.db);

  const job = await getJob(t, 'j');
  assert.equal(job.processed, 3, 'every playlist slot must be counted');
  assert.equal(job.total, 3);
  assert.equal(job.imported, 3);
  assert.equal(job.imported + job.skipped + job.failed, job.total,
    'the summary must add up to total (no more "completed but 2/3")');

  const rows = await t.db.select().from(playlistImportTrackResults).all();
  assert.equal(rows.length, 3, 'one row per slot, even for a repeated track id');
});

test('an INSERT failure leaves the counters untouched (no counted-but-no-result)', async (ctx) => {
  const t = makeTestDb(ctx, 'pi-fail');
  await createTables(t);
  await insertJob(t, 'j');

  // Force the INSERT to fail by dropping the result table before saving.
  await t.db.run(sql`DROP TABLE playlist_import_track_results`);
  await assert.rejects(
    () => saveTrackResult('j', 0, track, { status: 'imported' }, t.db),
  );

  // Because the insert runs first and failed, the counters were never bumped —
  // the old "counted but no result" inconsistency can no longer happen.
  const job = await getJob(t, 'j');
  assert.equal(job.processed, 0);
  assert.equal(job.imported, 0);
  assert.equal(job.status, 'pending');
});

test('a rate-limited failure keeps its reason across a resume (ISSUE #325)', async (ctx) => {
  const t = makeTestDb(ctx, 'pi-ratelimit');
  await createTables(t);
  await insertJob(t, 'j', 2);

  await saveTrackResult('j', 0, track, { status: 'failed', rateLimited: true }, t.db);
  await saveTrackResult('j', 1, { ...track, id: 'track-2' }, { status: 'failed' }, t.db);

  // The replay read is what a resumed chunk and a refreshed page go through: a
  // rate-limited slot must come back as rate-limited, not as a plain failure.
  const chunk = await existingResultsForChunk('j', 0, 2, t.db);
  assert.equal(chunk.get(0)?.rateLimited, true);
  assert.equal(chunk.get(1)?.rateLimited, false);

  const persisted = await getPersistedTrackResults('j', t.db);
  assert.equal(persisted.results[0].rateLimited, true);
  assert.equal(persisted.results[1].rateLimited, false);

  const listed = await listTrackResults('j', t.db);
  assert.equal(listed[0].rateLimited, true, 'GET rebuild must carry the flag');
  assert.equal(listed[0].trackIndex, 0, 'each result carries its slot');
  assert.equal(listed[1].rateLimited, undefined, 'a plain failure stays plain');
});

test('listFailedTrackSlots returns the recoverable failures in slot order (ISSUE #325)', async (ctx) => {
  const t = makeTestDb(ctx, 'pi-failed-slots');
  await createTables(t);
  await insertJob(t, 'j', 4);

  await saveTrackResult('j', 0, { ...track, id: 'a' }, { status: 'imported' }, t.db);
  await saveTrackResult('j', 1, { ...track, id: 'b' }, { status: 'failed', rateLimited: true }, t.db);
  await saveTrackResult('j', 2, { ...track, id: 'c' }, { status: 'failed' }, t.db);
  await saveTrackResult('j', 3, { ...track, id: 'd' }, { status: 'failed', rateLimited: true }, t.db);

  const failed = await listFailedTrackSlots('j', t.db);
  assert.deepEqual(failed, [
    { trackIndex: 1, rateLimited: true },
    { trackIndex: 2, rateLimited: false },
    { trackIndex: 3, rateLimited: true },
  ], 'failed slots only, in playlist order, with their reason');
});

test('an explicit retry overwrites the row and recounts the counters (ISSUE #325)', async (ctx) => {
  const t = makeTestDb(ctx, 'pi-retry');
  await createTables(t);
  await insertJob(t, 'j', 2);

  await saveTrackResult('j', 0, { ...track, id: 'a' }, { status: 'failed', rateLimited: true }, t.db);
  await saveTrackResult('j', 1, { ...track, id: 'b' }, { status: 'imported' }, t.db);

  // The retry re-processes slot 0 and succeeds: the row flips to imported and the
  // counters are recounted from the result table, so the slot is never counted
  // twice and `failed` drops back to 0.
  await saveTrackResult('j', 0, { ...track, id: 'a' }, { status: 'imported' }, t.db, { overwrite: true });

  const job = await getJob(t, 'j');
  assert.equal(job.processed, 2, 'retry must not add a second processed count');
  assert.equal(job.imported, 2);
  assert.equal(job.failed, 0);
  assert.equal(job.processed, job.total);

  const rows = await t.db.select().from(playlistImportTrackResults).all();
  assert.equal(rows.length, 2, 'the retried slot reuses its row');
  const retried = rows.find((row) => row.trackIndex === 0);
  assert.equal(retried?.status, 'imported');
  assert.equal(retried?.rateLimited, 0, 'a success clears the stored reason');
});

test('a retry that is still rate-limited keeps the flag and the counters stable (ISSUE #325)', async (ctx) => {
  const t = makeTestDb(ctx, 'pi-retry-still');
  await createTables(t);
  await insertJob(t, 'j', 1);

  await saveTrackResult('j', 0, track, { status: 'failed', rateLimited: true }, t.db);
  // Retry too early: the source is still limiting, so the slot stays failed.
  await saveTrackResult('j', 0, track, { status: 'failed', rateLimited: true }, t.db, { overwrite: true });

  const job = await getJob(t, 'j');
  assert.equal(job.processed, 1);
  assert.equal(job.failed, 1);

  const rows = await t.db.select().from(playlistImportTrackResults).all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].rateLimited, 1, 'the reason survives a failed retry');
});
