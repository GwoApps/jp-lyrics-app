/**
 * PUT /api/songs/[id]/translation — the language stamp of a partial save.
 *
 * Issue #394: the proofreading page sends only the lines it changed, but the
 * cache carries ONE language stamp for the whole array. Stamping it with the
 * current target language relabels the lines nobody re-translated, and the
 * mismatch banner / coverage counter / whole-song cache short-circuit all trust
 * that stamp. The route must therefore answer with the stamp the merge actually
 * committed, and flag the mixed state in an OPTIONAL response field that older
 * clients (and older servers) simply ignore.
 *
 * Loaded with a fake DB — no browser, no D1 — mirroring the existing
 * route-level suites in this folder.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import * as nodeModule from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

// The route imports the real merge/parse helpers, so the sandbox needs to
// resolve the project's own `@/lib/...` modules and can stay on ESM. A tiny
// resolve hook plus `createRequire` keeps the fake DB (below) injected while
// every other dependency is the production implementation.
// `registerHooks` is newer than the pinned @types/node, hence the narrow cast.
const { registerHooks } = nodeModule as unknown as {
  registerHooks: (hooks: {
    resolve: (
      specifier: string,
      context: unknown,
      nextResolve: (specifier: string, context: unknown) => unknown,
    ) => unknown;
  }) => void;
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) {
      const path = new URL(`./${specifier.slice(2)}.ts`, import.meta.url).href;
      return { url: path, shortCircuit: true };
    }
    // `createRequire` needs absolute `file:` specifiers resolved up front; the
    // project's `.ts` sources are loaded by the same stripping rules the rest of
    // the suite uses.
    if (specifier.startsWith('file:')) return { url: specifier, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
const nodeRequire = createRequire(import.meta.url);

/** Map `@/lib/x` onto this checkout, mirroring the loader used by `npm test`. */
function resolveLib(specifier: string): string {
  return fileURLToPath(new URL(`../${specifier.slice('@/'.length)}.ts`, import.meta.url));
}

const ROUTE = 'src/app/api/songs/[id]/translation/route.ts';
const RAW = 'line one\nline two\nline three';

interface Row {
  id: string;
  createdBy: string;
  lyricsRaw: string;
  lyricsTranslation: string;
  lyricsTranslationLang: string | null;
}

function loadRoute(opts: { row?: Partial<Row>; targetLang?: string | null } = {}) {
  const exports: { PUT?: (request: unknown, ctx: unknown) => Promise<Response> } = {};
  const row: Row = {
    id: 'song-1',
    createdBy: 'user-1',
    lyricsRaw: RAW,
    lyricsTranslation: JSON.stringify(['中文一', '中文二', '中文三']),
    lyricsTranslationLang: 'zh-CN',
    ...opts.row,
  };
  const writes: Record<string, unknown>[] = [];

  const selectChain = {
    from: () => selectChain,
    where: () => selectChain,
    get: async () => ({ ...row }),
  };
  const db = {
    select: () => selectChain,
    update: () => ({
      set: (set: Record<string, unknown>) => {
        writes.push(set);
        Object.assign(row, set);
        return {
          where: () => ({
            returning: () => ({ get: async () => ({ id: row.id }) }),
          }),
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
      if (name === 'drizzle-orm') return { eq: () => ({}) };
      if (name === '@/lib/auth') return { getAuthUser: async () => ({ id: 'user-1', isAdmin: true }) };
      if (name === '@/lib/translation-settings') {
        return { getEffectiveTargetLang: async () => (opts.targetLang === undefined ? 'en' : opts.targetLang) };
      }
      // The real merge / parse / stamp helpers, so the route exercises the
      // production decision against the fake row above.
      const real = (specifier: string) => nodeRequire(specifier);
      if (name.startsWith('@/lib/')) return real(pathToFileURL(resolveLib(name)).href);
      throw new Error(`Unexpected dependency ${name}`);
    },
  });

  return {
    writes,
    put: (body: Record<string, unknown>) => exports.PUT!(
      { json: async () => body },
      { params: Promise.resolve({ id: row.id }) },
    ),
  };
}

test('a save that leaves old-language lines untouched keeps the stamp and flags the mixed cache', async () => {
  const route = loadRoute({ targetLang: 'en' });
  const res = await route.put({
    changes: [{ index: 2, translation: 'line three (en)' }],
    source_lyrics: RAW,
  });
  assert.equal(res.status, 200);
  const data = await res.json() as { ok: boolean; translations: string[]; mixed_translation_lang?: boolean };
  assert.equal(data.ok, true);
  assert.deepEqual(data.translations, ['中文一', '中文二', 'line three (en)']);
  // The two untouched lines are still zh-CN, so the stamp must NOT become `en`.
  assert.equal(data.mixed_translation_lang, true);
  const set = route.writes[0] as Record<string, unknown>;
  assert.equal('lyricsTranslationLang' in set, false, 'the stored stamp must be preserved');
});

test('a save that covers every non-empty line refreshes the stamp without the flag', async () => {
  const route = loadRoute({ targetLang: 'en' });
  const res = await route.put({
    changes: [
      { index: 0, translation: 'one' },
      { index: 1, translation: 'two' },
      { index: 2, translation: 'three' },
    ],
    source_lyrics: RAW,
  });
  const data = await res.json() as { mixed_translation_lang?: boolean };
  assert.equal(res.status, 200);
  assert.equal('mixed_translation_lang' in data, false);
  const set = route.writes[0] as Record<string, unknown>;
  assert.equal(set.lyricsTranslationLang, 'en');
});

test('a cache already in the target language never reports mixed', async () => {
  const route = loadRoute({
    targetLang: 'zh-CN',
    row: { lyricsTranslation: JSON.stringify(['中文一', '', '']), lyricsTranslationLang: 'zh-CN' },
  });
  const res = await route.put({
    changes: [{ index: 0, translation: '中文一改' }],
    source_lyrics: RAW,
  });
  const data = await res.json() as { mixed_translation_lang?: boolean };
  assert.equal(res.status, 200);
  assert.equal('mixed_translation_lang' in data, false);
  assert.equal((route.writes[0] as Record<string, unknown>).lyricsTranslationLang, 'zh-CN');
});

test('no resolved target language leaves the stamp alone and reports no mismatch', async () => {
  const route = loadRoute({ targetLang: null });
  const res = await route.put({
    changes: [{ index: 0, translation: 'one' }],
    source_lyrics: RAW,
  });
  const data = await res.json() as { mixed_translation_lang?: boolean };
  assert.equal(res.status, 200);
  assert.equal('mixed_translation_lang' in data, false);
  assert.equal('lyricsTranslationLang' in (route.writes[0] as Record<string, unknown>), false);
});

test('a no-op save keeps the existing response shape', async () => {
  const route = loadRoute();
  const res = await route.put({ changes: [], source_lyrics: RAW });
  const data = await res.json() as { ok: boolean; translations: string[]; mixed_translation_lang?: boolean };
  assert.equal(res.status, 200);
  assert.deepEqual(data.translations, ['中文一', '中文二', '中文三']);
  assert.equal('mixed_translation_lang' in data, false);
  assert.equal(route.writes.length, 0);
});
