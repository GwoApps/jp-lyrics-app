import { desc, asc } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import * as schema from './schema.ts';
import { songVisibilityWhere, type SongViewer } from './song-visibility.ts';
import { artistKey, groupArtistAlbums, groupSongsByArtist, splitArtists, type ArtistLibrary, type ArtistProfile } from './artists.ts';
import type { SongItem } from './types';

type ArtistDB = Pick<BaseSQLiteDatabase<'async', unknown, typeof schema>, 'select'>;
const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' };

/** All aggregations start here, after SQL ACL filtering. Never cache these rows. */
export async function listVisibleArtistSongs(db: ArtistDB, viewer: SongViewer | null | undefined): Promise<SongItem[]> {
  return db.select({
    id: schema.songs.id,
    title: schema.songs.title,
    artist: schema.songs.artist,
    cover_url: schema.songs.coverUrl,
    spotify_track_id: schema.songs.spotifyTrackId,
    spotify_album: schema.songs.spotifyAlbum,
    created_by: schema.songs.createdBy,
    created_by_name: schema.songs.createdByName,
    is_public: schema.songs.isPublic,
    public_requested: schema.songs.publicRequested,
    created_at: schema.songs.createdAt,
    updated_at: schema.songs.updatedAt,
    lyrics_needs_review: schema.songs.lyricsNeedsReview,
  }).from(schema.songs).where(songVisibilityWhere(viewer))
    .orderBy(desc(schema.songs.updatedAt), asc(schema.songs.id));
}

export function findArtistLibrary(songs: SongItem[], name: string): ArtistLibrary | null {
  const key = artistKey(name);
  if (!key) return null;
  const matched = songs.filter((song) => splitArtists(song.artist).some((token) => artistKey(token) === key));
  const artist = groupSongsByArtist(matched).find((entry) => artistKey(entry.name) === key);
  if (!artist) return null;
  return { artist, songs: matched, albums: groupArtistAlbums(matched) };
}

export async function getArtistLibrary(db: ArtistDB, viewer: SongViewer | null | undefined, name: string): Promise<ArtistLibrary | null> {
  return findArtistLibrary(await listVisibleArtistSongs(db, viewer), name);
}

export function emptyArtistProfile(name: string): ArtistProfile {
  return { name, imageUrl: null, description: null, genres: [], source: null, sourceUrl: null };
}

interface ArtistApiDependencies<TRequest extends Request> {
  getDB: () => ArtistDB;
  getUser: (request: TRequest) => Promise<SongViewer | null>;
  getProfile: (name: string, songs: readonly SongItem[], viewer: SongViewer | null) => Promise<ArtistProfile>;
}

/** Dependency injection keeps request-level ACL and HTTP contracts executable in tests. */
export function createArtistApiHandlers<TRequest extends Request>(deps: ArtistApiDependencies<TRequest>) {
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE_HEADERS });
  const failed = () => json({ error: 'artist_library_failed' }, 500);
  const missing = () => json({ error: 'artist_not_found' }, 404);
  const load = async (request: TRequest, name: string) => {
    const viewer = await deps.getUser(request);
    return getArtistLibrary(deps.getDB(), viewer, name);
  };
  return {
    async list(request: TRequest) {
      try {
        const viewer = await deps.getUser(request);
        return json({ artists: groupSongsByArtist(await listVisibleArtistSongs(deps.getDB(), viewer)) });
      } catch { return failed(); }
    },
    async detail(request: TRequest, name: string) {
      try {
        const library = await load(request, name);
        return library ? json(library) : missing();
      } catch { return failed(); }
    },
    async profile(request: TRequest, name: string) {
      try {
        // Membership MUST be checked before any upstream lookup or metadata cache read.
        const viewer = await deps.getUser(request);
        const library = await getArtistLibrary(deps.getDB(), viewer, name);
        if (!library) return missing();
        let profile: ArtistProfile;
        try { profile = await deps.getProfile(library.artist.name, library.songs, viewer); }
        catch { profile = emptyArtistProfile(library.artist.name); }
        return json({ profile });
      } catch { return failed(); }
    },
  };
}
