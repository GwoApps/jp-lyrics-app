import { and, desc, asc, sql } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import * as schema from './schema.ts';
import { songVisibilityWhere, type SongViewer } from './song-visibility.ts';
import { artistKey, groupArtistAlbums, groupSongsByArtist, splitArtists, type ArtistLibrary, type ArtistProfile } from './artists.ts';
import type { SongItem } from './types';
import { summarizeSongLibraryContent } from './song-library-summary.ts';

type ArtistDB = Pick<BaseSQLiteDatabase<'async', unknown, typeof schema>, 'select'>;
const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' };

const ARTIST_SONG_COLUMNS = {
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
};

/** All aggregations start here, after SQL ACL filtering. Never cache these rows. */
export async function listVisibleArtistSongs(db: ArtistDB, viewer: SongViewer | null | undefined): Promise<SongItem[]> {
  return db.select(ARTIST_SONG_COLUMNS).from(schema.songs).where(songVisibilityWhere(viewer))
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
  const membership = findArtistLibrary(await listVisibleArtistSongs(db, viewer), name);
  if (!membership) return null;
  const email = viewer?.email;
  const rows = await db.select({
    song: ARTIST_SONG_COLUMNS,
    content: {
      spotify_duration_ms: schema.songs.spotifyDurationMs,
      lyrics_raw: schema.songs.lyricsRaw,
      lyrics_synced: schema.songs.lyricsSynced,
      lyrics_furigana: schema.songs.lyricsFurigana,
      lyrics_translation: schema.songs.lyricsTranslation,
      lyrics_translation_lang: schema.songs.lyricsTranslationLang,
    },
    // Match GET /songs/[id]/favorite: existence, not in_unclassified, and email
    // rather than a separate auth ID. The composite PK makes this an indexed
    // bulk projection in this one SQL request, never a per-song API/DB call.
    favorite: email ? sql<number>`EXISTS (
      SELECT 1 FROM ${schema.favorites}
      WHERE ${schema.favorites.songId} = ${schema.songs.id}
        AND ${schema.favorites.userEmail} = ${email}
    )` : sql<null>`NULL`,
  }).from(schema.songs).where(and(
    songVisibilityWhere(viewer),
    // SQLite/D1 JSON1 keeps the selection parameterized with ONE bind, even
    // beyond D1's bind limit. No truncation, per-row queries or huge IN lists.
    sql`${schema.songs.id} IN (SELECT value FROM json_each(${JSON.stringify(membership.songs.map((song) => song.id))}))`,
  )).orderBy(desc(schema.songs.updatedAt), asc(schema.songs.id));
  // Rebuild aggregates from the second ACL-checked read, so a visibility/credit
  // change between reads cannot leak a formerly visible row or stale counts.
  return findArtistLibrary(rows.map(({ song, content, favorite }) => ({
    ...song,
    ...summarizeSongLibraryContent(content),
    favorited: email ? favorite === 1 : null,
  })), name);
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
        if (library === null) return missing();
        return json(library);
      } catch { return failed(); }
    },
    async profile(request: TRequest, name: string) {
      try {
        // Membership MUST be checked before any upstream lookup or metadata cache read.
        const viewer = await deps.getUser(request);
        const library = findArtistLibrary(await listVisibleArtistSongs(deps.getDB(), viewer), name);
        if (!library) return missing();
        let profile: ArtistProfile;
        try { profile = await deps.getProfile(library.artist.name, library.songs, viewer); }
        catch { profile = emptyArtistProfile(library.artist.name); }
        return json({ profile });
      } catch { return failed(); }
    },
  };
}
