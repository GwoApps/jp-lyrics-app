import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

function loadRoute({ authenticated = true, fail = false } = {}) {
  const exports: { GET?: (request: { nextUrl: URL }) => Promise<Response> } = {};
  const calls: unknown[][] = [];
  const code = ts.transpileModule(readFileSync('src/app/api/furigana/readings/route.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  runInNewContext(code, {
    exports,
    console: { error: () => {} },
    require: (name: string) => {
      if (name === 'next/server') return { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } };
      if (name === '@/lib/auth') return { getAuthUser: async () => authenticated ? { id: 'test' } : null };
      if (name === '@/lib/japanese-reading-candidates') return {
        getJapaneseReadingCandidates: (...args: unknown[]) => {
          calls.push(args);
          if (fail) throw new Error('dictionary unavailable');
          return ['た', 'しょく'];
        },
      };
      throw new Error(`Unexpected dependency ${name}`);
    },
  });
  return { get: (query: string) => exports.GET!({ nextUrl: new URL('http://localhost/api/furigana/readings?' + query) }), calls };
}

test('reading API authorizes before dictionary access', async () => {
  const route = loadRoute({ authenticated: false });
  const response = await route.get('text=食');
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'login_required' });
  assert.equal(route.calls.length, 0);
});

test('reading API passes the original word and selected offset into local dictionary', async () => {
  const route = loadRoute();
  const response = await route.get('text=食&word=食べる&start=0');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { candidates: ['た', 'しょく'] });
  assert.equal(JSON.stringify(route.calls), JSON.stringify([['食', { word: '食べる', start: 0 }]]));
});

test('reading API rejects malformed or unrelated context rather than guessing', async () => {
  for (const query of ['text=食&word=お茶', 'text=食&start=-1', 'text=食&start=0.5', 'text=食&start=', 'text=', 'text=' + '食'.repeat(33)]) {
    const route = loadRoute();
    const response = await route.get(query);
    assert.equal(response.status, 400, query);
    assert.deepEqual(await response.json(), { error: 'invalid_reading_query' });
    assert.equal(route.calls.length, 0);
  }
});

test('reading API failures have a stable error code and never fake an empty success', async () => {
  const route = loadRoute({ fail: true });
  const response = await route.get('text=食');
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'reading_lookup_failed' });
});
