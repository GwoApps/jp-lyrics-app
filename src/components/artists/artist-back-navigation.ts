/** Navigation API hides cross-origin entries, so false cannot override real browser history. */
export function canNavigateBack(historyLength: number, navigationCanGoBack?: boolean): boolean {
  return navigationCanGoBack === true || historyLength > 1;
}

export function navigateArtistBack(canGoBack: boolean, history: Pick<History, 'back'>, replace: (path: string) => void) {
  if (canGoBack) history.back();
  else replace('/artists');
}
