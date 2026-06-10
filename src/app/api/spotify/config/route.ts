import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const POLL_MODE = process.env.SPOTIFY_POLL_MODE || 'client';

// GET /api/spotify/config — expose Spotify polling mode to client
export async function GET() {
  return NextResponse.json({ pollMode: POLL_MODE });
}
