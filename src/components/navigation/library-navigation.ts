import { startArtistViewTransition } from '@/components/artists/artist-directory-transition';

const lists = new Set(['/', '/albums', '/artists']);
export function isLibraryRoute(pathname: string): boolean { return lists.has(pathname); }
export function isLibraryNavigation(from: string, to: string): boolean {
  return from !== to && isLibraryRoute(from) && isLibraryRoute(to);
}

/** Types scope this fade to list navigation; detail shared elements keep their
 * existing timing. Older native implementations still receive a plain callback. */
export function startRouteViewTransition(document: Document, update: ViewTransitionUpdateCallback, from: string, to: string): ViewTransition {
  const typed = isLibraryNavigation(from, to) && document.defaultView?.CSS?.supports('selector(:active-view-transition-type(library-navigation))');
  return startArtistViewTransition(document, typed ? { update, types: ['library-navigation'] } : update);
}
