import db from './db';

export const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || '';
export const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || '';
export const SPOTIFY_REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI || 'https://jplrc.kazusa.feng.moe/api/auth/callback';
export const SPOTIFY_SCOPES = 'user-read-currently-playing user-read-playback-state';

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
  const auth = await db.prepare(
    'SELECT access_token, refresh_token, expires_at FROM spotify_auth WHERE user_email = ?'
  ).get(userEmail) as { access_token: string; refresh_token: string; expires_at: number } | undefined;

  if (!auth || !auth.access_token) return null;

  if (Math.floor(Date.now() / 1000) > auth.expires_at - 60) {
    const refreshRes = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${base64Encode(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`)}`,
      },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: auth.refresh_token }),
    });
    if (!refreshRes.ok) return null;
    const data = await refreshRes.json();
    const expiresAt = Math.floor(Date.now() / 1000) + data.expires_in;
    await db.prepare(
      `UPDATE spotify_auth SET access_token = ?, expires_at = ?, updated_at = datetime('now','localtime') WHERE user_email = ?`
    ).run(data.access_token, expiresAt, userEmail);
    return data.access_token;
  }

  return auth.access_token;
}
