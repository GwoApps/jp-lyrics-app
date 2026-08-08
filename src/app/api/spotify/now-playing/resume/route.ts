import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const POLL_MODE = process.env.SPOTIFY_POLL_MODE || 'client';

// POST /api/spotify/now-playing/resume — manually resume a stopped poller (server mode).
// In client mode the browser handles resume locally, so this is a no-op.
export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (POLL_MODE === 'client') {
    return NextResponse.json({ ok: true, mode: 'client' });
  }

  const { resumePolling } = await import('@/lib/spotify-poller');
  resumePolling(user.email);
  return NextResponse.json({ ok: true, mode: 'server' });
}
