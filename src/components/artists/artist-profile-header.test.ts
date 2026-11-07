import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const directory = dirname(fileURLToPath(import.meta.url));
function render(profile: object | null, admin = false) {
  function load(file: string): Record<string, unknown> {
    const exports: Record<string, unknown> = {};
    runInNewContext(ts.transpileModule(readFileSync(resolve(directory, file), 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText, { exports, URL, require(specifier: string) {
      if (specifier.endsWith('.css')) return {};
      if (specifier === '@/lib/i18n') return { useI18n: () => ({ locale: 'en', t: (key: string) => key }) };
      if (specifier === '@/lib/auth-session') return { useAuthSession: () => ({ session: { user: admin ? { email: 'fixture', isAdmin: true } : null } }) };
      if (specifier === './ArtistAvatar') return { ArtistAvatar: ({ name }: { name: string }) => React.createElement('span', { className: 'artist-avatar', title: name }) };
      if (specifier === './artist-profile-cache') return { getCachedArtistProfile: () => profile };
      if (specifier === './profile-queue') return { requestArtistProfile: () => Promise.resolve(profile) };
      if (specifier === './ArtistProfileEditor') return { __esModule: true, default: () => null };
      if (specifier === './profile-presentation') return load('profile-presentation.ts');
      return require(specifier);
    } });
    return exports;
  }
  const Header = load('ArtistProfileHeader.tsx').default as React.ComponentType<{ name: string }>;
  return renderToStaticMarkup(React.createElement(Header, { name: 'Fixture Artist' }));
}

test('profile header renders verified aliases, kind/country, localized biography and safe official links', () => {
  const html = render({ name: 'Fixture Artist', imageUrl: null, description: null, genres: ['Pop'], descriptions: { en: 'Verified biography. '.repeat(20) }, aliases: ['Alternate Name'], kind: 'person', country: 'JP', links: { website: 'https://example.com/artist', youtube: 'javascript:alert(1)' }, sources: [{ label: 'Manual', url: null, fields: ['descriptions'] }] });
  assert.match(html, /Alternate Name/);
  assert.match(html, /Japan/);
  assert.match(html, /artistProfile.kindPerson/);
  assert.match(html, /lang="en"/);
  assert.match(html, /Verified biography/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /href="https:\/\/example.com\/artist"/);
  assert.match(html, /artistProfile.sources/);
  assert.doesNotMatch(html, /javascript:|artistProfile.edit/);
});

test('only authenticated administrators see the correction action; absent facts are not invented', () => {
  const publicHtml = render(null);
  assert.match(publicHtml, /Fixture Artist/);
  assert.doesNotMatch(publicHtml, /artistProfile.edit|artistProfile.kindPerson|artist-profile-facts/);
  const adminHtml = render(null, true);
  assert.match(adminHtml, /artistProfile.edit/);
});
