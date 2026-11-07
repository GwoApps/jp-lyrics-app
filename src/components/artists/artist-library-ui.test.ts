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
import * as artists from '@/lib/artists';
import { defaultLibraryView, type ArtistLibrarySong, type LibraryView } from './artist-library-model.ts';

const require = createRequire(import.meta.url);
const directory = dirname(fileURLToPath(import.meta.url));
const song = (id: string, extras: Partial<ArtistLibrarySong> = {}): ArtistLibrarySong => ({ id, title: id, artist: 'Artist', spotify_album: 'Album', created_by: 'test', created_by_name: 'Test', is_public: 1, public_requested: 0, created_at: '2026-01-01', updated_at: '2026-01-02', ...extras });
const songs = [song('Blue', { artist: 'Artist, Guest', lyrics_needs_review: 1, has_lyrics: true, has_synced_timeline: false, has_translation: null, favorited: true, spotify_duration_ms: 185000, spotify_track_id: '0123456789ABCDEFGHIJKL' }), song('Amber', { spotify_album: 'Other', favorited: false })];

type Node = React.ReactElement<Record<string, unknown>>;
function nodes(root: React.ReactNode): Node[] {
  if (!React.isValidElement(root)) return [];
  const node = root as Node;
  return [node, ...React.Children.toArray(node.props.children as React.ReactNode).flatMap(nodes)];
}
function harness(options: { view?: LibraryView; locale?: string; signedIn?: boolean } = {}) {
  let requests = 0;
  const cache = new Map<string, Record<string, unknown>>();
  const t = (key: string, values?: Record<string, string | number>) => key === 'artistLibrary.matchingCounts' ? `Matches ${values?.songs} songs / ${values?.albums} albums` : key === 'home.songCount' ? `Scope ${values?.count} songs` : key === 'home.albumCount' ? `Scope ${values?.count} albums` : key;
  const resource = { status: 'ready', data: { artist: { name: 'Artist', songCount: 2, albumCount: 2 }, songs, albums: artists.groupArtistAlbums(songs) } };
  function load(path: string): Record<string, unknown> {
    if (cache.has(path)) return cache.get(path)!;
    const exports: Record<string, unknown> = {};
    cache.set(path, exports);
    const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    runInNewContext(code, { exports, fetch: () => { requests++; throw new Error('unexpected_row_fetch'); }, require: (specifier: string) => {
      if (specifier.endsWith('.css')) return {};
      if (specifier === '@/lib/i18n') return { useI18n: () => ({ t, locale: options.locale ?? 'en' }) };
      if (specifier === '@/lib/artists') return artists;
      if (specifier === '@/lib/auth-session') return { useAuthSession: () => ({ session: { user: options.signedIn === false ? null : { email: 'test@example.test' } } }), refreshAuthSession: async () => null };
      if (specifier === './useArtistResource') return { useArtistResource: () => ({ state: resource, retry() {} }) };
      if (specifier === './useArtistLibraryView' && options.view) return { useArtistLibraryView: () => ({ view: options.view, updateView() {}, saveBeforeNavigation() {} }) };
      if (specifier === './ArtistProfileHeader') return { __esModule: true, default: ({ name }: { name: string }) => React.createElement('header', {}, name) };
      if (specifier.includes('ArtistBackButton')) return { __esModule: true, default: () => React.createElement('a', { href: '/artists' }, 'back') };
      if (specifier === '@/components/home/FavoriteCategoriesDialog') return { __esModule: true, default: () => null };
      if (specifier === '@/components/SpotifyLoginButton') return { __esModule: true, default: ({ children, ...props }: { children: React.ReactNode }) => React.createElement('button', props, children) };
      if (specifier === '@/components/ArtistLinks') return { __esModule: true, default: ({ artist }: { artist: string }) => React.createElement('span', {}, artist) };
      if (specifier === '@/components/CoverImage') return { __esModule: true, default: () => React.createElement('span', { className: 'cover' }) };
      if (specifier === 'next/link') return { __esModule: true, default: (props: Record<string, unknown>) => { const attributes = { ...props }; delete attributes.prefetch; return React.createElement('a', attributes); } };
      if (specifier.startsWith('./')) {
        const base = resolve(dirname(path), specifier);
        const target = [base, `${base}.ts`, `${base}.tsx`].find((candidate) => existsSync(candidate));
        if (target) return load(target);
      }
      return require(specifier);
    } });
    return exports;
  }
  return {
    component: (file: string) => load(resolve(directory, file)).default as (props: Record<string, unknown>) => React.ReactElement,
    render: (file: string, props: Record<string, unknown> = {}) => renderToStaticMarkup(React.createElement(load(resolve(directory, file)).default as React.ComponentType<object>, props)),
    get requests() { return requests; },
  };
}

