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

interface InternalGroup<T extends AlbumSong> extends SongAlbumGroup<T> {
  titleKeys: Set<string>;
}

function normalizeGroupValue(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase();
}

/** Group known Spotify albums by album + artist. Skip single-song albums whose title equals the track title. */
export function groupSongsByAlbum<T extends AlbumSong & { title: string }>(songs: T[]): SongAlbumGroup<T>[] {
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

  if (unclassified.length) groups.push({ key: '__unclassified__', album: null, artist: null, songs: unclassified });
  return groups.sort((left, right) => {
    if (left.album === null) return 1;
    if (right.album === null) return -1;
    return left.album.localeCompare(right.album, undefined, { sensitivity: 'base' })
      || (left.artist ?? '').localeCompare(right.artist ?? '', undefined, { sensitivity: 'base' });
  });
}
