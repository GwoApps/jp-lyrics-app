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

function normalizeGroupValue(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase();
}

/** Group known Spotify albums by album + artist; songs without album metadata share one unclassified group. */
export function groupSongsByAlbum<T extends AlbumSong>(songs: T[]): SongAlbumGroup<T>[] {
  const groups = new Map<string, SongAlbumGroup<T>>();
  for (const song of songs) {
    const album = song.spotify_album?.trim() || null;
    const artist = song.artist.trim() || null;
    const key = album ? `${normalizeGroupValue(artist ?? '')}\u0000${normalizeGroupValue(album)}` : '__unclassified__';
    const group = groups.get(key) ?? { key, album, artist: album ? artist : null, songs: [] };
    group.songs.push(song);
    groups.set(key, group);
  }
  return [...groups.values()].sort((left, right) => {
    if (left.album === null) return 1;
    if (right.album === null) return -1;
    return left.album.localeCompare(right.album, undefined, { sensitivity: 'base' })
      || (left.artist ?? '').localeCompare(right.artist ?? '', undefined, { sensitivity: 'base' });
  });
}
