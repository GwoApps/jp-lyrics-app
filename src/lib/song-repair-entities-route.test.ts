/**
 * POST /api/songs/[id]/repair-lyrics-entities (ISSUE #428).
 *
 * The repair is an explicit, owner-triggered edit — not a startup sweep and not
 * a migration script — so the route must prove three things: it refuses anyone
 * who cannot edit the song, it writes the decoded lyrics (plus the re-shaped or
 * cleared reading cache) through a compare-and-set on the values it read, and it
 * writes nothing when the row is already clean.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { repairLyricsHtmlEntities } from './lyrics-entity.ts';

const ROUTE = 'src/app/api/songs/[id]/repair-lyrics-entities/route.ts';

const DIRTY_ROW = {
  id: 'song-1',
  createdBy: 'user-1',
  lyricsRaw: "痛くてfallin&#039; down\n未確定talkin&#039; box",
  lyricsSynced: "[00:30.33]痛くてfallin&#039; down",
  // The shape the database actually held: the tokenizer split the entity itself
  // into `&#` / `039` / `;`, so this cache can never describe decoded text.
  lyricsFurigana: JSON.stringify([
    { segments: [
      { text: '痛く', reading: 'いた' },
      { text: 'て', reading: '' },
      { text: 'fallin', reading: '' },
      { text: '&#', reading: '' },
      { text: '039', reading: '' },
      { text: ';', reading: '' },
      { text: ' down', reading: '' },
    ] },
    { segments: [{ text: "未確定talkin&#039; box", reading: '' }] },
  ]),
};

const CLEAN_ROW = {
  ...DIRTY_ROW,
  lyricsRaw: "痛くてfallin' down\n未確定talkin' box",
  lyricsSynced: "[00:30.33]痛くてfallin' down",
  lyricsFurigana: '[]',
};

interface LoadOptions {
  row?: Record<string, unknown>;
  user?: { id: string; isAdmin: boolean } | null;
  /** When true the CAS UPDATE matches no row (a concurrent write won). */
  casMiss?: boolean;
}

function loadRoute(options: LoadOptions = {}) {
  const exports: { POST?: (request: unknown, ctx: unknown) => Promise<Response> } = {};
  const row = { ...(options.row ?? DIRTY_ROW) };
  const writes: Record<string, unknown>[] = [];
  const whereArgs: unknown[] = [];
  const user = options.user === undefined ? { id: 'user-1', isAdmin: false } : options.user;

  const selectChain = {
    from: () => selectChain,
    where: () => selectChain,
    get: async () => row,
  };
  const db = {
    select: () => selectChain,
    update: () => ({
      set: (set: Record<string, unknown>) => {
        writes.push(set);
        return {
          where: (cond: unknown) => {
            whereArgs.push(cond);
            return {
              returning: () => ({
                get: async () => (options.casMiss ? undefined : { id: row.id }),
              }),
            };
          },
        };
      },
    }),
  };

  const column = (name: string) => ({ __column: name, name });
  const code = ts.transpileModule(readFileSync(ROUTE, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;

  runInNewContext(code, {
    exports,
    console,
    process,
    require: (name: string) => {
      if (name === 'next/server') {
        return {
          NextRequest: class {},
          NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) },
        };
      }
      if (name === '@/lib/db') {
        return { getDB: () => db, schema: { songs: new Proxy({}, { get: (_t, key) => column(String(key)) }) } };
      }
      if (name === 'drizzle-orm') return { and: (...args: unknown[]) => ({ and: args }), eq: (...args: unknown[]) => ({ eq: args }) };
      if (name === '@/lib/auth') return { getAuthUser: async () => user };
      if (name === '@/lib/db-time-sql') return { nowUtcSql: () => '2026-11-15T00:00:00.000Z' };
      // The real repair logic runs, so the route asserts production behaviour.
      if (name === '@/lib/lyrics-entity') return { repairLyricsHtmlEntities };
      throw new Error(`Unexpected dependency ${name}`);
    },
  });

  return {
    writes,
    whereArgs,
    post: () => exports.POST!({ json: async () => ({}) }, { params: Promise.resolve({ id: row.id }) }),
  };
}

test('dirty lyrics are decoded and the entity-split reading cache is dropped', async () => {
  const route = loadRoute();
  const res = await route.post();
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, changed: true, furigana_action: 'cleared' });

  const set = route.writes[0] as Record<string, unknown>;
  assert.equal(set.lyricsRaw, "痛くてfallin' down\n未確定talkin' box");
  assert.equal(set.lyricsSynced, "[00:30.33]痛くてfallin' down");
  // The cache cannot describe the decoded text, so it must not be left behind.
  assert.equal(set.lyricsFurigana, '[]');
  // The edit really is an edit: the library order has to reflect it.
  assert.equal(typeof set.updatedAt, 'string');

  // The write is a compare-and-set on the values the repair was computed from.
  const where = route.whereArgs[0] as { and: { eq: { __column: string }[] }[] };
  const columns = where.and.map((clause) => String(clause.eq[0].__column));
  assert.deepEqual(columns, ['id', 'lyricsRaw', 'lyricsSynced']);
});

test('a clean song is never written', async () => {
  const route = loadRoute({ row: CLEAN_ROW });
  const res = await route.post();
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, changed: false, furigana_action: 'unchanged' });
  assert.equal(route.writes.length, 0);
});

test('only an editor may repair the lyrics', async () => {
  const anonymous = loadRoute({ user: null });
  assert.equal((await anonymous.post()).status, 401);
  assert.equal(anonymous.writes.length, 0);

  const stranger = loadRoute({ user: { id: 'user-2', isAdmin: false } });
  assert.equal((await stranger.post()).status, 403);
  assert.equal(stranger.writes.length, 0);
});

test('a concurrent lyrics write wins the race instead of being clobbered', async () => {
  const route = loadRoute({ casMiss: true });
  const res = await route.post();
  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), { error: 'stale_lyrics' });
});
