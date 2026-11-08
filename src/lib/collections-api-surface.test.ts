/**
 * ISSUE #392 — the collections API must be exactly as reachable as the UI
 * claims, and both write paths must speak the same error vocabulary.
 *
 * Before this: `POST /api/collections` and `DELETE`/`PUT /api/collections/[id]`
 * had zero callers (creating a category required catching a 3-second toast, and
 * renaming/deleting was impossible), while `POST`/`DELETE
 * /api/collections/[id]/songs` were dead routes writing the same table with the
 * opposite (incremental) semantics. `sort_order` was only written by one of
 * those dead routes, so the column promised an order no UI could produce.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const here = dirname(fileURLToPath(import.meta.url));
const read = (path: string) => readFileSync(join(here, '..', path), 'utf8');

const collectionRoute = read('app/api/collections/route.ts');
const collectionItemRoute = read('app/api/collections/[id]/route.ts');
const collectionSongsRoute = read('app/api/collections/[id]/songs/route.ts');
const page = read('components/home/SongLibraryPage.tsx');
const panel = read('components/home/CollectionsPanel.tsx');

test('collection membership is written by exactly one route (the favorite PUT)', () => {
  const handlers = [...collectionSongsRoute.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
  assert.deepEqual(handlers, ['GET'], 'incremental POST/DELETE handlers must stay deleted');
  assert.doesNotMatch(collectionSongsRoute, /parseJsonBody|isUniqueViolation/);
  // The favorite PUT owns the whole replacement semantics.
  const favoriteRoute = read('app/api/songs/[id]/favorite/route.ts');
  assert.match(favoriteRoute, /db\.delete\(schema\.collectionSongs\)/);
  assert.ok(favoriteRoute.includes('await db.batch(writes)'));
});

test('sort_order is gone from the schema, the queries and the writers', () => {
  // Only the comment explaining the drop may still mention it.
  assert.doesNotMatch(read('lib/schema.ts'), /sortOrder:|sort_order'/);
  assert.doesNotMatch(collectionSongsRoute, /sort_order/);
  assert.doesNotMatch(read('app/api/songs/[id]/favorite/route.ts'), /sortOrder/);
  // A dropped column needs a migration, and the journal must list it.
  const journal = JSON.parse(read('../drizzle/meta/_journal.json')) as { entries: { tag: string }[] };
  assert.ok(journal.entries.some((entry) => entry.tag === '0026_drop_collection_sort_order'));
});

test('collection membership is ordered by a column that exists', () => {
  assert.match(collectionSongsRoute, /ORDER BY s\.title, s\.id/);
});

test('create, rename and delete all have a caller in the collections panel', () => {
  // Panel -> props -> handlers in the page -> the three routes.
  assert.match(panel, /onCreate: \(name: string\) => Promise<boolean>/);
  assert.match(panel, /onRename: \(id: string, name: string\) => Promise<boolean>/);
  assert.match(panel, /onDelete: \(id: string\) => Promise<boolean>/);
  assert.match(page, /method: 'POST',\s*headers: \{ 'Content-Type': 'application\/json' \},\s*body: JSON\.stringify\(\{ name \}\)/);
  assert.match(page, /fetch\(`\/api\/collections\/\$\{encodeURIComponent\(collectionId\)\}`, \{\s*method: 'PUT'/);
  assert.match(page, /fetch\(`\/api\/collections\/\$\{encodeURIComponent\(collectionId\)\}`, \{ method: 'DELETE' \}\)/);
  assert.match(collectionRoute, /export async function POST/);
  assert.match(collectionItemRoute, /export async function (PUT|DELETE)/);
});

test('rename and delete report the same error codes the client maps', () => {
  for (const code of ['login_required', 'name_required', 'collection_not_found']) {
    assert.ok(collectionItemRoute.includes(`'${code}'`), `/api/collections/[id] must report ${code}`);
  }
  // The client map must actually know them, or the toast silently falls back.
  for (const code of ['login_required', 'name_required', 'collection_not_found']) {
    assert.ok(page.includes(`${code}:`), `writeErrorMsg map is missing ${code}`);
  }
  // The old divergence: delete said collection_not_found, rename said "Not found".
  assert.doesNotMatch(collectionItemRoute, /'Not found'|'Name is required'|'Unauthorized'/);
});

test('deleting a category never deletes the favorites themselves', () => {
  // Only the grouping row goes; `favorites` is the favorite, `collection_songs`
  // cascades from the collection.
  assert.doesNotMatch(collectionItemRoute, /schema\.favorites/);
});

// --- Route behaviour ---------------------------------------------------------
// The API surface test above proves the handlers exist and speak one vocabulary;
// these drive them so a rename/delete regression fails here instead of in a
// silently-fallback toast.

type RouteModule = {
  PUT: (request: unknown, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
  DELETE: (request: unknown, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
};

function loadItemRoute(options: { signedIn?: boolean; owned?: boolean } = {}) {
  const { signedIn = true, owned = true } = options;
  const writes: string[] = [];
  const exports: Partial<RouteModule> = {};
  const code = ts.transpileModule(readFileSync(join(here, '..', 'app/api/collections/[id]/route.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const table = (name: string) => ({ __table: name });
  runInNewContext(code, {
    exports,
    require: (name: string) => {
      if (name === 'next/server') {
        return { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } };
      }
      if (name === '@/lib/auth') return { getAuthUser: async () => (signedIn ? { email: 'me@example.test' } : null) };
      if (name === '@/lib/db') {
        return {
          getDB: () => ({
            get: async () => (owned ? { id: 'c1' } : undefined),
            delete: (target: { __table: string }) => ({
              where: async () => { writes.push(`delete:${target.__table}`); },
            }),
            update: (target: { __table: string }) => ({
              set: (values: { name: string }) => ({
                where: async () => { writes.push(`update:${target.__table}:${values.name}`); },
              }),
            }),
          }),
          schema: { collections: table('collections') },
          sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
        };
      }
      throw new Error(`Unexpected dependency ${name}`);
    },
  });
  return { route: exports as RouteModule, writes };
}

const request = (body?: unknown) => ({
  json: async () => {
    if (body === undefined) throw new SyntaxError('empty body');
    return body;
  },
});
const ctx = { params: Promise.resolve({ id: 'c1' }) };

test('rename reports the shared error codes: 401, 400 and 404 — never a prose string', async () => {
  const anonymous = await loadItemRoute({ signedIn: false }).route.PUT(request({ name: 'x' }), ctx);
  assert.equal(anonymous.status, 401);
  assert.deepEqual(await anonymous.json(), { error: 'login_required' });

  for (const body of [{}, { name: '   ' }, undefined]) {
    const blank = await loadItemRoute().route.PUT(request(body), ctx);
    assert.equal(blank.status, 400);
    assert.deepEqual(await blank.json(), { error: 'name_required' });
  }

  // Someone else's collection must be indistinguishable from a missing one.
  const foreign = await loadItemRoute({ owned: false }).route.PUT(request({ name: 'x' }), ctx);
  assert.equal(foreign.status, 404);
  assert.deepEqual(await foreign.json(), { error: 'collection_not_found' });
});

test('a successful rename writes the trimmed name and echoes it back', async () => {
  const { route, writes } = loadItemRoute();
  const response = await route.PUT(request({ name: '  Road Trip  ' }), ctx);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { id: 'c1', name: 'Road Trip' });
  assert.deepEqual(writes, ['update:collections:Road Trip']);
});

test('delete refuses anonymous callers and never touches another user\'s row', async () => {
  const anonymous = await loadItemRoute({ signedIn: false }).route.DELETE(request(), ctx);
  assert.equal(anonymous.status, 401);

  const { route, writes } = loadItemRoute({ owned: false });
  const foreign = await route.DELETE(request(), ctx);
  assert.equal(foreign.status, 404);
  assert.deepEqual(await foreign.json(), { error: 'collection_not_found' });
  assert.deepEqual(writes, []);
});

test('deleting a category deletes only the collection row', async () => {
  const { route, writes } = loadItemRoute();
  const response = await route.DELETE(request(), ctx);
  assert.equal(response.status, 200);
  assert.deepEqual(writes, ['delete:collections']);
});
