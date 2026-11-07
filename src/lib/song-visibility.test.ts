import test from 'node:test';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import type { Client } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { createTestDb } from './test-db.ts';
import { and, sql, type SQL } from 'drizzle-orm';
import { isSongVisibleToUser, songVisibilityWhere, SONGS_S_COLUMNS } from './song-visibility.ts';

const admin = { id: 'admin@example.com', isAdmin: true };
const owner = { id: 'owner@example.com', isAdmin: false };
const stranger = { id: 'stranger@example.com', isAdmin: false };

test('public songs are visible to everyone, including anonymous users', () => {
  assert.equal(isSongVisibleToUser({ is_public: 1, created_by: 'owner@example.com' }, null), true);
  assert.equal(isSongVisibleToUser({ is_public: 1, created_by: 'owner@example.com' }, stranger), true);
  assert.equal(isSongVisibleToUser({ isPublic: 1, createdBy: 'owner@example.com' }, stranger), true);
});

test('private songs are visible only to their owner', () => {
  assert.equal(isSongVisibleToUser({ is_public: 0, created_by: 'owner@example.com' }, owner), true);
  assert.equal(isSongVisibleToUser({ is_public: 0, created_by: 'owner@example.com' }, stranger), false);
  // is_public omitted (default 0 in schema) → still private
  assert.equal(isSongVisibleToUser({ created_by: 'owner@example.com' }, stranger), false);
});

test('admin can read any song', () => {
  assert.equal(isSongVisibleToUser({ is_public: 0, created_by: 'owner@example.com' }, admin), true);
  assert.equal(isSongVisibleToUser({ is_public: 0, created_by: 'stranger@example.com' }, admin), true);
});

test('anonymous users cannot read private songs', () => {
  assert.equal(isSongVisibleToUser({ is_public: 0, created_by: 'owner@example.com' }, null), false);
});

test('missing or null songs are never visible', () => {
  assert.equal(isSongVisibleToUser(null, admin), false);
  assert.equal(isSongVisibleToUser(undefined, admin), false);
});

// --- SQL predicate parity (ISSUE #346) -------------------------------------
// The list queries in GET /api/songs compose `songVisibilityWhere` into their
// WHERE clause, so the predicate (not each branch) is what decides who sees a
// private song. These tests pin its shape: which columns it compares, which
// params it binds and that the anonymous case binds nothing at all.

/**
 * Structural read-out of a drizzle `SQL` chunk tree: gives back the predicate
 * text (column names + operators, params as `:value`) and the bound params.
 * Reads the chunk tree rather than a driver-rendered string so the assertions
 * stay valid across drizzle versions.
 */
function describePredicate(where: ReturnType<typeof songVisibilityWhere>): { text: string; params: unknown[] } {
  assert.ok(where, 'expected a predicate (undefined = unrestricted)');
  const params: unknown[] = [];
  const render = (chunk: unknown): string => {
    const c = chunk as { value?: unknown; queryChunks?: unknown[]; constructor: { name: string } };
    if (c.constructor.name === 'Param') {
      params.push(c.value);
      return `:${String(c.value)}`;
    }
    if (Array.isArray(c.queryChunks)) return c.queryChunks.map(render).join('');
    if (c.constructor.name === 'SQLiteInteger') return 'is_public';
    if (c.constructor.name === 'SQLiteText') return 'created_by';
    if (Array.isArray(c.value)) return c.value.join('');
    return String(c.value ?? '');
  };
  return { text: render(where), params };
}

test('songVisibilityWhere: anonymous viewers are restricted to is_public = 1', () => {
  const { text, params } = describePredicate(songVisibilityWhere(null));
  assert.equal(text, 'is_public = 1');
  // No `created_by` comparison at all — an empty owner must never match.
  assert.deepEqual(params, []);
});

test('songVisibilityWhere: a logged-in non-admin also sees their own songs', () => {
  const { text, params } = describePredicate(songVisibilityWhere({ email: 'me@example.com', isAdmin: false }));
  assert.equal(text, '(is_public = 1 or created_by = :me@example.com)');
  assert.deepEqual(params, ['me@example.com']);
});

test('songVisibilityWhere: an empty/absent email stays public-only', () => {
  for (const viewer of [null, undefined, {}, { email: '' }, { email: null }]) {
    const { text, params } = describePredicate(songVisibilityWhere(viewer));
    assert.equal(text, 'is_public = 1');
    assert.deepEqual(params, []);
  }
});

test('songVisibilityWhere: admins get no restriction at all', () => {
  const { text, params } = describePredicate(songVisibilityWhere({ email: 'admin@example.com', isAdmin: true }));
  // The tautology, NOT `undefined`: see the raw-SQL execution tests below.
  assert.equal(text, '1 = 1');
  assert.deepEqual(params, []);
});

