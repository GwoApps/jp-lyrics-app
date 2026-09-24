/** Minimal translation function signature compatible with useI18n().t. */
export type TranslateFn = (
  key: string,
  vars?: Record<string, string | number>,
) => string;

/**
 * Accessible name for the favorite toggle button. Reflects the current state
 * so screen readers announce both the action and which song it targets.
 */
export function favoriteLabel(
  isFavorite: boolean,
  title: string,
  t: TranslateFn,
): string {
  return t(isFavorite ? 'home.removeFromFavorites' : 'home.addToFavorites', {
    title,
  });
}

/**
 * Accessible name for the delete button. Delete is destructive, so the song
 * title is included so assistive-technology users can confirm the target.
 */
export function deleteSongLabel(title: string, t: TranslateFn): string {
  return t('home.deleteSongLabel', { title });
}

/**
 * Accessible name for a collection's delete button. Delete is destructive, so
 * the collection name is included so assistive-technology users can confirm
 * the target — mirroring deleteSongLabel for songs.
 */
export function deleteCollectionLabel(name: string, t: TranslateFn): string {
  return t('home.deleteCollectionLabel', { name });
}

/**
 * Accessible name for the applied-filter chip. As a button its only visible
 * content is the collection name plus a bare ✕ icon, so the name spells out
 * that activating it clears the filter.
 */
export function clearCollectionFilterLabel(name: string, t: TranslateFn): string {
  return t('home.clearCollectionFilterLabel', { name });
}

/**
 * Accessible name for the collection row. As a selectable option its visible
 * text is the collection name and count; the name states the action so screen
 * readers announce what activating the row does in its current state.
 */
export function collectionRowLabel(
  name: string,
  selected: boolean,
  t: TranslateFn,
): string {
  return t(selected ? 'home.unfilterByCollection' : 'home.filterByCollection', {
    name,
  });
}