test('real controls use labeled native search/selects; every filter is independent and reset retains the current tab/expansions', () => {
  const h = harness();
  const changes: Array<Partial<LibraryView>> = [];
  const view: LibraryView = { ...defaultLibraryView(), tab: 'albums', expandedAlbumKeys: ['album'], query: 'something', credit: 'solo', lyrics: 'missing' };
  const props = { view, panelId: 'filters-test', onChange: (change: Partial<LibraryView>) => changes.push(change) };
  const tree = h.component('ArtistLibraryControls.tsx')(props);
  const elements = nodes(tree);
  const selects = elements.filter((node) => node.type === 'select');
  assert.equal(selects.length, 7);
  assert.equal(elements.filter((node) => node.type === 'input' && node.props.type === 'search').length, 1);
  (selects[1].props.onChange as (event: object) => void)({ target: { value: 'collab' } });
  assert.deepEqual(JSON.parse(JSON.stringify(changes[0])), { credit: 'collab' });
  const reset = elements.find((node) => node.type === 'button' && String(node.props.className).includes('artist-library-reset'))!;
  (reset.props.onClick as () => void)();
  assert.deepEqual(JSON.parse(JSON.stringify(changes[1])), { ...defaultLibraryView(), tab: 'albums', expandedAlbumKeys: ['album'] });
  const html = h.render('ArtistLibraryControls.tsx', props);
  assert.equal((html.match(/<label/g) ?? []).length, 8);
  assert.doesNotMatch(html, /aria-pressed|role="switch"/);
});

test('filters are initially collapsed; toggling preserves criteria and reset preserves the disclosure', () => {
  const h = harness(); const changes: Array<Partial<LibraryView>> = [];
  const view = { ...defaultLibraryView(), credit: 'collab' as const, sort: 'updated' as const, lyrics: 'unknown' as const };
  const props = { view, panelId: 'compact-filters', onChange: (change: Partial<LibraryView>) => changes.push(change) };
  const elements = nodes(h.component('ArtistLibraryControls.tsx')(props));
  const toggle = elements.find(n => n.props['aria-controls'] === 'compact-filters')!;
  assert.ok(toggle); assert.equal(toggle.props['aria-expanded'], false);
  assert.equal(elements.find(n => n.props.id === 'compact-filters')!.props.hidden, true);
  assert.equal(elements.find(n => n.props.className === 'artist-library-filter-count')!.props.children, 3);
  (toggle.props.onClick as () => void)();
  assert.deepEqual(JSON.parse(JSON.stringify(changes[0])), { filtersOpen: true });
  const opened = nodes(h.component('ArtistLibraryControls.tsx')({ ...props, view: { ...view, filtersOpen: true } }));
  assert.equal(opened.find(n => n.props.id === 'compact-filters')!.props.hidden, false);
  (opened.find(n => String(n.props.className).includes('artist-library-reset'))!.props.onClick as () => void)();
  assert.equal(changes[1].filtersOpen, true); assert.equal(changes[1].credit, 'all');
});

