import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REDIRECT_URI } from '@/lib/spotify';
import { getAuthUser } from '@/lib/auth';

const APP_ORIGIN = new URL(SPOTIFY_REDIRECT_URI).origin;

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const error = request.nextUrl.searchParams.get('error');

  if (error || !code) {
    return NextResponse.redirect(`${APP_ORIGIN}/?spotify_error=denied`);
  }

  // Get authenticated user from kazusa-auth headers
  const user = getAuthUser(request);
  if (!user) {
    return NextResponse.redirect(`${APP_ORIGIN}/?spotify_error=no_auth`);
  }

  const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: SPOTIFY_REDIRECT_URI,
    }),
  });

  if (!tokenRes.ok) {
    return NextResponse.redirect(`${APP_ORIGIN}/?spotify_error=token_failed`);
  }

  const tokenData = await tokenRes.json();

  const profileRes = await fetch('https://api.spotify.com/v1/me', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const profile = profileRes.ok ? await profileRes.json() : { display_name: 'Spotify User' };

  const expiresAt = Math.floor(Date.now() / 1000) + tokenData.expires_in;

  // Upsert: insert or replace for this user
  await db.prepare(
    `INSERT INTO spotify_auth (user_email, access_token, refresh_token, expires_at, display_name, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))
     ON CONFLICT(user_email) DO UPDATE SET
       access_token = excluded.access_token,
       refresh_token = excluded.refresh_token,
       expires_at = excluded.expires_at,
       display_name = excluded.display_name,
       updated_at = excluded.updated_at`
  ).run(user.email, tokenData.access_token, tokenData.refresh_token, expiresAt, profile.display_name || '');

  return NextResponse.redirect(`${APP_ORIGIN}/?spotify=connected`);
}
