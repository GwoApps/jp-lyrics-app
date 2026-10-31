import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { getSpotifyTokenForUser } from '@/lib/spotify';
import { parseJsonBody } from '@/lib/admin';
import { seekReceiptTrackId } from '@/lib/spotify-seek-receipt';

// PUT /api/spotify/seek — seek to position in current playback
async function currentTrackId(token: string): Promise<{ id: string | null; available: boolean }> {
  const response = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
    headers: { Authorization: 'Bearer ' + token },
  });
  if (response.status === 204 || response.status === 202) return { id: null, available: true };
  if (!response.ok) return { id: null, available: false };
  const playback = await response.json();
  return { id: typeof playback?.item?.id === 'string' ? playback.item.id : null, available: true };
}

export async function PUT(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const token = await getSpotifyTokenForUser(user.email);
  if (!token) {
    return NextResponse.json({ error: 'Spotify not connected' }, { status: 401 });
  }

  const parsed = await parseJsonBody(request);
  if ('error' in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { position_ms, expected_track_id } = parsed as { position_ms?: unknown; expected_track_id?: unknown };
  if (typeof position_ms !== 'number' || !Number.isFinite(position_ms) || position_ms < 0) {
    return NextResponse.json({ error: 'invalid_position_ms' }, { status: 400 });
  }
  if (expected_track_id !== undefined
    && (typeof expected_track_id !== 'string' || !/^[A-Za-z0-9]+$/.test(expected_track_id))) {
    return NextResponse.json({ error: 'invalid_track_id' }, { status: 400 });
  }

  if (expected_track_id !== undefined) {
    let before: Awaited<ReturnType<typeof currentTrackId>>;
    try {
      before = await currentTrackId(token);
    } catch {
      return NextResponse.json({ error: 'playback_state_unavailable' }, { status: 503 });
    }
    if (!before.available) return NextResponse.json({ error: 'playback_state_unavailable' }, { status: 503 });
    if (before.id !== expected_track_id) return NextResponse.json({ error: 'track_changed' }, { status: 409 });
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
  const seekAppliedAt = Date.now(); // server clock; comparable to SSE poll start timestamps
  if (expected_track_id === undefined) return NextResponse.json({ ok: true });

  // Spotify's seek response has no track identity. Prefer a post-seek read-back;
  // if it fails, use the successful pre-seek track check so the local clock
  // does not wait for a later poll after a successful Spotify seek.
  let postSeek: Awaited<ReturnType<typeof currentTrackId>> | null = null;
  try {
    postSeek = await currentTrackId(token);
  } catch { /* read-back unavailable; pre-seek track check still permits immediate local seek */ }

  return NextResponse.json({
    ok: true, track_id: seekReceiptTrackId(expected_track_id, postSeek), seek_applied_at: seekAppliedAt,
  });
}
