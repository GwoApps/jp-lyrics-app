import { groupArtistAlbums, splitArtists } from '@/lib/artists';
import type { SongItem } from '@/lib/types';

// The artist-detail endpoint supplies these optional, normalized summary fields.
// Keeping them optional also supports old fixtures; absence is never false.
export type ArtistLibrarySong = SongItem & {
  spotify_duration_ms?: number | null;
  has_lyrics?: boolean | null;
  has_synced_timeline?: boolean | null;
  has_furigana?: boolean | null;
  has_translation?: boolean | null;
  lyrics_translation_lang?: string | null;
  favorited?: boolean | null;
};
export type QualityFilter = 'all' | 'available' | 'missing' | 'unknown';
export type LibraryView = {
  tab: 'songs' | 'albums';
  query: string;
  sort: 'name' | 'created' | 'updated';
  credit: 'all' | 'solo' | 'collab';
  review: 'all' | 'needsReview';
  lyrics: QualityFilter;
  timeline: QualityFilter;
  furigana: QualityFilter;
  translation: QualityFilter;
  expandedAlbumKeys: string[];
};
export const qualityFields = { lyrics: 'has_lyrics', timeline: 'has_synced_timeline', furigana: 'has_furigana', translation: 'has_translation' } as const;
export type QualityKind = keyof typeof qualityFields;
export const qualityKinds = Object.keys(qualityFields) as QualityKind[];
export const qualityState = (flag: unknown): Exclude<QualityFilter, 'all'> => flag === true ? 'available' : flag === false ? 'missing' : 'unknown';
export function defaultLibraryView(): LibraryView {
  return { tab: 'songs', query: '', sort: 'name', credit: 'all', review: 'all', lyrics: 'all', timeline: 'all', furigana: 'all', translation: 'all', expandedAlbumKeys: [] };
}
const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase().trim();
function parseSongTimestamp(value: string | null | undefined): { date: Date; wallClock: boolean } | null {
  if (!value) return null;
  // Naive database dates are calendar/wall-clock values. A fixed reference
  // keeps both sorting and rendering independent of the browser's timezone;
  // it does not assert that the server's local timestamp was a UTC instant.
  const wallClock = /^\d{4}-\d\d-\d\d(?:[ T]\d\d:\d\d:\d\d(?:\.\d{1,3})?)?$/.test(value);
  const normalized = wallClock ? (value.length === 10 ? `${value}T00:00:00Z` : value.replace(' ', 'T') + 'Z') : value;
  const date = new Date(normalized);
  return Number.isFinite(date.getTime()) ? { date, wallClock } : null;
}
const timestamp = (value: string) => parseSongTimestamp(value)?.date.getTime() ?? -Infinity;

export function filterArtistSongs(songs: readonly ArtistLibrarySong[], view: LibraryView, locale: string): ArtistLibrarySong[] {
  const terms = normalize(view.query).split(/\s+/).filter(Boolean);
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
  return songs.filter((song) => {
    const credits = splitArtists(song.artist);
    if (view.credit === 'solo' && credits.length !== 1) return false;
    if (view.credit === 'collab' && credits.length <= 1) return false;
    if (view.review === 'needsReview' && song.lyrics_needs_review !== 1) return false;
    if (qualityKinds.some((kind) => view[kind] !== 'all' && qualityState(song[qualityFields[kind]]) !== view[kind])) return false;
    const haystack = normalize([song.title, song.spotify_album ?? '', song.artist].join(' '));
    return terms.every((term) => haystack.includes(term));
  }).sort((a, b) => {
    if (view.sort !== 'name') {
      const field = view.sort === 'created' ? 'created_at' : 'updated_at';
      const left = timestamp(a[field]);
      const right = timestamp(b[field]);
      if (left !== right) return left > right ? -1 : 1;
    }
    return collator.compare(a.title, b.title) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });
}

export function groupMatchingAlbums(songs: readonly ArtistLibrarySong[], sort: LibraryView['sort'], locale: string) {
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
  const field = sort === 'created' ? 'created_at' : 'updated_at';
  const groups = groupArtistAlbums(songs).map((album) => ({
    album, newest: album.songs.reduce((latest, song) => Math.max(latest, timestamp(song[field])), -Infinity),
  }));
  return groups.sort((a, b) => {
    if (sort !== 'name' && a.newest !== b.newest) return a.newest > b.newest ? -1 : 1;
    return collator.compare(a.album.title, b.album.title) || collator.compare(a.album.key, b.album.key);
  }).map(({ album }) => album);
}

export function formatTranslationLanguage(tag: string | null | undefined, locale: string): string | null {
  if (!tag) return null;
  try { return new Intl.DisplayNames([locale], { type: 'language' }).of(tag) ?? null; }
  catch { return null; }
}

export function formatSongDuration(ms: number | null | undefined, locale: string): string | null {
  if (typeof ms !== 'number' || !Number.isSafeInteger(ms) || ms <= 0) return null;
  const seconds = Math.floor(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  const number = new Intl.NumberFormat(locale, { useGrouping: false });
  const padded = new Intl.NumberFormat(locale, { useGrouping: false, minimumIntegerDigits: 2 });
  return hours
    ? `${number.format(hours)}:${padded.format(Math.floor(seconds / 60) % 60)}:${padded.format(seconds % 60)}`
    : `${number.format(Math.floor(seconds / 60))}:${padded.format(seconds % 60)}`;
}
export function formatSongDate(value: string | null | undefined, locale: string): string | null {
  const parsed = parseSongTimestamp(value);
  return parsed ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', ...(parsed.wallClock ? { timeZone: 'UTC' } : {}) }).format(parsed.date) : null;
}
export function spotifyTrackHref(id: string | null | undefined): string | null {
  return typeof id === 'string' && /^[A-Za-z0-9]{22}$/.test(id) ? `https://open.spotify.com/track/${id}` : null;
}

/** Only called after an explicit favorite edit, never once for every rendered row. */
export async function readFavoriteStatus(songId: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  const response = await fetcher(`/api/songs/${encodeURIComponent(songId)}/favorite`, { cache: 'no-store' });
  if (response.status === 401) throw new Error('login_required');
  if (!response.ok) throw new Error('favorite_read_failed');
  const data: unknown = await response.json();
  if (!data || typeof data !== 'object' || !('favorited' in data) || typeof data.favorited !== 'boolean') throw new Error('favorite_read_failed');
  return data.favorited;
}
