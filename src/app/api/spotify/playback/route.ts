import type { NextRequest } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { getSpotifyTokenForUser } from '@/lib/spotify';
import { handleSpotifyPlayback } from '@/lib/spotify-playback';

// PUT /api/spotify/playback — control the current session, not an arbitrary song.
// The handler owns every Spotify call; this file stays a pure adapter (issue #370).
export async function PUT(request: NextRequest) {
  return handleSpotifyPlayback(request, { getAuthUser, getSpotifyTokenForUser });
}
