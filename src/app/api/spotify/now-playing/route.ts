import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { getSpotifyTokenForUser } from '@/lib/spotify';
import { createSpotifyClient, type SpotifyNowPlayingRead } from '@/lib/spotify-api';
import { isFetchTimeoutError } from '@/lib/fetch-timeout';
import { SPOTIFY_TIMEOUT_STATUS } from '@/lib/spotify-error';

/** The deadline answer: in-band error code + a status the client can't mistake for data. */
function timeoutResponse(headers: Record<string, string>) {
  return NextResponse.json(
    { connected: true, is_playing: false, error: SPOTIFY_TIMEOUT_STATUS },
    { status: SPOTIFY_TIMEOUT_STATUS, headers },
  );
}

/**
 * Client-mode playback read.
 *
 * Both upstream legs are bounded: the token refresh (`getSpotifyTokenForUser`)
 * and the playback read (`SpotifyApiClient.readNowPlaying`), which owns its own
 * deadline. The client is created once per request with the session token, so
 * the bearer header and the budget are not this route's business. Without
 * that, an upstream that accepted the connection and then stalled left `fetch`
 * pending — the browser's poll neither succeeded nor failed, so it never
 * rescheduled and sync froze with no visible state change (issue #370).
 *
 * A deadline answers 504 + `error: 504`, which the client classifies as
 * transient: it backs off, shows "retrying", and keeps the last confirmed
 * playback on screen. That visible degradation is exactly what a silent hang
 * could never produce.
 */
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ connected: false });
  }

  let accessToken: string | null;
  try {
    accessToken = await getSpotifyTokenForUser(user.email);
  } catch (error) {
    // A stalled token refresh is transient — never "not connected".
    if (!isFetchTimeoutError(error)) throw error;
    return timeoutResponse({});
  }
  if (!accessToken) {
    return NextResponse.json({ connected: false });
  }

  const observedAt = Date.now(); // immediately before the Spotify GET, after token refresh
  const headers = { 'X-Spotify-Observed-At': String(observedAt) };

  let playback: SpotifyNowPlayingRead;
  try {
    playback = await createSpotifyClient({ accessToken }).readNowPlaying();
  } catch (error) {
    if (!isFetchTimeoutError(error)) throw error;
    return timeoutResponse(headers);
  }

  if (playback.kind === 'idle') {
    return NextResponse.json({ connected: true, is_playing: false }, { headers });
  }

  if (playback.kind === 'failed') {
    // Upstream fault: keep the previous contract (200 + in-band `error`) so the
    // poller's transient classifier (429/5xx) still auto-retries. An unreadable
    // 2xx body is an upstream fault too, so it reports 502.
    const status = playback.failure.unparsable ? 502 : playback.failure.status;
    return NextResponse.json({ connected: true, is_playing: false, error: status }, { headers });
  }

  const track = playback.track;
  return NextResponse.json({
    connected: true,
    is_playing: playback.isPlaying,
    progress_ms: playback.progressMs,
    duration_ms: playback.durationMs,
    track: track ? {
      id: track.id,
      uri: track.uri,
      name: track.title,
      artist: track.artist,
      album: track.album,
      cover_url: track.coverUrl,
    } : null,
  }, { headers });
}
