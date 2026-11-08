import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { runInNewContext } from 'node:vm';
import { APP_ICON_REVISION } from '@/lib/app-icon';
import { APP_NAME_NEUTRAL, APP_NAME_SHORT, APP_DESCRIPTION } from '@/lib/app-identity';
import { shouldAnnounceUpdate } from '@/lib/sw-update';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const layoutSource = read('src/app/layout.tsx');
const manifest = JSON.parse(read('public/manifest.json')) as {
  name: string;
  short_name: string;
  description: string;
};

const layoutAst = ts.createSourceFile('layout.tsx', layoutSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const metadataDeclaration = layoutAst.statements
  .filter(ts.isVariableStatement)
  .flatMap((statement) => [...statement.declarationList.declarations])
  .find((declaration) => declaration.name.getText(layoutAst) === 'metadata');
assert.ok(metadataDeclaration?.initializer);
const metadata = JSON.parse(JSON.stringify(runInNewContext(
  `(${metadataDeclaration.initializer.getText(layoutAst)})`,
  { APP_ICON_REVISION, APP_NAME_NEUTRAL, APP_NAME_SHORT, APP_DESCRIPTION },
))) as { title: string; description: string; appleWebApp: { title: string } };

test('shell metadata names the app in a language-neutral way instead of Chinese-only copy', () => {
  assert.equal(metadata.title, APP_NAME_NEUTRAL);
  assert.equal(metadata.appleWebApp.title, APP_NAME_SHORT);
  assert.equal(metadata.description, APP_DESCRIPTION);
  // The reader-facing names must not be hard-coded copy in the layout.
  assert.doesNotMatch(layoutSource, /title:\s*'[^']*[\u4e00-\u9fff][^']*'/);
  assert.doesNotMatch(layoutSource, /appleWebApp:\s*\{[^}]*title:\s*'[^']*[\u4e00-\u9fff]/);
});

test('PWA manifest ships the same neutral identity the layout metadata does', () => {
  assert.equal(manifest.name, APP_NAME_NEUTRAL);
  assert.equal(manifest.short_name, APP_NAME_SHORT);
  assert.equal(manifest.description, APP_DESCRIPTION);
});

test('document title follows the UI locale once hydrated', () => {
  const sync = read('src/components/AppMetadataSync.tsx');
  assert.match(sync, /const name = t\('common\.appName'\)/);
  assert.match(sync, /document\.title = name/);
  assert.match(sync, /meta\[name="apple-mobile-web-app-title"\]/);
  // Re-applied on navigation: Next.js re-emits layout metadata per route.
  assert.match(sync, /\}, \[t, pathname\]\)/);
});

test('service worker update copy comes from the dictionaries, not an inline locale table', () => {
  const component = read('src/components/ServiceWorkerUpdate.tsx');
  assert.match(component, /t\('common\.updateAvailable'\)/);
  assert.match(component, /t\('common\.updateNow'\)/);
  assert.match(component, /<Toast[\s\S]*type="success"/);
  assert.match(component, /navigator\.serviceWorker\s*\.register\('\/sw\.js'/);
  // Snapshot before registering, otherwise the first install looks like an update.
  assert.match(component, /const hadController = navigator\.serviceWorker\.controller !== null/);
  // Same self-dismiss as the old inline toast.
  assert.match(component, /TOAST_LIFETIME_MS = 15_000/);
  // The old inline script duplicated detectLocale() and its message table.
  assert.doesNotMatch(layoutSource, /jplrc-locale/);
  assert.doesNotMatch(layoutSource, /updateMessages/);
  assert.doesNotMatch(layoutSource, /serviceWorker\.register/);
});

test('only an activation that replaces a running worker announces an update', () => {
  assert.equal(shouldAnnounceUpdate('activated', true), true);
  for (const [state, hadController] of [
    ['activated', false], // first install: nothing to update
    ['installing', true],
    ['installed', true],
    ['activating', true],
    ['redundant', true],
  ] as const) {
    assert.equal(shouldAnnounceUpdate(state, hadController), false, `${state}/${hadController}`);
  }
});

test('update toast copy is translated in all four locales', () => {
  for (const locale of ['ja', 'en', 'zh-CN', 'zh-TW']) {
    const dict = JSON.parse(read(`src/i18n/${locale}.json`)) as { common: Record<string, string> };
    for (const key of ['updateAvailable', 'updateNow']) {
      const value = dict.common[key];
      assert.ok(value && value.trim().length > 0, `${locale}.json missing common.${key}`);
      assert.notEqual(value, `common.${key}`, `${locale}.json common.${key} leaks the raw key`);
    }
  }
});
