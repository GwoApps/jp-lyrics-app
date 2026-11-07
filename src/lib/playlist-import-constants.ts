/**
 * Playlist-import sizes that both the server chunker and the client progress loop
 * must agree on.
 *
 * Kept apart from `playlist-import.ts` on purpose: that module imports the DB,
 * so a client component reading a constant from it would pull `fs` into the
 * browser bundle and break `next build`.
 */

/** How many tracks one Worker request may process before returning. */
export const PLAYLIST_CHUNK_SIZE = 8;
/**
 * How far the client advances its cursor after one `PUT`.
 *
 * The server derives a track's playlist slot as `offset + (position in chunk)`,
 * so both sides must agree on the hop size — including the degenerate case where
 * the playlist shrank between two chunks (the server still advances by
 * `PLAYLIST_CHUNK_SIZE`). The client mirrors the server cursor but keeps its own
 * copy of the size to attribute each returned row to the right slot.
 */
export const PLAYLIST_CHUNK_HOP = PLAYLIST_CHUNK_SIZE;
/** Error code returned by `GET` when a persisted result can no longer be mapped to a playlist slot. */
export const PLAYLIST_IMPORT_RESUME_UNSUPPORTED = 'resume_unsupported';
/** Upper bound on tracks per job — protects the playlist fetch itself. */
export const PLAYLIST_MAX_TRACKS = 200;
/** Hard timeout for a single external lyrics fetch (LRCLIB + PetitLyrics + …). */
export const LYRICS_FETCH_TIMEOUT_MS = 20_000;
