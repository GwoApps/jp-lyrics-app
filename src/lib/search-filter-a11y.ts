import type { TranslateFn } from './song-card-a11y.ts';

export type SearchListKind = 'songs' | 'albums';

/**
 * Accessible name for the mobile search toggle. When a query is still applied
 * but the input is collapsed the button announces the active filter too, so
 * `aria-expanded=false` no longer reads as "nothing is filtered" (#371).
 */
export function searchToggleLabel(
  query: string,
  baseLabel: string,
  t: TranslateFn,
): string {
  return query ? t('home.searchButtonFiltering', { query }) : baseLabel;
}

/** Visible text of the collapsed-search chip that keeps the filter explainable. */
export function searchChipLabel(query: string, t: TranslateFn): string {
  return t('home.searchChip', { query });
}

/** Accessible name of the chip's clear action, naming the query it drops. */
export function clearSearchLabel(query: string, t: TranslateFn): string {
  return t('home.clearSearchFilter', { query });
}

/**
 * Empty-state copy. With a query applied it names the query, so an empty list
 * reads as "this search matched nothing", not "the library has no songs".
 * A category filter is the same kind of invisible filter (#392): when it is the
 * only reason the list is empty, name the collection instead of reusing the
 * search-empty copy — the user never searched anything.
 */
export function noResultsMessage(
  listKind: SearchListKind,
  query: string,
  t: TranslateFn,
  collectionName?: string | null,
): string {
  if (query) {
    return t(listKind === 'albums' ? 'home.noAlbumResultsFor' : 'home.noResultsFor', { query });
  }
  if (collectionName) return t('home.collectionEmpty', { name: collectionName });
  return t(listKind === 'albums' ? 'home.noAlbumResults' : 'home.noResults');
}
