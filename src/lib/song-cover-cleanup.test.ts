/**
 * ISSUE #496 — deleting songs must also remove the cover object.
 *
 * SQLite cascades `song_covers`, but R2 objects live outside the database.
 * All song-deletion routes must call the best-effort cleanup, and cleanup
 * failures must never turn a successful delete into an error.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const ROOT = new URL('../../', import.meta.url);
const source = (path: string) => readFileSync(new URL(path, ROOT), 'utf8');

const ROUTES = [
  'src/app/api/songs/[id]/route.ts',
  'src/app/api/admin/songs/[id]/route.ts',
  'src/app/api/admin/users/[id]/route.ts',
];

/** Slice a named function body so `await` outside it does not count. */
function functionBody(code: string, name: string): string {
  const start = code.indexOf(`export async function ${name}(`);
  assert.notEqual(start, -1, `missing ${name}`);
  const brace = code.indexOf('{', code.indexOf(') {', start));
  let depth = 0;
  for (let i = brace; i < code.length; i += 1) {
    if (code[i] === '{') depth += 1;
    else if (code[i] === '}') {
      depth -= 1;
      if (depth === 0) return code.slice(brace, i + 1);
    }
  }
  throw new Error(`unbalanced ${name}`);
}

for (const route of ROUTES) {
  const code = source(route);
  test(`${route} cleans up R2 covers on song deletion`, () => {
    const del = functionBody(code, 'DELETE');
    assert.match(code, /import \{ cleanupSongCover \} from '@\/lib\/song-cover-cleanup'/);
    assert.match(del, /cleanupSongCover\(/);
  });
}

test('cover cleanup logs and swallows storage failures', () => {
  const helperSource = readFileSync(new URL('./song-cover-cleanup.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(helperSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: { cleanupSongCover?: (id: string) => Promise<void> } = {};
  const warnings: unknown[][] = [];
  const require = (name: string) => {
    if (name === '@/lib/cover-store') {
      return { deleteCover: async () => { throw new Error('R2 unavailable'); } };
    }
    throw new Error(`Unexpected dependency ${name}`);
  };

  new Function('exports', 'require', 'console', code)(
    exports,
    require,
    { warn: (...args: unknown[]) => { warnings.push(args); } },
  );

  assert.match(helperSource, /catch \(error\)/);
  return exports.cleanupSongCover!('song-to-delete').then(() => {
    assert.equal(warnings.length, 1);
    assert.match(String(warnings[0][0]), /\[song-cover\] cleanup failed for song-to-delete/);
  });
});
