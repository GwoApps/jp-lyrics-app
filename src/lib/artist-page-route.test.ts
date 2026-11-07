import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import type { ReactElement } from 'react';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../app/artists/[name]/page.tsx', import.meta.url), 'utf8');
const exports: { default?: (props: { params: Promise<{ name: string }> }) => Promise<ReactElement<{ name: string }>> } = {};
runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
  exports,
  require: (specifier: string) => specifier === '@/components/artists/ArtistDetailPage' ? { default: 'artist-detail' } : require(specifier),
});
for (const name of ['明透', 'AC/DC', '100% Artist', 'Literal %20 name', 'A & B']) {
  test(`artist page decodes its raw Next page segment exactly once: ${name}`, async () => {
    const page = await exports.default!({ params: Promise.resolve({ name: encodeURIComponent(name) }) });
    assert.equal(page.props.name, name);
  });
}
