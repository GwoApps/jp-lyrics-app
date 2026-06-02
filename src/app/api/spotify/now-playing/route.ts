import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET } from '@/lib/spotify';

async function refreshAccessToken(refreshToken: string): Promise<{ access_token: string; expires_at: number } | null> {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const expiresAt = Math.floor(Date.now() / 1000) + data.expires_in;
  return { access_token: data.access_token, expires_at: expiresAt };
}

export async function GET() {
  const auth = db.prepare('SELECT * FROM spotify_auth WHERE id = 1').get();
  if (!auth || !auth.access_token) {
    return NextResponse.json({ connected: false });
  }

  let accessToken = auth.access_token;

  if (Math.floor(Date.now() / 1000) > auth.expires_at - 60) {
    const refreshed = await refreshAccessToken(auth.refresh_token);
    if (!refreshed) {
      return NextResponse.json({ connected: false, error: 'token_expired' });
    }
    accessToken = refreshed.access_token;
    db.prepare(
      `UPDATE spotify_auth SET access_token = ?, expires_at = ?, updated_at = datetime('now', 'localtime') WHERE id = 1`
    ).run(refreshed.access_token, refreshed.expires_at);
  }

  const res = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (res.status === 204 || res.status === 202) {
    return NextResponse.json({ connected: true, is_playing: false });
  }

  if (!res.ok) {
    return NextResponse.json({ connected: true, is_playing: false, error: res.status });
  }

  const data = await res.json();
  if (!data || !data.item) {
    return NextResponse.json({ connected: true, is_playing: false });
  }

  return NextResponse.json({
    connected: true,
    is_playing: data.is_playing,
    progress_ms: data.progress_ms,
    duration_ms: data.item.duration_ms,
    track: {
      name: data.item.name,
      artist: data.item.artists?.map((a: { name: string }) => a.name).join(', ') || '',
      album: data.item.album?.name || '',
    },
  });
}
