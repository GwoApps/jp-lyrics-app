/**
 * Issue #462 — the red delete button is a destructive action and must follow
 * the server's edit permission, not merely "is the user signed in".
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import React from 'react';
import ts from 'typescript';

const require = createRequire(import.meta.url);
type Element = React.ReactElement<Record<string, unknown>>;
const source = readFileSync(new URL('./SongItemCard.tsx', import.meta.url), 'utf8');

function nodes(root: React.ReactNode): Element[] {
  if (!React.isValidElement(root)) return [];
  const node = root as Element;
  return [node, ...React.Children.toArray(node.props.children as React.ReactNode).flatMap(nodes)];
}

function render(options: { canEdit: boolean; spotifyConnected?: boolean; emptyReason?: 'never-fetched' | 'not-found' }): Element {
  const exports: { default?: (props: Record<string, unknown>) => React.ReactNode } = {};
  const hooks = {
    useRef: () => ({ current: null }),
    useState: (initial: unknown) => [initial, () => {}],
    useEffect: () => {},
  };
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  runInNewContext(code, { exports, require: (specifier: string) => {
    if (specifier === 'react') return hooks;
    if (specifier === 'lucide-react') return new Proxy({}, { get: (_target, name) => name });
    if (specifier === 'next/link' || specifier === '@/components/navigation/ViewTransitions') {
      return { Link: (props: Record<string, unknown>) => React.createElement('a', props) };
    }
    if (specifier === '@/components/CoverImage') return { __esModule: true, default: () => React.createElement('span', { className: 'cover' }) };
    if (specifier === '@/components/ArtistLinks') return { __esModule: true, default: () => React.createElement('span', { className: 'artist' }) };
    if (specifier === '@/hooks/useCoverPalette') return { useCoverPalette: () => null };
    if (specifier === '@/lib/db-time') return { formatDbDate: () => 'date' };
    return require(specifier);
  } });
  const props: Record<string, unknown> = {
    song: { id: 'song-1', title: 'Song', artist: 'Artist', created_by_name: 'Owner', updated_at: '2026-01-01', ...(options.emptyReason ? { empty_lyrics_reason: options.emptyReason } : {}) },
    isPlaying: false,
    spotifyConnected: options.spotifyConnected ?? true,
    canEdit: options.canEdit,
    isFavorite: false,
    locale: 'en',
    unknownArtistLabel: 'Unknown',
    createdByLabel: 'By',
    needsReviewLabel: 'Needs review',
    emptyLyricsNeverFetchedLabel: 'Not fetched',
    emptyLyricsNotFoundLabel: 'No lyrics found',
    shareLabel: 'Share',
    openSongLabel: (title: string) => `Open ${title}`,
    favoriteLabel: (title: string) => `Favorite ${title}`,
    deleteLabel: (title: string) => `Delete ${title}`,
    onPrefetch: () => {},
    onToggleFavorite: () => {},
    onShare: () => {},
    onDelete: () => {},
  };
  return exports.default!(props) as Element;
}

function actionButtons(tree: Element): Element[] {
  const actions = nodes(tree).find((node) => String(node.props.className).includes('song-item-card__actions'))!;
  return nodes(actions).filter((node) => node.type === 'button');
}

test('delete button follows canEdit, while favorite and share keep the login gate', () => {
  assert.equal(actionButtons(render({ canEdit: true })).length, 3);
  const readonly = actionButtons(render({ canEdit: false }));
  assert.equal(readonly.length, 2);
  assert.ok(readonly.every((button) => button.props['aria-label'] !== 'Delete Song'));

  const anon = actionButtons(render({ canEdit: true, spotifyConnected: false }));
  assert.equal(anon.length, 0);
});

test('empty songs show the reason badge chosen by the list API', () => {
  const content = nodes(render({ canEdit: false, emptyReason: 'never-fetched' })).find((node) =>
    String(node.props.className ?? '').includes('song-item-card__content'),
  )!;
  const badges = nodes(content).filter((node) => String(node.props.className ?? '').includes('rounded-full'));
  assert.deepEqual(badges.map((node) => node.props.children), ['Not fetched']);
  assert.deepEqual(nodes(render({ canEdit: false })).filter((node) =>
    String(node.props.className ?? '').includes('bg-[var(--muted)]'),
  ), []);
});
