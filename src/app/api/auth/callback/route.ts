import { NextRequest, NextResponse } from 'next/server';
import { getDB, sql } from '@/lib/db';
import { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REDIRECT_URI, base64Encode } from '@/lib/spotify';
import { signSession } from '@/lib/auth';
import {
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_PATH,
  safeStateEqual,
} from '@/lib/oauth-state';

const APP_ORIGIN = new URL(SPOTIFY_REDIRECT_URI).origin;
const COOKIE_NAME = 'jplrc_session';
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30 days

/** Clear the one-time OAuth state cookie on both success and failure paths. */
function clearOAuthStateCookie(response: NextResponse): NextResponse {
  response.cookies.set(OAUTH_STATE_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: OAUTH_STATE_PATH,
  });
  return response;
}

export async function GET(request: NextRequest) {
  const db = getDB();
  const code = request.nextUrl.searchParams.get('code');
  const error = request.nextUrl.searchParams.get('error');
  const queryState = request.nextUrl.searchParams.get('state');
  const cookieState = request.cookies.get(OAUTH_STATE_COOKIE)?.value;

  // CSRF guard: the state in the callback query must match the one stored in
  // the initiating browser's cookie, otherwise an attacker's callback URL
  // could log a victim into the wrong identity. Missing, mismatched, or
  // replayed state is rejected before any token exchange.
  if (!safeStateEqual(queryState, cookieState)) {
    return clearOAuthStateCookie(
      NextResponse.redirect(`${APP_ORIGIN}/?spotify_error=state_mismatch`),
    );
  }

  if (error || !code) {
    return clearOAuthStateCookie(
      NextResponse.redirect(`${APP_ORIGIN}/?spotify_error=denied`),
    );
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
    return clearOAuthStateCookie(
      NextResponse.redirect(`${APP_ORIGIN}/?spotify_error=token_failed`),
    );
  }

  const tokenData = await tokenRes.json();

  // Get user profile from Spotify (has email)
  const profileRes = await fetch('https://api.spotify.com/v1/me', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const profile = profileRes.ok ? await profileRes.json() : {};
  console.log('[spotify-auth] /me profile:', JSON.stringify(profile, null, 2));

  // Reject if we couldn't get a valid profile — token is likely scoped wrong
  if (!profile.account_id && !profile.id) {
    return clearOAuthStateCookie(
      NextResponse.redirect(`${APP_ORIGIN}/?spotify_error=invalid_profile`),
    );
  }

  // Determine user identifier:
  //   1. From Spotify profile email (if user-read-email scope granted)
  //   2. From Spotify account_id (always available, e.g. "spotify:abc123")
  const userId = profile.email || `spotify:${profile.account_id}`;
  if (!userId) {
    return clearOAuthStateCookie(
      NextResponse.redirect(`${APP_ORIGIN}/?spotify_error=no_identity`),
    );
  }

  // Migrate from deprecated profile.id to account_id
  // profile.id (Spotify deprecated) was used historically as fallback identity
  const oldId = profile.email ? null : `spotify:${profile.id}`;
  if (oldId && oldId !== userId) {
    try {
      const oldUser = await db.get(sql`SELECT 1 FROM users WHERE id = ${oldId}`) as any;
      if (oldUser) {
        // Migrate all user-associated data to new identity
        await db.run(sql`UPDATE users SET id = ${userId} WHERE id = ${oldId}`);
        await db.run(sql`UPDATE spotify_auth SET user_email = ${userId} WHERE user_email = ${oldId}`);
        await db.run(sql`UPDATE favorites SET user_email = ${userId} WHERE user_email = ${oldId}`);
        await db.run(sql`UPDATE collections SET user_email = ${userId} WHERE user_email = ${oldId}`);
        await db.run(sql`UPDATE songs SET created_by = ${userId} WHERE created_by = ${oldId}`);
      }
    } catch (error) {
      // Migration is best-effort — but a silent failure hides missing tables/columns.
      console.warn(`[auth/callback] user-id migration failed — ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Check if user is blocked
  try {
    const existingUser = await db.get(
      sql`SELECT is_blocked FROM users WHERE id = ${userId}`
    ) as { is_blocked: number } | undefined;
    if (existingUser?.is_blocked === 1) {
      return clearOAuthStateCookie(
        NextResponse.redirect(`${APP_ORIGIN}/?spotify_error=blocked`),
      );
    }
  } catch (error) {
    // users table may not exist yet — but on CF a missing table is a deploy problem worth logging.
    console.warn(`[auth/callback] users lookup failed — ${error instanceof Error ? error.message : String(error)}`);
  }

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
  } catch (error) {
    // users table may not exist yet — but on CF a missing table is a deploy problem worth logging.
    console.warn(`[auth/callback] users upsert failed — ${error instanceof Error ? error.message : String(error)}`);
  }

  // Set signed session cookie (used when no gateway auth headers)
  const token = await signSession(userId);
  const response = clearOAuthStateCookie(
    NextResponse.redirect(`${APP_ORIGIN}/?spotify=connected`),
  );
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  });

  return response;
}
