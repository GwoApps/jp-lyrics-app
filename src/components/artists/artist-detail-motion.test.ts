import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { groupArtistAlbums, splitArtists } from '@/lib/artists';
import { formatDbDate, formatDbDateTime, parseDbTimestamp } from '@/lib/db-time';

const require = createRequire(import.meta.url);
const directory = dirname(fileURLToPath(import.meta.url));
function render(resource: object) {
  const cache = new Map<string, Record<string, unknown>>();
  function load(path: string): Record<string, unknown> {
    if (cache.has(path)) return cache.get(path)!;
    const exports: Record<string, unknown> = {};
    cache.set(path, exports);
    runInNewContext(ts.transpileModule(readFileSync(path, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText, { exports, require(specifier: string) {
      if (specifier.endsWith('.css')) return {};
      if (specifier === 'next/link') return { __esModule: true, default: (props: Record<string, unknown>) => {
        const attributes = { ...props };
        delete attributes.prefetch;
        return React.createElement('a', attributes);
      } };
      if (specifier === '@/lib/i18n') return { useI18n: () => ({ t: (key: string) => key, locale: 'en' }) };
      if (specifier === '@/lib/db-time') return { formatDbDate, formatDbDateTime, parseDbTimestamp };
      if (specifier === '@/lib/artists') return { groupArtistAlbums, splitArtists };
      if (specifier === '@/lib/auth-session') return { useAuthSession: () => ({ session: { user: null } }), refreshAuthSession: () => Promise.resolve() };
      if (specifier === '@/components/home/FavoriteCategoriesDialog') return { __esModule: true, default: () => null };
      if (specifier === '@/components/SpotifyLoginButton') return { __esModule: true, default: (props: Record<string, unknown>) => React.createElement('button', props) };
      if (specifier === './ArtistProfileHeader') return { __esModule: true, default: () => React.createElement('header', null, 'Artist') };
      if (specifier.includes('ArtistBackButton')) return { __esModule: true, default: () => React.createElement('a', { href: '/artists' }, 'artists.back') };
      if (specifier === './ArtistAvatar') return { ArtistAvatar: () => React.createElement('span', { className: 'artist-avatar' }) };
      if (specifier === './profile-queue') return { requestArtistProfile: () => Promise.resolve(null), profileSourceHref: () => undefined };
      if (specifier === './artist-profile-cache') return { getCachedArtistProfile: () => null };
      if (specifier === './useArtistResource') return { useArtistResource: () => ({ state: resource, retry() {} }) };
      if (specifier === '@/components/ArtistLinks') return { __esModule: true, default: ({ artist }: { artist: string }) => React.createElement('span', null, artist) };
      if (specifier === '@/components/CoverImage') return { __esModule: true, default: () => React.createElement('span', { className: 'cover' }) };
      if (specifier.startsWith('./')) {
        const base = resolve(dirname(path), specifier);
        const target = [base, `${base}.ts`, `${base}.tsx`].find((candidate) => existsSync(candidate));
        if (target) return load(target);
      }
      return require(specifier);
    } });
    return exports;
  }
  const Page = load(resolve(directory, 'ArtistDetailPage.tsx')).default as React.ComponentType<{ name: string }>;
  return renderToStaticMarkup(React.createElement(Page, { name: 'Artist' }));
}

test('detail loading is a localized busy status with six noninteractive song-shaped skeletons', () => {
  const html = render({ status: 'loading' });
  assert.match(html, /role="status"[^>]*aria-busy="true"/);
  assert.match(html, /common.loading/);
  assert.equal((html.match(/class="artist-song artist-song-skeleton"/g) ?? []).length, 6);
  assert.match(html, /class="artist-songs" aria-hidden="true"/);
  assert.doesNotMatch(html, /role="tablist"/);
});

test('success keeps all rows and both persistent panels, with only the active panel accessible', () => {
  const songs = Array.from({ length: 237 }, (_, index) => ({ id: String(index), title: `Song ${index}`, artist: 'Artist', spotify_album: 'Unknown album' }));
  const html = render({ status: 'ready', data: { artist: { name: 'Artist' }, songs, albums: [{ key: 'unknown', title: 'Unknown album', artist: 'Artist', songs }] } });
  assert.equal((html.match(/class="artist-song-title"/g) ?? []).length, 474);
  const panels = html.match(/<section[^>]*role="tabpanel"[^>]*>/g) ?? [];
  assert.equal(panels.length, 2);
  assert.doesNotMatch(panels[0], /hidden=""|aria-hidden="true"|inert=""/);
  assert.match(panels[1], /hidden=""/);
  assert.match(panels[1], /aria-hidden="true"/);
  assert.match(panels[1], /inert=""/);
  assert.match(html, /class="artist-tab-panels"/);
  assert.match(html, /Unknown album/);
  assert.doesNotMatch(html, /artist-song-skeleton/);
});
