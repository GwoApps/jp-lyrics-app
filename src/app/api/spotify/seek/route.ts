import type { NextRequest } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { getSpotifyTokenForUser } from '@/lib/spotify';
import { handleSpotifySeek } from '@/lib/spotify-seek';

// PUT /api/spotify/seek — seek to position in current playback.
// Auth, validation and every Spotify call live in the service; the route only
// forwards the request (issue #370).
export async function PUT(request: NextRequest) {
  return handleSpotifySeek(request, { getAuthUser, getSpotifyTokenForUser });
}
