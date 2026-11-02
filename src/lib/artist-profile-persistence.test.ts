import test from 'node:test';
import assert from 'node:assert/strict';
import type { InStatement } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { drizzle as drizzleD1 } from 'drizzle-orm/d1';
import { Miniflare } from 'miniflare';
import { createTestDb, prepareTestDb } from './test-db.ts';
import * as schema from './schema.ts';
import { createArtistProfileAdminHandlers } from './artist-profile-admin.ts';
import { getArtistProfileOverride, setArtistProfileOverride, deleteArtistProfileOverride } from './artist-profile-store.ts';
import { emptyManagedArtistProfile } from './artist-profile-lookup.ts';

type ProfileDB = Parameters<typeof getArtistProfileOverride>[0];
const handlers = (db: ProfileDB) => createArtistProfileAdminHandlers({
  getUser: async () => ({ isAdmin: true }),
  getOverride: (name) => getArtistProfileOverride(db, name),
  setOverride: (name, value) => setArtistProfileOverride(db, name, value),
  deleteOverride: (name) => deleteArtistProfileOverride(db, name),
  lookup: async () => emptyManagedArtistProfile('unused'),
});
const put = (alias: string) => new Request('https://example.com/api/admin/artists/Queen', { method: 'PUT', body: JSON.stringify({ override: { aliases: [alias] } }) });
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};

/** Delay delivery only AFTER a real, committed SQLite statement on this connection. */
function delayCommittedWrites(client: ReturnType<typeof createTestDb>['client'], afterWrite: (sql: string) => Promise<void>) {
  return drizzle(new Proxy(client, {
    get(target, property, receiver) {
      if (property !== 'execute') return Reflect.get(target, property, receiver);
      return async (statement: InStatement) => {
        const result = await target.execute(statement);
        const sql = typeof statement === 'string' ? statement : statement.sql;
        if (/^(insert|delete)\b/i.test(sql)) await afterWrite(sql);
        return result;
      };
    },
  }), { schema });
}

async function fixture(t: Parameters<typeof createTestDb>[0]) {
  const f = createTestDb(t, 'artist-profile-concurrency', schema);
  await prepareTestDb(f.client);
  await f.client.execute('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  return f;
}

test('eight concurrent admin PUTs on independent SQLite connections each return their own committed row; last commit wins', { timeout: 15000 }, async (t) => {
  const f = await fixture(t);
  const allCommitted = deferred();
  let commits = 0;
  let lastAlias = '';
  const aliases = Array.from({ length: 8 }, (_, i) => `writer-${i}`);
  const requests = aliases.map((alias) => {
    const connection = f.open();
    const db = delayCommittedWrites(connection.client, async () => {
      commits++;
      lastAlias = alias;
      if (commits === aliases.length) allCommitted.resolve();
      await allCommitted.promise;
    });
    return handlers(db).put(put(alias), 'Queen');
  });
  const responses = await Promise.all(requests);
  assert.deepEqual(responses.map((r) => r.status), aliases.map(() => 200));
  for (const [i, response] of responses.entries()) {
    const { override } = await response.json();
    assert.deepEqual(override.aliases, [aliases[i]]); assert.ok(override.updatedAt);
  }
  assert.equal(commits, aliases.length);
  assert.deepEqual((await getArtistProfileOverride(f.open().db, 'Queen'))?.aliases, [lastAlias]);
  assert.equal((await f.client.execute('SELECT count(*) AS n FROM settings')).rows[0].n, 1);
});

test('concurrent DELETE then PUT on independent SQLite connections: deletion succeeds at its commit, later recreation survives', { timeout: 15000 }, async (t) => {
  const f = await fixture(t);
  await setArtistProfileOverride(f.db, 'Queen', { aliases: ['before deletion'] });
  const deleted = deferred(), releaseDelete = deferred();
  const deleter = delayCommittedWrites(f.open().client, async () => { deleted.resolve(); await releaseDelete.promise; });
  const deletion = handlers(deleter).delete(new Request('https://example.com/api/admin/artists/Queen', { method: 'DELETE' }), 'Queen');
  try {
    await deleted.promise;
    assert.equal(await getArtistProfileOverride(f.open().db, 'Queen'), null);
    const inserted = await handlers(f.open().db).put(put('recreated after deletion'), 'Queen');
    assert.equal(inserted.status, 200);
  } finally { releaseDelete.resolve(); }
  const response = await deletion;
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { override: null });
  assert.deepEqual((await getArtistProfileOverride(f.open().db, 'Queen'))?.aliases, ['recreated after deletion']);
});

test('real D1 and libSQL execute the same single-statement UPSERT/DELETE RETURNING, including replace and idempotent reset', { timeout: 30000 }, async (t) => {
  const f = await fixture(t);
  const mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("ok"); } };', d1Databases: { DB: 'artist-profile-test' } });
  t.after(() => mf.dispose());
  const binding = await mf.getD1Database('DB');
  await binding.prepare('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)').run();
  const sqlByAdapter: string[][] = [];
  for (const adapter of ['libsql', 'd1'] as const) {
    const queries: string[] = [];
    const mutations: string[] = [];
    sqlByAdapter.push(mutations);
    const logger = { logQuery: (sql: string) => { queries.push(sql); } };
    const db: ProfileDB = adapter === 'libsql' ? drizzle(f.client, { schema, logger }) : drizzleD1(binding, { schema, logger });
    const reader: ProfileDB = adapter === 'libsql' ? f.open().db : drizzleD1(await mf.getD1Database('DB'), { schema });
    for (const input of [{ aliases: ['old'] }, { country: null }]) {
      queries.length = 0;
      const saved = await setArtistProfileOverride(db, 'Queen', input, new Date('2026-11-02T00:00:00.000Z'));
      assert.deepEqual(saved, { ...input, updatedAt: '2026-11-02T00:00:00.000Z' });
      assert.equal(queries.length, 1); assert.match(queries[0], /^insert .*on conflict .*do update .*returning /i);
      mutations.push(queries[0]);
      assert.deepEqual(await getArtistProfileOverride(reader, 'Queen'), saved);
    }
    queries.length = 0;
    await deleteArtistProfileOverride(db, 'Queen');
    assert.equal(queries.length, 1); assert.match(queries[0], /^delete .*returning /i);
    const deletionSql = queries[0];
    mutations.push(deletionSql);
    assert.equal(await getArtistProfileOverride(reader, 'Queen'), null);
    queries.length = 0;
    await deleteArtistProfileOverride(db, 'Queen');
    assert.deepEqual(queries, [deletionSql]);
    mutations.push(queries[0]);
  }
  assert.deepEqual(sqlByAdapter[0], sqlByAdapter[1]);
});
