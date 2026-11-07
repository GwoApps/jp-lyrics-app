import assert from 'node:assert/strict';
import test from 'node:test';
import { createArtistLibraryHistory, historyViewKey, normalizeLibraryView, type LibraryHistoryPort } from './artist-library-history.ts';
import { defaultLibraryView } from './artist-library-model.ts';

function harness() {
  let current = { pathname: '/artists/Aimer', state: { __NA: true, tree: ['next-router-tree'], unrelated: 7 } as Record<string, unknown>, scrollY: 0 };
  let writes = 0;
  const port: LibraryHistoryPort = {
    read: () => current,
    replace: (state) => { current = { ...current, state }; writes++; },
  };
  return { port, get current() { return current; }, get writes() { return writes; }, navigate: (value: typeof current) => { current = value; } };
}

test('per-entry view and scroll restore without storing songs or losing Next history metadata', () => {
  const browser = harness();
  const entry = createArtistLibraryHistory(browser.port, '/artists/Aimer', 'first');
  assert.equal(browser.writes, 0, 'construction is read-only');
  assert.equal(entry.attach(), true);
  const view = { ...defaultLibraryView(), tab: 'albums' as const, query: 'Night', credit: 'collab' as const, review: 'needsReview' as const, translation: 'missing' as const, sort: 'updated' as const, expandedAlbumKeys: ['night'] };
  assert.equal(entry.save(view, 580), true);
  assert.deepEqual(browser.current.state.tree, ['next-router-tree']);
  assert.equal(browser.current.state.__NA, true);
  assert.equal(browser.current.state.unrelated, 7);
  const restored = createArtistLibraryHistory(browser.port, '/artists/Aimer', 'unused');
  assert.deepEqual(restored.initialView, view);
  assert.equal(restored.initialScroll, 580);
  assert.equal(JSON.stringify(browser.current.state).includes('songs":['), false);
});

test('route navigation and same-route different history entries cannot be overwritten by an old owner', () => {
  const browser = harness();
  const old = createArtistLibraryHistory(browser.port, '/artists/Aimer', 'first');
  old.attach();
  old.save({ ...defaultLibraryView(), query: 'keep me' }, 100);
  const original = browser.current;
  browser.navigate({ pathname: '/songs/a', state: { __NA: true }, scrollY: 0 });
  assert.equal(old.isCurrent(), false, 'a delayed scroll restoration must not target the destination');
  assert.equal(old.save(defaultLibraryView(), 0), false);
  assert.deepEqual(browser.current.state, { __NA: true });
  browser.navigate({ pathname: '/artists/Aimer', state: { __NA: true }, scrollY: 0 });
  const fresh = createArtistLibraryHistory(browser.port, '/artists/Aimer', 'second');
  fresh.attach();
  assert.equal(fresh.initialView.query, '');
  assert.equal(old.save(defaultLibraryView(), 0), false);
  browser.navigate(original);
  const back = createArtistLibraryHistory(browser.port, '/artists/Aimer', 'third');
  assert.equal(back.initialView.query, 'keep me');
  assert.equal(back.initialScroll, 100);
});

test('filter disclosure restores per entry, rejects non-booleans, and never clears active hidden filters', () => {
  const view = normalizeLibraryView({ filtersOpen: true, lyrics: 'missing', sort: 'created' });
  assert.equal(view.filtersOpen, true); assert.equal(view.lyrics, 'missing');
  assert.equal(normalizeLibraryView({ filtersOpen: 'true' }).filtersOpen, false);
  const browser = harness(), entry = createArtistLibraryHistory(browser.port, '/artists/Aimer', 'disclosure');
  entry.attach(); entry.save(view, 100);
  assert.equal(createArtistLibraryHistory(browser.port, '/artists/Aimer', 'new').initialView.filtersOpen, true);
  entry.save({ ...view, filtersOpen: false }, 100);
  const restored = createArtistLibraryHistory(browser.port, '/artists/Aimer', 'new').initialView;
  assert.equal(restored.filtersOpen, false); assert.equal(restored.lyrics, 'missing'); assert.equal(restored.sort, 'created');
});

test('history restoration validates enum values and serializes only an explicit safe UI allowlist', () => {
  const view = normalizeLibraryView({ query: 'A', sort: 'bogus', credit: 'collab', lyrics: null, translation: 'unknown', expandedAlbumKeys: ['night', 8, 'night'], songs: [{ private: 'secret' }], tab: 'albums' });
  assert.equal(view.sort, 'name');
  assert.equal(view.lyrics, 'all');
  assert.equal(view.translation, 'unknown');
  assert.deepEqual(view.expandedAlbumKeys, ['night']);
  assert.equal('songs' in view, false);
  assert.deepEqual(normalizeLibraryView(null), defaultLibraryView());
  const browser = harness();
  browser.navigate({ ...browser.current, state: { [historyViewKey]: { route: '/artists/Other', entryId: 'other', view, scrollY: 80 } } });
  const entry = createArtistLibraryHistory(browser.port, '/artists/Aimer', 'aimer');
  assert.equal(entry.initialView.query, '');
  entry.attach();
  entry.save(view, -100);
  assert.equal(createArtistLibraryHistory(browser.port, '/artists/Aimer', 'new').initialScroll, 0);
});
