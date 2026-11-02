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
import { artistHref, splitArtists } from './artists';

const require = createRequire(import.meta.url);
const src = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const surfaces = [
  'components/SongItemCard.tsx',
  'components/NowPlayingMetadata.tsx',
  'components/ConfirmDialog.tsx',
  'components/home/SongLibraryPage.tsx',
  'components/home/PlaylistImportDialog.tsx',
  'components/timeline/SpotifyStatusCard.tsx',
  'components/song/ImmersiveLyricsControls.tsx',
  'components/admin/AdminSongList.tsx',
  'components/admin/AdminPendingList.tsx',
  'components/admin/AdminQueueList.tsx',
  'components/admin/AdminQueueDetail.tsx',
  'components/admin/SongPreviewDialog.tsx',
  'app/songs/[id]/page.tsx',
  'app/songs/[id]/timeline/edit/page.tsx',
  'app/songs/[id]/furigana/edit/page.tsx',
];

for (const surface of surfaces) {
  test(`${surface} uses shared artist links outside existing interactive controls`, () => {
    const code = readFileSync(resolve(src, surface), 'utf8');
    const ast = ts.createSourceFile(surface, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let links = 0;
    function visit(node: ts.Node) {
      if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText(ast) === 'ArtistLinks') {
        links++;
        for (let parent = node.parent; parent; parent = parent.parent) {
          if (ts.isJsxElement(parent)) {
            assert.ok(!['a', 'Link', 'button'].includes(parent.openingElement.tagName.getText(ast)), `${surface}: artist links must not be inside anchors/buttons`);
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
    assert.ok(links > 0, 'visible credits use the shared renderer');
  });
}

const dictionary = JSON.parse(readFileSync(resolve(src, 'i18n/en.json'), 'utf8')) as Record<string, Record<string, string>>;
const t = (key: string) => {
  const [namespace, name] = key.split('.');
  return dictionary[namespace]?.[name] ?? key;
};
const cache = new Map<string, Record<string, unknown>>();
function load(file: string): Record<string, unknown> {
  if (cache.has(file)) return cache.get(file)!;
  const compiled = ts.transpileModule(readFileSync(resolve(src, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const exports: Record<string, unknown> = {};
  cache.set(file, exports);
  runInNewContext(compiled, {
    exports,
    require: (specifier: string) => {
      if (specifier === 'next-view-transitions') return { Link: 'a' };
      if (specifier === '@/components/ArtistLinks') return load('components/ArtistLinks.tsx');
      if (specifier === '@/components/CoverImage') return { __esModule: true, default: () => React.createElement('span', { 'data-cover': true }) };
      if (specifier === '@/components/ui/dialog') return { __esModule: true, default: ({ children }: { children: React.ReactNode }) => React.createElement('div', {}, children) };
      if (specifier === '@/hooks/useCoverPalette') return { useCoverPalette: () => null };
      if (specifier === '@/lib/artists') return { artistHref, splitArtists };
      if (specifier === '@/lib/i18n') return { useI18n: () => ({ t }) };
      if (specifier === './admin-types') return load('components/admin/admin-types.ts');
      return require(specifier);
    },
  });
  return exports;
}

function render(file: string, props: object) {
  const Component = load(file).default as React.ComponentType<object>;
  return renderToStaticMarkup(React.createElement(Component, props));
}

function assertIndependentLinks(html: string) {
  let anchorDepth = 0;
  let buttonDepth = 0;
  for (const token of html.match(/<\/?(?:a|button)\b[^>]*>/g) ?? []) {
    if (token.startsWith('</a')) anchorDepth--;
    else if (token.startsWith('<a')) {
      anchorDepth++;
      assert.equal(buttonDepth, 0, 'artist anchors are not nested inside buttons');
    } else if (token.startsWith('</button')) buttonDepth--;
    else buttonDepth++;
    assert.ok(anchorDepth >= 0 && anchorDepth <= 1, 'anchors are never nested');
  }
  assert.equal(anchorDepth, 0);
  assert.equal(buttonDepth, 0);
  assert.match(html, /href="\/artists\/Aimer"/);
  assert.match(html, /href="\/artists\/AC%2FDC"/);
}

const song = { id: 'song-1', title: 'A song', artist: ' Aimer , AC/DC ', created_by_name: 'Listener', updated_at: '2026-01-01', created_at: '2026-01-01' };
for (const variant of ['list', 'grid']) {
  test(`rendered ${variant} song card keeps song navigation, individual artist links and playback actions independent`, () => {
    const html = render('components/SongItemCard.tsx', {
      song, variant, isPlaying: true, spotifyConnected: true, isFavorite: false, locale: 'en',
      unknownArtistLabel: 'Unknown artist', createdByLabel: 'Created by', needsReviewLabel: 'Review', shareLabel: 'Share',
      openSongLabel: () => 'Open song', favoriteLabel: () => 'Favorite', deleteLabel: () => 'Delete',
      onPrefetch: () => {}, onToggleFavorite: () => {}, onShare: () => {}, onDelete: () => {},
    });
    assertIndependentLinks(html);
    assert.match(html, /href="\/songs\/song-1"/);
    assert.match(html, /song-item-card--playing/);
    assert.match(html, /aria-label="Favorite"/);
    assert.match(html, /aria-label="Share"/);
    assert.match(html, /aria-label="Delete"/);
  });
}

test('rendered queue rows keep artist navigation outside the selectable queue control', () => {
  const html = render('components/admin/AdminQueueList.tsx', { songs: [song], selectedId: song.id, locale: 'en', onSelect: () => {} });
  assertIndependentLinks(html);
  assert.match(html, /aria-pressed="true"/);
  assert.doesNotMatch(html, /role="listbox"|role="option"/);
});

test('rendered now playing metadata links each artist without changing the track title', () => {
  const html = render('components/NowPlayingMetadata.tsx', { track: { id: song.id, name: song.title, artist: song.artist } });
  assertIndependentLinks(html);
  assert.match(html, /A song/);
});

test('localized review dialog text embeds individual artist links at the explicit artist placeholder only', () => {
  const { artistLinkedDialogBody, ARTIST_LINK_MARKER } = load('components/ConfirmDialog.tsx') as {
    artistLinkedDialogBody: (text: string, artist: string) => React.ReactNode;
    ARTIST_LINK_MARKER: string;
  };
  const body = artistLinkedDialogBody(`Aimer is also in the title — ${ARTIST_LINK_MARKER} (source)`, song.artist);
  const html = render('components/ConfirmDialog.tsx', { open: true, title: 'Review', body, confirmLabel: 'Confirm', onConfirm: () => {} });
  assertIndependentLinks(html);
  assert.match(html, /Aimer is also in the title/);
  assert.match(html, /\(source\)/);
  assert.doesNotMatch(html, /\uFFF0artist\uFFF1/);
});