test('real song rows expose neutral known/unknown metadata, a review warning, and only valid Spotify links', () => {
  const h = harness();
  const html = h.render('ArtistLibrarySongs.tsx', { songs, signedIn: true, favoriteOverrides: {}, onFavorite() {} });
  assert.match(html, /3:05/);
  assert.match(html, /artistLibrary.durationUnknown/);
  assert.doesNotMatch(html, /0:00/);
  assert.match(html, /data-status="available"/);
  assert.match(html, /data-status="missing"/);
  assert.match(html, /data-status="unknown"/);
  assert.equal((html.match(/class="artist-library-review"/g) ?? []).length, 1);
  assert.equal((html.match(/https:\/\/open.spotify.com\/track\//g) ?? []).length, 1);
  assert.match(html, /target="_blank" rel="noopener noreferrer"/);
  assert.match(html, /data-favorite-status="true"/);
  assert.match(html, /data-favorite-status="false"/);
  assert.equal(h.requests, 0, 'no GET per rendered song');
});

test('favorite actions open the shared category editor callback, never toggle/delete memberships from a row', () => {
  const h = harness();
  const opened: ArtistLibrarySong[] = [];
  const tree = h.component('ArtistLibrarySongs.tsx')({ songs, signedIn: true, favoriteOverrides: {}, onFavorite: (item: ArtistLibrarySong) => opened.push(item) });
  const actions = nodes(tree).filter((node) => node.type === 'button' && 'data-favorite-status' in node.props);
  for (const button of actions) (button.props.onClick as () => void)();
  assert.deepEqual(opened, songs);
  assert.equal(h.requests, 0);
  const guest = h.render('ArtistLibrarySongs.tsx', { songs, signedIn: false, favoriteOverrides: { Blue: true }, onFavorite() { throw new Error('guest editor'); } });
  assert.match(guest, /artistLibrary.loginToFavorite/);
  assert.doesNotMatch(guest, /aria-pressed="true"|data-favorite-status="true"/);
  const unknown = h.render('ArtistLibrarySongs.tsx', { songs: [songs[0]], signedIn: true, favoriteOverrides: { Blue: null }, onFavorite() {} });
  assert.match(unknown, /data-favorite-status="unknown"/);
  assert.doesNotMatch(unknown, /aria-pressed=/);
});

test('album panels suppress repeated artist labels while the songs tab keeps credits', () => {
  const html = harness().render('ArtistDetailPage.tsx', { name: 'Artist' });
  const songPanel = html.split('data-artist-panel="songs"')[1].split('data-artist-panel="albums"')[0];
  const albumPanel = html.split('data-artist-panel="albums"')[1];
  assert.match(songPanel, /class="artist-song-artist"/);
  assert.doesNotMatch(albumPanel, /class="artist-album-artist"|class="artist-song-artist"/);
  assert.match(albumPanel, /artist-song-title/);
});

test('real page keeps full ACL-visible scope counts separate from filtered counts and filters album songs before grouping', () => {
  const h = harness({ view: { ...defaultLibraryView(), query: 'Blue' } });
  const html = h.render('ArtistDetailPage.tsx', { name: 'Artist' });
  assert.match(html, /Scope 2 songs/);
  assert.match(html, /Scope 2 albums/);
  assert.match(html, /Matches 1 songs \/ 1 albums/);
  assert.equal((html.match(/class="artist-song-title"/g) ?? []).length, 2);
  assert.equal((html.match(/<details /g) ?? []).length, 1);
  assert.doesNotMatch(html, />Amber<|artistLibrary.noMatches/);
  assert.equal((html.match(/role="tabpanel"/g) ?? []).length, 2);
  assert.equal(h.requests, 0);
});

test('real page restores the initial expanded album and exposes an empty-search reset without hiding full scope counts', () => {
  const expanded = harness({ view: { ...defaultLibraryView(), tab: 'albums', expandedAlbumKeys: ['album'] } }).render('ArtistDetailPage.tsx', { name: 'Artist' });
  assert.match(expanded, /<details class="artist-album" open=""/);
  const empty = harness({ view: { ...defaultLibraryView(), query: 'nothing matches' } }).render('ArtistDetailPage.tsx', { name: 'Artist' });
  assert.match(empty, /Scope 2 songs/);
  assert.match(empty, /Matches 0 songs \/ 0 albums/);
  assert.match(empty, /artistLibrary.noMatches/);
  assert.match(empty, /artistLibrary.reset/);
  assert.doesNotMatch(empty, /class="artist-song-title"/);
});

for (const locale of ['en', 'ja', 'zh-CN', 'zh-TW']) test(`real row metadata renders with Intl in ${locale}`, () => {
  const html = harness({ locale }).render('ArtistLibrarySongs.tsx', { songs: [songs[0]], signedIn: false, favoriteOverrides: {}, onFavorite() {} });
  assert.match(html, /3:05/);
  assert.doesNotMatch(html, /Invalid Date|NaN|undefined/);
});
