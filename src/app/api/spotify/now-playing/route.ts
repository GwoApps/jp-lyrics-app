import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { getSpotifyTokenForUser } from '@/lib/spotify';

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ connected: false });
  }

  const accessToken = await getSpotifyTokenForUser(user.email);
  if (!accessToken) {
    return NextResponse.json({ connected: false });
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

  const images = data.item.album?.images || [];
  const coverUrl = images.length > 0
    ? (images.reduce((big: { width: number; url: string }, img: { width: number; url: string }) => img.width > big.width ? img : big, images[0]).url as string)
    : null;

  return NextResponse.json({
    connected: true,
    is_playing: data.is_playing,
    progress_ms: data.progress_ms,
    duration_ms: data.item.duration_ms,
    track: {
      name: data.item.name,
      artist: data.item.artists?.map((a: { name: string }) => a.name).join(', ') || '',
      album: data.item.album?.name || '',
      cover_url: coverUrl,
    },
  });
}
