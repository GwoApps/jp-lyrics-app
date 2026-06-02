import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REDIRECT_URI } from '@/lib/spotify';

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const error = request.nextUrl.searchParams.get('error');

  if (error || !code) {
    return NextResponse.redirect(new URL('/?spotify_error=denied', request.url));
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
    return NextResponse.redirect(new URL('/?spotify_error=token_failed', request.url));
  }

  const tokenData = await tokenRes.json();

  const profileRes = await fetch('https://api.spotify.com/v1/me', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const profile = profileRes.ok ? await profileRes.json() : { display_name: 'Spotify User' };

  const expiresAt = Math.floor(Date.now() / 1000) + tokenData.expires_in;
  db.prepare(
    `UPDATE spotify_auth SET access_token = ?, refresh_token = ?, expires_at = ?, display_name = ?, updated_at = datetime('now', 'localtime') WHERE id = 1`
  ).run(tokenData.access_token, tokenData.refresh_token, expiresAt, profile.display_name || '');

  return NextResponse.redirect(new URL('/?spotify=connected', request.url));
}
