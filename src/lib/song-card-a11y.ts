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
