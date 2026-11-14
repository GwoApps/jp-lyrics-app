export interface AlbumSong {
  id: string;
  artist: string;
  spotify_album?: string | null;
}

export interface SongAlbumGroup<T extends AlbumSong> {
  key: string;
  album: string | null;
  artist: string | null;
  songs: T[];
}

export type SongAlbumEntry<T extends AlbumSong> =
  | { type: 'group'; group: SongAlbumGroup<T> }
  | { type: 'song'; song: T };

interface InternalGroup<T extends AlbumSong> extends SongAlbumGroup<T> {
  titleKeys: Set<string>;
}

function normalizeGroupValue(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase();
}

/**
 * Group known Spotify albums by album + artist. Skip single-song albums whose
 * title equals the track title. Songs without a usable album are returned
 * separately so the caller can flatten them into the outer list.
 */
export function groupSongsByAlbum<T extends AlbumSong & { title: string }>(
  songs: T[],
): { entries: SongAlbumEntry<T>[]; unclassified: T[] } {
  const collected = new Map<string, InternalGroup<T>>();
  const unclassified: T[] = [];

  for (const song of songs) {
    const album = song.spotify_album?.trim() || null;
    const artist = song.artist.trim() || null;
    if (!album) {
      unclassified.push(song);
      continue;
    }
    const key = `${normalizeGroupValue(artist ?? '')}\u0000${normalizeGroupValue(album)}`;
    const group = collected.get(key) ?? { key, album, artist, songs: [], titleKeys: new Set() };
    group.songs.push(song);
    group.titleKeys.add(normalizeGroupValue(song.title));
    collected.set(key, group);
  }

  const groups: SongAlbumGroup<T>[] = [];
  for (const group of Array.from(collected.values())) {
    const singleSongAlbum = group.songs.length === 1 && group.titleKeys.size === 1;
    const albumEqualsTitle = singleSongAlbum && group.titleKeys.has(normalizeGroupValue(group.album!));
    if (albumEqualsTitle) unclassified.push(...group.songs);
    else groups.push(group);
  }

  groups.sort((left, right) =>
    left.album!.localeCompare(right.album!, undefined, { sensitivity: 'base' })
      || (left.artist ?? '').localeCompare(right.artist ?? '', undefined, { sensitivity: 'base' }));

  return { entries: groups.map((group) => ({ type: 'group', group })), unclassified };
}

export interface AlbumList<T extends AlbumSong & { title: string }> {
  groups: SongAlbumGroup<T>[];
  /** Songs no album can own: no `spotify_album`, or a single whose title is the album. */
  looseSongs: T[];
  /** Every song the album view renders, grouped and loose alike (#425). */
  trackCount: number;
}

/** Album view model: the groups plus the songs that stay ungrouped, counted once. */
export function buildAlbumList<T extends AlbumSong & { title: string }>(songs: T[]): AlbumList<T> {
  const { entries, unclassified } = groupSongsByAlbum(songs);
  const groups = entries.flatMap((entry) => (entry.type === 'group' ? [entry.group] : []));
  // Keep the incoming order for the flat run: grouping appends demoted singles
  // after the albumless ones, which would look arbitrary in the list.
  const looseIds = new Set(unclassified.map((song) => song.id));
  const looseSongs = songs.filter((song) => looseIds.has(song.id));
  const trackCount = groups.reduce((count, group) => count + group.songs.length, looseSongs.length);
  return { groups, looseSongs, trackCount };
}
