import { getDB, schema, eq } from './db';
import { nowUtcSql } from './db-time-sql.ts';
import { isFetchTimeoutError } from './fetch-timeout';
import {
  createSpotifyClient,
  normalizeSpotifyTrack,
  type SpotifyApiClient,
  type SpotifyResult,
  type SpotifyTrackMetadata,
} from './spotify-api';

export {
  SPOTIFY_CLIENT_ID,
  SPOTIFY_CLIENT_SECRET,
  SPOTIFY_REDIRECT_URI,
  SPOTIFY_SCOPES,
  base64Encode,
  normalizeSpotifyTrack,
  type SpotifyTrackMetadata,
} from './spotify-api';

/**
 * Spotify service layer: owns the token lifecycle (storage + refresh) and the
 * track-metadata helpers on top of the client in `spotify-api.ts`. Routes call
 * these functions with their own parameters and never build an HTTP request
 * themselves.
 */

/** Renew tokens this many seconds before they expire. */
const REFRESH_MARGIN_S = 60;

/**
 * Get a valid Spotify access token for a specific user (refresh if needed).
 *
 * Returns `null` when the token is genuinely unavailable ("not connected").
 * A refresh that exceeds its budget throws {@link FetchTimeoutError} instead:
 * this function is the entry point of every Spotify route (`/now-playing`,
 * `/seek`, `/playback`, song import, sync, playlist import), so an unbounded
 * refresh used to hang all of them at once. Callers must map the throw to their
 * own transient/timeout code — never to "not connected", which would tell the
 * user their account is broken (issue #117, #370).
 */
export async function getSpotifyTokenForUser(userEmail: string): Promise<string | null> {
  const db = getDB();
  const auth = await db.select({
    accessToken: schema.spotifyAuth.accessToken,
    refreshToken: schema.spotifyAuth.refreshToken,
    expiresAt: schema.spotifyAuth.expiresAt,
  }).from(schema.spotifyAuth).where(eq(schema.spotifyAuth.userEmail, userEmail)).get();

  if (!auth || !auth.accessToken) return null;

  if (Math.floor(Date.now() / 1000) <= auth.expiresAt - REFRESH_MARGIN_S) {
    return auth.accessToken;
  }

  if (!auth.refreshToken) return null;
  const refreshed = await createSpotifyClient().refreshAccessToken(auth.refreshToken);
  if (!refreshed.ok) return null;

  const expiresAt = Math.floor(Date.now() / 1000) + refreshed.data.expires_in;
  await db.update(schema.spotifyAuth).set({
    accessToken: refreshed.data.access_token,
    expiresAt,
    updatedAt: nowUtcSql(),
  }).where(eq(schema.spotifyAuth.userEmail, userEmail));
  return refreshed.data.access_token;
}

/**
 * Spot the current session for `userEmail`, or `null` when there is none.
 * A stalled refresh resolves to `null` here — token lookup is the optional part.
 */
async function sessionFor(userEmail: string): Promise<SpotifyApiClient | null> {
  let accessToken: string | null;
  try {
    accessToken = await getSpotifyTokenForUser(userEmail);
  } catch (error) {
    if (isFetchTimeoutError(error)) return null; // metadata is optional
    throw error;
  }
  return accessToken ? createSpotifyClient({ accessToken }) : null;
}

/**
 * Run one optional metadata read for a user.
 *
 * "Optional" is the whole contract: a missing token, a stalled refresh and a
 * stalled read all mean "Spotify had no canonical metadata", which the lyrics
 * chain already handles, so the #241/#348 fallback still runs instead of the
 * import hanging on the #370 deadline (issue #370).
 */
async function readOptionalMetadata<T>(
  userEmail: string,
  read: (client: SpotifyApiClient) => Promise<SpotifyResult<T>>,
): Promise<T | null> {
  const spotify = await sessionFor(userEmail);
  if (!spotify) return null;
  try {
    const result = await read(spotify);
    return result.ok ? result.data : null;
  } catch (error) {
    if (isFetchTimeoutError(error)) return null;
    throw error;
  }
}

/** Fetch canonical metadata for a known Spotify track ID. */
export async function getSpotifyTrack(
  userEmail: string,
  trackId: string,
): Promise<SpotifyTrackMetadata | null> {
  if (!/^[A-Za-z0-9]+$/.test(trackId)) return null;
  const track = await readOptionalMetadata(userEmail, (spotify) => spotify.fetchTrack(trackId));
  return normalizeSpotifyTrack(track);
}

/** Search Spotify for the canonical track metadata used for stable matching and deduplication. */
export async function searchSpotifyTrack(
  userEmail: string,
  title: string,
  artist: string,
): Promise<SpotifyTrackMetadata | null> {
  const query = artist.trim()
    ? `track:${title.trim()} artist:${artist.trim()}`
    : title.trim();
  const track = await readOptionalMetadata(userEmail, (spotify) => spotify.searchTracks(query));
  return normalizeSpotifyTrack(track);
}

/** Search Spotify for a track and return the largest album cover URL */
export async function searchSpotifyCover(userEmail: string, title: string, artist: string): Promise<string | null> {
  return (await searchSpotifyTrack(userEmail, title, artist))?.coverUrl || null;
}
