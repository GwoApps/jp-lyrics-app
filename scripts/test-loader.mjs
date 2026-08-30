import { pathToFileURL, fileURLToPath } from 'node:url';
import { existsSync, statSync } from 'node:fs';
import { resolve as pathResolve, dirname, join } from 'node:path';

const SRC = pathResolve('src');

function isFile(p) {
  try { return existsSync(p) && statSync(p).isFile(); }
  catch { return false; }
}

// Try to find an existing file for a base path (no extension), in the same
// order node's CJS/ESM resolvers would: exact file, .ts, /index.ts.
function findFile(base) {
  const candidates = [base, `${base}.ts`, join(base, 'index.ts')];
  for (const c of candidates) {
    if (isFile(c)) return c;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  // Handle the `@/` tsconfig path alias.
  if (specifier.startsWith('@/')) {
    const file = findFile(pathResolve(SRC, specifier.slice(2)));
    if (file) return nextResolve(pathToFileURL(file).href, context);
  }
  // Handle relative ./ and ../ imports that reference .ts files without the
  // extension (node's ESM resolver won't append .ts on its own).
  else if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL) {
    const parentDir = dirname(fileURLToPath(context.parentURL));
    const file = findFile(pathResolve(parentDir, specifier));
    if (file && !specifier.endsWith('.ts')) {
      return nextResolve(pathToFileURL(file).href, context);
    }
  }
  return nextResolve(specifier, context);
}
