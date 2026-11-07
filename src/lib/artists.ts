import type { SongItem } from './types';

export interface ArtistSummary {
  name: string;
  songCount: number;
  albumCount: number;
}

export interface ArtistProfile {
  name: string;
  imageUrl: string | null;
  description: string | null;
  genres: string[];
  source: string | null;
  sourceUrl: string | null;
  aliases?: string[];
  kind?: import('./artist-profile-types').ArtistProfileKind;
  country?: string | null;
  descriptions?: Partial<Record<import('./artist-profile-types').ArtistProfileLocale, string>>;
  links?: import('./artist-profile-types').ArtistProfileLinks;
  sources?: import('./artist-profile-types').ArtistProfileSource[];
  updatedAt?: string | null;
  bindings?: import('./artist-profile-types').ArtistProfileBindings;
}

export interface ArtistAlbum<T = SongItem> {
  key: string;
  title: string;
  artist: string;
  coverUrl: string | null;
  songs: T[];
}

export interface ArtistLibrary {
  artist: ArtistSummary;
  songs: SongItem[];
  albums: ArtistAlbum[];
}

export function artistKey(name: string): string {
  return name.trim().toLowerCase();
}

/** Only ASCII comma is a credit separator. Other punctuation is part of a name. */
export function splitArtists(value: string | null | undefined): string[] {
  const names = new Map<string, string>();
  for (const token of (value ?? '').split(',')) {
    const name = token.trim();
    if (name && !names.has(artistKey(name))) names.set(artistKey(name), name);
  }
  return [...names.values()];
}

export function artistHref(name: string): string {
  return `/artists/${encodeURIComponent(name.trim())}`;
}

export function compareArtistNames(left: string, right: string): number {
  const a = artistKey(left);
  const b = artistKey(right);
  return a < b ? -1 : a > b ? 1 : left < right ? -1 : left > right ? 1 : 0;
}

type ArtistSong = { id: string; artist: string; spotify_album?: string | null; cover_url?: string | null };

/** Artist-scoped fallback album identity: known titles include singles and featured tracks. */
export function groupArtistAlbums<T extends ArtistSong>(songs: readonly T[]): ArtistAlbum<T>[] {
  const groups = new Map<string, ArtistAlbum<T>>();
  const seen = new Set<string>();
  for (const song of songs) {
    if (seen.has(song.id)) continue;
    seen.add(song.id);
    const title = song.spotify_album?.trim();
    if (!title) continue;
    const credits = splitArtists(song.artist);
    // Callers pass only one artist's visible songs. Per-track featured credits
    // are not album identity; no canonical album ID is stored in this schema.
    const key = artistKey(title);
    const group = groups.get(key) ?? { key, title, artist: '', coverUrl: null, songs: [] };
    if (compareArtistNames(title, group.title) < 0) group.title = title;
    group.artist = splitArtists([group.artist, ...credits].join(', ')).sort(compareArtistNames).join(', ');
    if (!group.coverUrl && song.cover_url) group.coverUrl = song.cover_url;
    group.songs.push(song);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => compareArtistNames(a.title, b.title) || compareArtistNames(a.artist, b.artist));
}

export function groupSongsByArtist<T extends ArtistSong>(songs: readonly T[]): ArtistSummary[] {
  const groups = new Map<string, { name: string; songs: Map<string, T> }>();
  for (const song of songs) {
    for (const name of splitArtists(song.artist)) {
      const key = artistKey(name);
      const group = groups.get(key) ?? { name, songs: new Map<string, T>() };
      if (compareArtistNames(name, group.name) < 0) group.name = name;
      group.songs.set(song.id, song);
      groups.set(key, group);
    }
  }
  return [...groups.values()].map(({ name, songs }) => ({
    name, songCount: songs.size, albumCount: groupArtistAlbums([...songs.values()]).length,
  })).sort((a, b) => compareArtistNames(a.name, b.name));
}
