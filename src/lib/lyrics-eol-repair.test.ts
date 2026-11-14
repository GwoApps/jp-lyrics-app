import test from 'node:test';
import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import type { TestContext } from 'node:test';
import { createTestDb, createSongsTable } from './test-db.ts';
import { healLegacyLyricsEol } from './lyrics-eol-repair.ts';

/**
 * Issue #421: the CRLF-to-LF sweep runs by itself at startup (Node / Turso /
 * local SQLite) and on the first D1 request per isolate — there is no separate
 * migration script. These tests drive it against a real libSQL database.
 */

function makeDb(ctx: TestContext) {
  return createTestDb(ctx, 'lyrics-eol', {});
}

async function insertSong(
  t: ReturnType<typeof makeDb>,
  id: string,
  row: { raw: string; synced?: string; furigana?: string },
) {
  await t.db.run(sql`INSERT INTO songs (id, title, lyrics_raw, lyrics_synced, lyrics_furigana)
    VALUES (${id}, 'T', ${row.raw}, ${row.synced ?? ''}, ${row.furigana ?? '[]'})`);
}

async function readSong(t: ReturnType<typeof makeDb>, id: string) {
  const row = await t.db.get(sql`SELECT lyrics_raw, lyrics_synced, lyrics_furigana, updated_at FROM songs WHERE id = ${id}`);
  return row as Record<string, string>;
}

test('legacy CRLF rows are folded, synced LRC included, caches re-shaped', async (ctx) => {
  const t = makeDb(ctx);
  await createSongsTable(t.client);
  const furigana = JSON.stringify([
    { segments: [{ text: '夜に駆ける\r', reading: 'よるにかける' }] },
    { segments: [{ text: '沈むように\r', reading: 'しずむように' }] },
    { segments: [] },
  ]);
  await insertSong(t, 'legacy', {
    raw: '夜に駆ける\r\n沈むように\r\n',
    synced: '[00:01.00] 夜に駆ける\r\n[00:02.00] 沈むように\r\n',
    furigana,
  });
  await insertSong(t, 'clean', { raw: 'きれいな行\nもう一行' });

  const summary = await healLegacyLyricsEol(t.db);
  assert.deepEqual(summary, { scanned: 1, repaired: 1, refolded: 1, cleared: 0 });

  const legacy = await readSong(t, 'legacy');
  assert.equal(legacy.lyrics_raw, '夜に駆ける\n沈むように\n');
  assert.equal(legacy.lyrics_synced, '[00:01.00] 夜に駆ける\n[00:02.00] 沈むように\n');
  assert.equal(legacy.lyrics_furigana.includes('\r'), false);
  const clean = await readSong(t, 'clean');
  assert.equal(clean.lyrics_raw, 'きれいな行\nもう一行', 'LF rows are untouched');
});

test('the sweep does not bump updated_at (it is a format fix, not an edit)', async (ctx) => {
  const t = makeDb(ctx);
  await createSongsTable(t.client);
  await insertSong(t, 's', { raw: 'a\r\nb' });
  await t.db.run(sql`UPDATE songs SET updated_at = '2026-01-01T00:00:00.000Z' WHERE id = 's'`);
  await healLegacyLyricsEol(t.db);
  assert.equal((await readSong(t, 's')).updated_at, '2026-01-01T00:00:00.000Z');
});

test('a cache that no longer describes the folded lyrics is dropped', async (ctx) => {
  const t = makeDb(ctx);
  await createSongsTable(t.client);
  await insertSong(t, 's', {
    raw: '本物の歌詞\r\n二行目\r\n',
    furigana: JSON.stringify([
      { segments: [{ text: '無関係\r', reading: 'x' }] },
      { segments: [{ text: '別物\r', reading: 'y' }] },
    ]),
  });
  const summary = await healLegacyLyricsEol(t.db);
  assert.equal(summary.cleared, 1);
  assert.equal((await readSong(t, 's')).lyrics_furigana, '[]');
});

test('a cache left behind by a CRLF row is repaired even when the lyrics are already LF', async (ctx) => {
  // The lyrics were rewritten through a folded write path, but the annotation
  // cache still describes the CRLF shape — the exact combination behind the
  // `seaglass` song, whose save kept answering `furigana_source_mismatch`.
  const t = makeDb(ctx);
  await createSongsTable(t.client);
  await insertSong(t, 's', {
    raw: '夜に駆ける\n沈むように',
    furigana: JSON.stringify([
      { segments: [{ text: '夜に駆ける\r', reading: 'よるにかける' }] },
      { segments: [{ text: '沈むように\r', reading: 'しずむように' }] },
    ]),
  });
  const summary = await healLegacyLyricsEol(t.db);
  assert.equal(summary.refolded, 1);
  const row = await readSong(t, 's');
  assert.equal(row.lyrics_raw, '夜に駆ける\n沈むように', 'lyrics already LF are untouched');
  assert.equal(row.lyrics_furigana.includes('\r'), false);
});

test('running the sweep twice is a no-op', async (ctx) => {
  const t = makeDb(ctx);
  await createSongsTable(t.client);
  await insertSong(t, 's', { raw: 'a\r\nb', synced: '[00:01.00]a\r' });
  assert.equal((await healLegacyLyricsEol(t.db)).repaired, 1);
  assert.deepEqual(await healLegacyLyricsEol(t.db), { scanned: 0, repaired: 0, refolded: 0, cleared: 0 });
});

test('a concurrent write that already rewrote the row wins (CAS, no clobber)', async (ctx) => {
  const t = makeDb(ctx);
  await createSongsTable(t.client);
  await insertSong(t, 's', { raw: 'old\r\nrow' });
  // Someone else commits a new lyrics document between the scan and the UPDATE.
  const other = t.open();
  await other.db.run(sql`UPDATE songs SET lyrics_raw = 'new text' WHERE id = 's'`);
  const summary = await healLegacyLyricsEol(t.db);
  assert.equal(summary.repaired, 0, 'the sweep must not overwrite a newer document');
  assert.equal((await readSong(t, 's')).lyrics_raw, 'new text');
});