// --- Executable-SQL regression (2026-10-08 admin song-list outage) -----------
// `songVisibilityWhere` used to return `undefined` for admins, and every list
// endpoint interpolated it straight into a template: `WHERE ${and(...)}`.
// drizzle renders an interpolated `undefined` as '', so an admin's query became
// `WHERE \n ORDER BY ...` → SQLITE_ERROR "near ORDER" → HTTP 500 on the whole
// song list (also /api/songs?favorites=1, /api/spotify/match-song and
// /api/collections/[id]/songs). Non-admins never saw it because their branch
// always had a real predicate.
//
// These tests execute the SAME composition the routes use against a real
// libsql DB, so an `undefined` predicate fails here instead of in production.

const VIEWERS = [
  { name: 'anonymous', viewer: null },
  { name: 'no-email', viewer: {} },
  { name: 'non-admin', viewer: { email: 'me@example.com', isAdmin: false } },
  { name: 'admin', viewer: { email: 'admin@example.com', isAdmin: true } },
] as const;

function makeSongsDb(ctx: TestContext, tag: string) {
  return createTestDb(ctx, `song-visibility-${tag}`, {});
}

async function createSongs(client: Client) {
  await client.execute(`CREATE TABLE songs (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    is_public INTEGER NOT NULL DEFAULT 0,
    created_by TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT ''
  )`);
  await client.execute(`INSERT INTO songs (id, title, is_public, created_by, updated_at) VALUES
    ('public-1', 'public song', 1, 'someone@example.com', '2026-01-01'),
    ('mine-1',   'my private',  0, 'me@example.com',       '2026-01-02'),
    ('other-1',  'other priv',  0, 'other@example.com',    '2026-01-03')`);
}

/** GET /api/songs: the `and(...filters)` composition (admin has NO other filter). */
async function runListQuery(db: ReturnType<typeof drizzle>, viewer: Parameters<typeof songVisibilityWhere>[0]) {
  const filters: (SQL | undefined)[] = [undefined, undefined, songVisibilityWhere(viewer)];
  return db.all(sql`SELECT id FROM songs WHERE ${and(...filters)} ORDER BY updated_at DESC`);
}

/** /api/spotify/match-song + /api/collections/[id]/songs: `WHERE ${and(pred)}`. */
async function runSinglePredicateQuery(db: ReturnType<typeof drizzle>, viewer: Parameters<typeof songVisibilityWhere>[0]) {
  return db.all(sql`SELECT id FROM songs WHERE ${and(songVisibilityWhere(viewer))}`);
}

test('songVisibilityWhere composes into executable SQL for every viewer shape', async (ctx) => {
  const t = makeSongsDb(ctx, 'exec');
  await createSongs(t.client);
  for (const { name, viewer } of VIEWERS) {
    const list = await runListQuery(t.db, viewer).catch((e: unknown) => {
      assert.fail(`list query threw for ${name}: ${String(e)}`);
    });
    const single = await runSinglePredicateQuery(t.db, viewer).catch((e: unknown) => {
      assert.fail(`single-predicate query threw for ${name}: ${String(e)}`);
    });
    assert.ok(list.length >= 1, `${name}: list query returned no rows`);
    assert.ok(single.length >= 1, `${name}: single-predicate query returned no rows`);
  }
});

test('songVisibilityWhere executes in song-list SQL with the songs s alias', async (ctx) => {
  const t = makeSongsDb(ctx, 'aliased-list');
  await createSongs(t.client);
  for (const { name, viewer } of VIEWERS) {
    // GET /api/songs and collection GET both use FROM songs s. An unaliased
    // schema column in the predicate raises "no such column: songs.is_public".
    const rows = await t.db.all(sql`
      SELECT s.id FROM songs s
      WHERE ${and(songVisibilityWhere(viewer, SONGS_S_COLUMNS))}
      ORDER BY s.updated_at DESC
    `);
    const ids = rows.map((row) => (row as { id: string }).id).sort();
    const expected = name === 'admin'
      ? ['mine-1', 'other-1', 'public-1']
      : name === 'non-admin' ? ['mine-1', 'public-1'] : ['public-1'];
    assert.deepEqual(ids, expected, name);
  }
});

test('songVisibilityWhere: the composed WHERE clause is never empty (admin included)', async (ctx) => {
  const t = makeSongsDb(ctx, 'where');
  await createSongs(t.client);
  for (const { name, viewer } of VIEWERS) {
    const predicate = and(songVisibilityWhere(viewer));
    assert.ok(predicate, `${name}: and() collapsed to undefined → empty WHERE clause`);
    // Rows a viewer must NOT see, proving the predicate actually filters.
    const ids = (await t.db.all(sql`SELECT id FROM songs WHERE ${predicate}`))
      .map((r) => (r as { id: string }).id);
    if (name === 'admin') {
      assert.deepEqual([...ids].sort(), ['mine-1', 'other-1', 'public-1'], 'admin sees everything');
    } else if (name === 'non-admin') {
      assert.deepEqual([...ids].sort(), ['mine-1', 'public-1'], 'non-admin sees public + own');
    } else {
      assert.deepEqual(ids, ['public-1'], `${name} sees only public songs`);
    }
  }
});
