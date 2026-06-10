import { NextRequest, NextResponse } from 'next/server';
import { getDB, schema, sql } from '@/lib/db';
import { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REDIRECT_URI, base64Encode } from '@/lib/spotify';
import { getAuthUser, signSession } from '@/lib/auth';

const APP_ORIGIN = new URL(SPOTIFY_REDIRECT_URI).origin;
const COOKIE_NAME = 'jplrc_session';
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30 days

export async function GET(request: NextRequest) {
  const db = getDB();
  const code = request.nextUrl.searchParams.get('code');
  const error = request.nextUrl.searchParams.get('error');

  if (error || !code) {
    return NextResponse.redirect(`${APP_ORIGIN}/?spotify_error=denied`);
  }

  // Exchange code for tokens
  const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${base64Encode(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`)}`,
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

  // Get user profile from Spotify (has email)
  const profileRes = await fetch('https://api.spotify.com/v1/me', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const profile = profileRes.ok ? await profileRes.json() : {};

  // Determine user email:
  //   1. From gateway header (kazusa-home-portal)
  //   2. From Spotify profile (standalone / CF Workers)
  const authUser = await getAuthUser(request);
  const email = authUser?.email || profile.email;
  if (!email) {
    return NextResponse.redirect(`${APP_ORIGIN}/?spotify_error=no_email`);
  }

  const expiresAt = Math.floor(Date.now() / 1000) + tokenData.expires_in;

  // Upsert Spotify auth
  await db.run(sql`
    INSERT INTO spotify_auth (user_email, access_token, refresh_token, expires_at, display_name, updated_at)
    VALUES (${email}, ${tokenData.access_token}, ${tokenData.refresh_token}, ${expiresAt}, ${profile.display_name || ''}, datetime('now', 'localtime'))
    ON CONFLICT(user_email) DO UPDATE SET
      access_token = excluded.access_token,
      refresh_token = excluded.refresh_token,
      expires_at = excluded.expires_at,
      display_name = excluded.display_name,
      updated_at = excluded.updated_at
  `);

  // Set signed session cookie (used when no gateway auth headers)
  const token = await signSession(email);
  const response = NextResponse.redirect(`${APP_ORIGIN}/?spotify=connected`);
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  });

  return response;
}
