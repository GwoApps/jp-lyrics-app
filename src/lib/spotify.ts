import { getDB, schema, sql, eq } from './db';

export const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || '';
export const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || '';
export const SPOTIFY_REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI || 'https://jplrc.kazusa.feng.moe/api/auth/callback';
export const SPOTIFY_SCOPES = 'user-read-currently-playing user-read-playback-state user-modify-playback-state';

/** Base64 encode — Node Buffer first, btoa fallback for Edge/CF Workers */
export function base64Encode(str: string): string {
  try {
    return Buffer.from(str).toString('base64');
  } catch {
    return btoa(str);
  }
}

/** Get a valid Spotify access token for a specific user (refresh if needed) */
export async function getSpotifyTokenForUser(userEmail: string): Promise<string | null> {
  const db = getDB();
  const auth = await db.select({
    accessToken: schema.spotifyAuth.accessToken,
    refreshToken: schema.spotifyAuth.refreshToken,
    expiresAt: schema.spotifyAuth.expiresAt,
  }).from(schema.spotifyAuth).where(eq(schema.spotifyAuth.userEmail, userEmail)).get();

  if (!auth || !auth.accessToken) return null;

  if (Math.floor(Date.now() / 1000) > auth.expiresAt - 60) {
    const refreshRes = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${base64Encode(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`)}`,
      },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: auth.refreshToken }),
    });
    if (!refreshRes.ok) return null;
    const data = await refreshRes.json();
    const expiresAt = Math.floor(Date.now() / 1000) + data.expires_in;
    await db.update(schema.spotifyAuth).set({
      accessToken: data.access_token,
      expiresAt,
      updatedAt: sql`(datetime('now', 'localtime'))`,
    }).where(eq(schema.spotifyAuth.userEmail, userEmail));
    return data.access_token;
  }

  return auth.accessToken;
}

/** Pick the largest image URL from a Spotify image array */
export function pickLargestImage(images: { width?: number; url: string }[]): string | null {
  if (!images || images.length === 0) return null;
  return images.reduce((big, img) => (img.width || 0) > (big.width || 0) ? img : big, images[0]).url || null;
}

export interface SpotifyTrackMetadata {
  id: string;
  uri: string;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  coverUrl: string | null;
}

interface SpotifyTrackPayload {
  id?: string;
  uri?: string;
  name?: string;
  duration_ms?: number;
  artists?: { name?: string }[];
  album?: { name?: string; images?: { width?: number; url: string }[] };
  images?: { width?: number; url: string }[];
}

export function normalizeSpotifyTrack(track: SpotifyTrackPayload | null | undefined): SpotifyTrackMetadata | null {
  if (!track?.id || !track.name) return null;
  return {
    id: track.id,
    uri: track.uri || `spotify:track:${track.id}`,
    title: track.name,
    artist: track.artists?.map((artist) => artist.name || '').filter(Boolean).join(', ') || '',
    album: track.album?.name || '',
    durationMs: Number.isFinite(track.duration_ms) ? Math.max(0, Math.round(track.duration_ms!)) : 0,
    coverUrl: pickLargestImage(track.album?.images || []) || pickLargestImage(track.images || []) || null,
  };
}

/** Fetch canonical metadata for a known Spotify track ID. */
export async function getSpotifyTrack(
  userEmail: string,
  trackId: string,
): Promise<SpotifyTrackMetadata | null> {
  if (!/^[A-Za-z0-9]+$/.test(trackId)) return null;
  const accessToken = await getSpotifyTokenForUser(userEmail);
  if (!accessToken) return null;
  const res = await fetch(`https://api.spotify.com/v1/tracks/${trackId}`, {
    headers: { Authorization: 'Bearer ' + accessToken },
  });
  if (!res.ok) return null;
  return normalizeSpotifyTrack(await res.json());
}

/** Search Spotify for the canonical track metadata used for stable matching and deduplication. */
export async function searchSpotifyTrack(
  userEmail: string,
  title: string,
  artist: string,
): Promise<SpotifyTrackMetadata | null> {
  const accessToken = await getSpotifyTokenForUser(userEmail);
  if (!accessToken) return null;

  const q = artist.trim()
    ? `track:${title.trim()} artist:${artist.trim()}`
    : title.trim();
  const res = await fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=track&limit=1`, {
    headers: { Authorization: 'Bearer ' + accessToken },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return normalizeSpotifyTrack(data?.tracks?.items?.[0]);
}

/** Search Spotify for a track and return the largest album cover URL */
export async function searchSpotifyCover(userEmail: string, title: string, artist: string): Promise<string | null> {
  return (await searchSpotifyTrack(userEmail, title, artist))?.coverUrl || null;
}
