import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { getSpotifyTokenForUser } from '@/lib/spotify';

// PUT /api/spotify/seek — seek to position in current playback
export async function PUT(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const token = await getSpotifyTokenForUser(user.email);
  if (!token) {
    return NextResponse.json({ error: 'Spotify not connected' }, { status: 401 });
  }

  const { position_ms } = await request.json();
  if (typeof position_ms !== 'number' || position_ms < 0) {
    return NextResponse.json({ error: 'Invalid position_ms' }, { status: 400 });
  }

  const res = await fetch(
    `https://api.spotify.com/v1/me/player/seek?position_ms=${Math.round(position_ms)}`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  if (!res.ok && res.status !== 204) {
    return NextResponse.json({ error: 'Seek failed' }, { status: res.status });
  }

  return NextResponse.json({ ok: true });
}
