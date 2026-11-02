import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { artistHref, artistKey, splitArtists } from '@/lib/artists';
import type { ArtistLibrary } from './types';

const require = createRequire(import.meta.url);
const directory = dirname(fileURLToPath(import.meta.url));
const dictionary = JSON.parse(readFileSync(resolve(directory, '../../i18n/en.json'), 'utf8')) as Record<string, Record<string, string>>;
function t(key: string, values?: Record<string, string | number>) {
  const [namespace, name] = key.split('.');
  let result = dictionary[namespace]?.[name] ?? key;
  for (const [token, value] of Object.entries(values ?? {})) result = result.replace(`{${token}}`, String(value));
  return result;
}

/** Render real TSX and shared links; only navigation and the HTTP hook are replaced. */
function renderPage(file: string, resource: object, props: object = {}) {
  const cache = new Map<string, Record<string, unknown>>();
  function load(path: string): Record<string, unknown> {
    if (cache.has(path)) return cache.get(path)!;
    const compiled = ts.transpileModule(readFileSync(path, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    const exports: Record<string, unknown> = {};
    cache.set(path, exports);
    const Link = (props: Record<string, unknown>) => {
      const attributes = { ...props };
      delete attributes.prefetch;
      return React.createElement('a', attributes);
    };
    runInNewContext(compiled, {
      exports,
      require: (specifier: string) => {
        if (specifier === 'next/link') return { __esModule: true, default: Link };
        if (specifier === 'next-view-transitions') return { Link, useTransitionRouter: () => ({ replace: () => {} }) };
        if (specifier === '@/lib/i18n') return { useI18n: () => ({ t }) };
        if (specifier === '@/lib/artists') return { artistHref, artistKey, splitArtists };
        if (specifier === './useArtistResource') return { useArtistResource: () => ({ state: resource, retry: () => {} }) };
        if (specifier.endsWith('.css')) return {};
        if (specifier === '@/components/ArtistLinks') return load(resolve(directory, '../ArtistLinks.tsx'));
        if (specifier === '@/components/CoverImage') return load(resolve(directory, '../CoverImage.tsx'));
        if (specifier === './ArtistAvatar') return load(resolve(directory, 'ArtistAvatar.tsx'));
        if (specifier === './ArtistBackButton' || specifier === '@/components/artists/ArtistBackButton') return load(resolve(directory, 'ArtistBackButton.tsx'));
        if (specifier === './artist-profile-cache') return load(resolve(directory, 'artist-profile-cache.ts'));
        if (specifier === './artist-back-navigation') return load(resolve(directory, 'artist-back-navigation.ts'));
        if (specifier === './profile-queue') return { profileSourceHref: () => undefined, requestArtistProfile: () => Promise.resolve(null) };
        if (specifier.startsWith('./')) {
          const base = resolve(dirname(path), specifier);
          const target = [base, `${base}.ts`, `${base}.tsx`].find((candidate) => existsSync(candidate));
          if (target) return load(target);
        }
        return require(specifier);
      },
    });
    return exports;
  }
  const Component = load(resolve(directory, file)).default as React.ComponentType<object>;
  return renderToStaticMarkup(React.createElement(Component, props));
}

function assertNoNestedAnchors(html: string) {
  let depth = 0;
  for (const token of html.match(/<a\b[^>]*>|<\/a>/g) ?? []) {
    depth += token.startsWith('</') ? -1 : 1;
    assert.ok(depth >= 0 && depth <= 1, 'title and artist anchors are siblings');
  }
  assert.equal(depth, 0);
}

test('artist directory is a linked grid without a grid/list switch or album thumbnails', () => {
  const html = renderPage('ArtistsPage.tsx', { status: 'ready', data: { artists: [{ name: 'AC/DC', songCount: 123, albumCount: 9 }] } });
  assert.match(html, /artists-grid/);
  assert.match(html, /href="\/artists\/AC%2FDC"/);
  assert.match(html, /123 songs/);
  assert.match(html, /9 albums/);
  assert.match(html, /type="search"/);
  assert.match(html, /artist-avatar/);
  assert.doesNotMatch(html, /aria-pressed|List view|Grid view|<img/);
  assertNoNestedAnchors(html);
});

test('all local songs and album groups render, including title-equals-song singles', () => {
  const songs = Array.from({ length: 237 }, (_, index) => ({ id: `song-${index}`, title: `Local track ${index}`, artist: 'Aimer, AC/DC', spotify_album: `Album ${index}`, created_by: 'test', created_by_name: 'Test', is_public: 1, public_requested: 0, created_at: '', updated_at: '' }));
  const library: ArtistLibrary = {
    artist: { name: 'Aimer', songCount: songs.length, albumCount: songs.length },
    songs,
    albums: songs.map((song) => ({ key: song.id, title: song.title, artist: song.artist, coverUrl: null, songs: [song] })),
  };
  const html = renderPage('ArtistDetailPage.tsx', { status: 'ready', data: library }, { name: 'Aimer' });
  assert.match(html, /237 songs/);
  assert.match(html, /237 albums/);
  assert.equal((html.match(/class="artist-song-title"/g) ?? []).length, 474);
  assert.equal((html.match(/<details /g) ?? []).length, 237);
  assert.match(html, /Local track 236/);
  assert.match(html, /href="\/songs\/song-236"/);
  assert.match(html, /href="\/artists\/AC%2FDC"/);
  assert.match(html, /role="tablist"/);
  assert.equal((html.match(/role="tab"/g) ?? []).length, 2);
  assert.equal((html.match(/role="tabpanel"/g) ?? []).length, 2);
  assertNoNestedAnchors(html);
});

test('directory loading, failed and empty resources have localized accessible states', () => {
  const loading = renderPage('ArtistsPage.tsx', { status: 'loading' });
  assert.match(loading, /role="status"/);
  assert.match(loading, /Loading/);
  const error = renderPage('ArtistsPage.tsx', { status: 'error', notFound: false });
  assert.match(error, /role="alert"/);
  assert.match(error, /Could not load artists/);
  assert.match(error, /Try again/);
  const empty = renderPage('ArtistsPage.tsx', { status: 'ready', data: { artists: [] } });
  assert.match(empty, /No artists in your lyric library yet/);
  assert.match(empty, /Try again/);
});

test('artist names absent from the library show a localized 404 and directory link', () => {
  const html = renderPage('ArtistDetailPage.tsx', { status: 'error', notFound: true }, { name: 'Missing artist' });
  assert.match(html, /This artist is not in your lyric library/);
  assert.match(html, /href="\/artists"/);
  assert.match(html, /Try again/);
  assert.doesNotMatch(html, /role="tablist"/);
});
