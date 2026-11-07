import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  clearSearchLabel,
  noResultsMessage,
  searchChipLabel,
  searchToggleLabel,
} from './search-filter-a11y.ts';
import type { TranslateFn } from './song-card-a11y.ts';

const here = dirname(fileURLToPath(import.meta.url));
const read = (path: string) => readFileSync(join(here, '..', path), 'utf8');

const t: TranslateFn = (key, vars) => {
  let value = `[${key}]`;
  if (vars) for (const [k, v] of Object.entries(vars)) value = value.replace(`{${k}}`, String(v));
  return value;
};

test('searchToggleLabel falls back to the plain name when nothing is filtered', () => {
  assert.equal(searchToggleLabel('', 'Search songs', t), 'Search songs');
});

test('searchToggleLabel names the live query so aria-expanded=false is not read as "unfiltered"', () => {
  assert.equal(searchToggleLabel('夜', 'Search songs', t), '[home.searchButtonFiltering]');
  assert.equal(
    searchToggleLabel('夜', 'Search songs', (key, vars) => `${key}:${vars?.query}`),
    'home.searchButtonFiltering:夜',
  );
});

test('searchChipLabel and clearSearchLabel both carry the query', () => {
  const interpolate: TranslateFn = (key, vars) => `${key}:${vars?.query}`;
  assert.equal(searchChipLabel('夜', interpolate), 'home.searchChip:夜');
  assert.equal(clearSearchLabel('夜', interpolate), 'home.clearSearchFilter:夜');
});

test('noResultsMessage names the query that produced the empty list', () => {
  assert.equal(noResultsMessage('songs', '夜', t), '[home.noResultsFor]');
  assert.equal(noResultsMessage('albums', '夜', t), '[home.noAlbumResultsFor]');
  assert.equal(
    noResultsMessage('songs', '夜', (key, vars) => `${key}:${vars?.query}`),
    'home.noResultsFor:夜',
  );
});

test('noResultsMessage keeps the plain empty-state copy when no query applies', () => {
  assert.equal(noResultsMessage('songs', '', t), '[home.noResults]');
  assert.equal(noResultsMessage('albums', '', t), '[home.noAlbumResults]');
});

test('mobile toolbar keeps the applied search visible and clearable after collapsing', () => {
  const bar = read('components/home/SongFilterBar.tsx');
  // Chip renders in the collapsed branch (the `else` of the expanded input).
  assert.match(bar, /\{mobileSearchOpen \? \([\s\S]*?: appliedQuery && \(/);
  assert.ok(bar.includes('searchChipLabel(appliedQuery, t)'));
  assert.ok(bar.includes('aria-label={clearSearchLabel(appliedQuery, t)}'));
  assert.ok(bar.includes('onClick={() => onSearchChange(\'\')}'));
});

test('list filtering and the empty state both key off the trimmed query', () => {
  const page = read('components/home/SongLibraryPage.tsx');
  assert.ok(page.includes('const appliedSearch = searchQuery.trim();'));
  assert.match(page, /if \(appliedSearch\) \{\s*const q = appliedSearch\.toLowerCase\(\);/);
  assert.ok(page.includes('noResultsMessage(listKind, appliedSearch, t)'));
  // Empty state offers a clear action next to the explanation.
  assert.match(page, /\{appliedSearch && \([\s\S]*?setSearchQuery\(''\)/);
});
