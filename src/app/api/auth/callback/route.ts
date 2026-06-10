import { NextRequest, NextResponse } from 'next/server';
import { getDB, schema, sql } from '@/lib/db';
import { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REDIRECT_URI, base64Encode } from '@/lib/spotify';
import { signSession } from '@/lib/auth';

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

  // Determine user identifier:
  //   1. From Spotify profile email (if user-read-email scope granted)
  //   2. From Spotify profile ID (always available, e.g. "spotify:abc123")
  const userId = profile.email || `spotify:${profile.id}`;
  if (!userId) {
    return NextResponse.redirect(`${APP_ORIGIN}/?spotify_error=no_identity`);
  }

  // Check if user is blocked
  try {
    const existingUser = await db.get(
      sql`SELECT is_blocked FROM users WHERE id = ${userId}`
    ) as { is_blocked: number } | undefined;
    if (existingUser?.is_blocked === 1) {
      return NextResponse.redirect(`${APP_ORIGIN}/?spotify_error=blocked`);
    }
  } catch { /* users table may not exist yet */ }

  const expiresAt = Math.floor(Date.now() / 1000) + tokenData.expires_in;

  // Upsert Spotify auth
  await db.run(sql`
    INSERT INTO spotify_auth (user_email, access_token, refresh_token, expires_at, display_name, updated_at)
    VALUES (${userId}, ${tokenData.access_token}, ${tokenData.refresh_token}, ${expiresAt}, ${profile.display_name || ''}, datetime('now', 'localtime'))
    ON CONFLICT(user_email) DO UPDATE SET
      access_token = excluded.access_token,
      refresh_token = excluded.refresh_token,
      expires_at = excluded.expires_at,
      display_name = excluded.display_name,
      updated_at = excluded.updated_at
  `);

  // Upsert user into users table
  try {
    await db.run(sql`
      INSERT OR IGNORE INTO users (id, display_name, created_at, updated_at)
      VALUES (${userId}, ${profile.display_name || ''}, datetime('now', 'localtime'), datetime('now', 'localtime'))
    `);
    await db.run(sql`
      UPDATE users SET display_name = ${profile.display_name || ''}, updated_at = datetime('now', 'localtime')
      WHERE id = ${userId}
    `);

    // First user becomes admin
    const adminCount = await db.get(
      sql`SELECT COUNT(*) as cnt FROM users WHERE is_admin = 1`
    ) as { cnt: number };
    if (adminCount.cnt === 0) {
      await db.run(sql`UPDATE users SET is_admin = 1 WHERE id = ${userId}`);
    }
  } catch { /* users table may not exist yet */ }

  // Set signed session cookie (used when no gateway auth headers)
  const token = await signSession(userId);
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
