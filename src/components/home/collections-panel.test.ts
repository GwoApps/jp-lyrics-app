/**
 * ISSUE #392 (option A) — the category chips alone left creation, renaming and
 * deletion without a UI: creating needed a 3-second toast, renaming and
 * deleting were impossible. These render the real component so the panel's
 * contract (a management entry that reaches all three write handlers, inline
 * rename, confirm-before-delete) cannot silently disappear again.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { collectionRowLabel, deleteCollectionLabel, renameCollectionLabel } from '../../lib/song-card-a11y.ts';

const require = createRequire(import.meta.url);
const directory = dirname(fileURLToPath(import.meta.url));

// `key:values` so an assertion can prove the collection name reached the label.
const t = (key: string, vars?: Record<string, string | number>) => (vars
  ? `${key}:${Object.values(vars).join(',')}`
  : key);

const SRC = resolve(directory, '..', '..');

/** Resolve a `@/x` alias or a relative specifier to an existing .ts/.tsx file. */
function findFile(base: string): string | null {
  return [base, `${base}.ts`, `${base}.tsx`, resolve(base, 'index.ts')].find((candidate) => existsSync(candidate)) ?? null;
}

const cache = new Map<string, Record<string, unknown>>();
function load(path: string): Record<string, unknown> {
  if (cache.has(path)) return cache.get(path)!;
  const exports: Record<string, unknown> = {};
  cache.set(path, exports);
  const code = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  runInNewContext(code, {
    exports,
    require: (specifier: string) => {
      // The two modules the panel under test talks to are stubbed so rendering
      // stays hermetic; everything else is loaded from the real source.
      if (specifier === '@/lib/i18n') return { useI18n: () => ({ t }) };
      if (specifier === '@/lib/song-card-a11y') return { collectionRowLabel, deleteCollectionLabel, renameCollectionLabel };
      // Stand-in for the shared dialog: only its props matter to this contract.
      if (specifier === '@/components/ConfirmDialog') {
        return {
          __esModule: true,
          default: (props: Record<string, unknown>) => (props.open
            ? React.createElement('div', { 'data-confirm-dialog': '', 'data-variant': props.variant, 'data-title': props.title, 'data-body': props.body })
            : null),
        };
      }
      const base = specifier.startsWith('@/') ? resolve(SRC, specifier.slice(2)) : resolve(directory, specifier);
      const file = specifier.startsWith('.') || specifier.startsWith('@/') ? findFile(base) : null;
      if (file) return load(file);
      return require(specifier);
    },
  });
  return exports;
}

const Panel = load(resolve(directory, 'CollectionsPanel.tsx')).default as React.ComponentType<Record<string, unknown>>;
const collections = [
  { id: 'c1', name: 'Road Trip', songCount: 3 },
  { id: 'c2', name: 'Late Night', songCount: 0 },
];
const noop = () => {};

function render(props: Record<string, unknown> = {}) {
  return renderToStaticMarkup(React.createElement(Panel, {
    collections, filterCollection: null, onFilterChange: noop,
    onCreate: async () => true, onRename: async () => true, onDelete: async () => true,
    ...props,
  }));
}

test('the chip row offers a management toggle wired to the panel it controls', () => {
  const html = render();
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /aria-label="home.toggleCollectionsLabel"/);
  assert.match(html, /aria-controls="[^"]+"/);
  // Chips stay the everyday filter: "All" plus the unclassified bucket and each collection.
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /home\.favoriteUnclassified/);
  assert.match(html, /Road Trip/);
});

test('chips name the collection they filter and the unclassified bucket is a filter, not an id', () => {
  const html = render({ filterCollection: 'c1' });
  const selectedLabel = collectionRowLabel('Road Trip', true, t);
  assert.equal(selectedLabel, 'home.unfilterByCollection:Road Trip');
  assert.ok(html.includes(`aria-label="${selectedLabel}"`), 'the selected chip announces that activating it clears the filter');
  assert.ok(html.includes(`aria-label="${collectionRowLabel('Late Night', false, t)}"`));
  assert.match(html, /aria-pressed="true"/);
  // The unclassified bucket is a local sentinel, never a collection id: no
  // rename/delete affordance may be offered for it.
  assert.ok(html.includes(`aria-label="${collectionRowLabel('home.favoriteUnclassified', false, t)}"`));
  assert.doesNotMatch(html, /home\.renameCollection:unclassified/);
});

test('the management panel is closed by default and a failed write keeps the typed name', () => {
  const closed = render();
  assert.doesNotMatch(closed, /home\.collectionsTitle/);
  assert.doesNotMatch(closed, /home\.deleteCollectionConfirmTitle/);
  const source = readFileSync(resolve(directory, 'CollectionsPanel.tsx'), 'utf8');
  // Only a server-acknowledged create clears the input, so a failed attempt keeps
  // the name for a retry instead of silently discarding it.
  assert.match(source, /if \(await onCreate\(name\)\) setNewName\(''\)/);
  assert.match(source, /if \(await onRename\(renameTarget\.id, name\)\) setRenameTarget\(null\)/);
});

test('the management panel labels its rename and delete controls per row', () => {
  const source = readFileSync(resolve(directory, 'CollectionsPanel.tsx'), 'utf8');
  // Both icon-only buttons carry the collection name, so a screen reader tabbing
  // through rows knows which category each control acts on.
  assert.ok(source.includes('aria-label={renameCollectionLabel(collection.name, t)}'));
  assert.ok(source.includes('aria-label={deleteCollectionLabel(collection.name, t)}'));
  assert.ok(source.includes("t('home.collectionsTitle')"));
  assert.ok(source.includes("t('home.collectionsEmpty')"));
  assert.ok(source.includes('onCreate(name)'));
  assert.ok(source.includes('onRename(renameTarget.id, name)'));
});

test('deleting a category goes through the shared confirm dialog first', () => {
  const source = readFileSync(resolve(directory, 'CollectionsPanel.tsx'), 'utf8');
  assert.ok(source.includes("title={t('home.deleteCollectionConfirmTitle', { name: deleteTarget?.name ?? '' })}"));
  assert.ok(source.includes("body={t('home.deleteCollectionConfirmBody')}"));
  assert.ok(source.includes("variant=\"danger\""));
  // Confirm only closes the dialog after the caller finished; the delete itself
  // must not fire on the row click.
  assert.match(source, /const confirmDelete = async \(\) => \{[\s\S]*?await onDelete\(target\.id\)/);
});
