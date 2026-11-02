import { defaultLibraryView, qualityKinds, type LibraryView, type QualityFilter } from './artist-library-model';

export const historyViewKey = '__jplrcArtistLibraryV1';
type HistoryRecord = { route: string; entryId: string; view: LibraryView; scrollY: number };
export type LibraryHistoryPort = {
  read: () => { pathname: string; state: unknown; scrollY: number };
  replace: (state: Record<string, unknown>) => void;
};
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const scrollValue = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;

/** Only UI fields are serialized; never persist an API response or private song rows. */
export function normalizeLibraryView(value: unknown): LibraryView {
  const source = object(value);
  const view = defaultLibraryView();
  if (source.tab === 'albums') view.tab = 'albums';
  if (typeof source.query === 'string') view.query = source.query;
  if (source.sort === 'created' || source.sort === 'updated') view.sort = source.sort;
  if (source.credit === 'solo' || source.credit === 'collab') view.credit = source.credit;
  if (source.review === 'needsReview') view.review = source.review;
  for (const kind of qualityKinds) {
    if (['all', 'available', 'missing', 'unknown'].includes(String(source[kind]))) view[kind] = source[kind] as QualityFilter;
  }
  if (Array.isArray(source.expandedAlbumKeys)) view.expandedAlbumKeys = [...new Set(source.expandedAlbumKeys.filter((key): key is string => typeof key === 'string'))];
  return view;
}
function recordFrom(state: unknown, route: string): HistoryRecord | null {
  const value = object(object(state)[historyViewKey]);
  if (value.route !== route || typeof value.entryId !== 'string') return null;
  return { route, entryId: value.entryId, view: normalizeLibraryView(value.view), scrollY: scrollValue(value.scrollY) };
}

/** A captured entry owns writes only while BOTH its route and entry token still match. */
export function createArtistLibraryHistory(port: LibraryHistoryPort, route: string, newEntryId: string) {
  const initial = port.read();
  const restored = initial.pathname === route ? recordFrom(initial.state, route) : null;
  const entryId = restored?.entryId ?? newEntryId;
  const initialView = restored?.view ?? defaultLibraryView();
  const initialScroll = restored?.scrollY ?? 0;
  const isCurrent = () => {
    const current = port.read();
    return current.pathname === route && recordFrom(current.state, route)?.entryId === entryId;
  };
  return {
    initialView, initialScroll, isCurrent,
    attach() {
      const current = port.read();
      if (current.pathname !== route) return false;
      const existing = recordFrom(current.state, route);
      if (existing) return existing.entryId === entryId;
      try {
        port.replace({ ...object(current.state), [historyViewKey]: { route, entryId, view: initialView, scrollY: initialScroll } });
        return true;
      } catch { return false; }
    },
    save(view: LibraryView, scrollY: number) {
      const current = port.read();
      if (current.pathname !== route || recordFrom(current.state, route)?.entryId !== entryId) return false;
      try {
        port.replace({ ...object(current.state), [historyViewKey]: { route, entryId, view: normalizeLibraryView(view), scrollY: scrollValue(scrollY) } });
        return true;
      } catch { return false; }
    },
  };
}
