import { parseJsonBody } from './admin';
import { isFetchTimeoutError } from './fetch-timeout';
import { createSpotifyClient, type SpotifyApiClient } from './spotify-api';
import { seekReceiptTrackId } from './spotify-seek-receipt';

interface SeekDependencies<T extends Request> {
  getAuthUser: (request: T) => Promise<{ email: string } | null>;
  /** Token lookup — the route passes the DB-backed implementation. */
  getSpotifyTokenForUser: (email: string) => Promise<string | null>;
  /** Transport override for tests; production uses the global fetch. */
  fetch?: typeof fetch;
  /** Per-request budget; injected by the tests so they need no real waiting. */
  timeoutMs?: number;
}

type TrackState = { id: string | null; available: boolean };

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

/** One client per request: token, endpoint base and the #370 budget live in it. */
function clientFor<T extends Request>(token: string, dependencies: SeekDependencies<T>): SpotifyApiClient {
  return createSpotifyClient({
    accessToken: token,
    fetchImpl: dependencies.fetch,
    timeoutMs: dependencies.timeoutMs,
  });
}

/** Current track id (null when nothing is playing); failures stay distinguishable. */
async function readTrack(spotify: SpotifyApiClient): Promise<TrackState> {
  const read = await spotify.readNowPlaying();
  if (read.kind === 'failed') return { id: null, available: false };
  return { id: read.kind === 'playing' ? read.trackId : null, available: true };
}

/** Auth + token resolution; the failure response is returned, not thrown. */
async function authenticate<T extends Request>(
  request: T,
  dependencies: SeekDependencies<T>,
): Promise<{ token: string } | { response: Response }> {
  const user = await dependencies.getAuthUser(request);
  if (!user) return { response: json({ error: 'Unauthorized' }, 401) };

  try {
    const token = await dependencies.getSpotifyTokenForUser(user.email);
    if (!token) return { response: json({ error: 'Spotify not connected' }, 401) };
    return { token };
  } catch (error) {
    // A stalled token refresh is an upstream fault, not a missing connection:
    // answer 503 so the client retries instead of asking the user to re-login.
    if (!isFetchTimeoutError(error)) throw error;
    return { response: json({ error: 'spotify_timeout' }, 503) };
  }
}

/** Validate `position_ms` / `expected_track_id`; returns the parsed pair. */
async function readSeekBody(
  request: Request,
): Promise<{ positionMs: number; expectedTrackId?: string } | { response: Response }> {
  const parsed = await parseJsonBody(request);
  if ('error' in parsed) return { response: json({ error: parsed.error }, 400) };

  const { position_ms: positionMs, expected_track_id: expectedTrackId } = parsed as {
    position_ms?: unknown; expected_track_id?: unknown;
  };
  if (typeof positionMs !== 'number' || !Number.isFinite(positionMs) || positionMs < 0) {
    return { response: json({ error: 'invalid_position_ms' }, 400) };
  }
  if (expectedTrackId !== undefined
    && (typeof expectedTrackId !== 'string' || !/^[A-Za-z0-9]+$/.test(expectedTrackId))) {
    return { response: json({ error: 'invalid_track_id' }, 400) };
  }
  return { positionMs, expectedTrackId };
}

/**
 * PUT /api/spotify/seek — seek the current playback position.
 *
 * Every Spotify leg goes through the transport service, so the inspect-before-
 * write guard, the seek itself and the read-back all share one deadline and one
 * failure vocabulary (issue #370). A successful seek has no track id in its
 * response, so the receipt falls back to the guard's observation (see
 * `seekReceiptTrackId`).
 */
export async function handleSpotifySeek<T extends Request>(
  request: T,
  dependencies: SeekDependencies<T>,
): Promise<Response> {
  const auth = await authenticate(request, dependencies);
  if ('response' in auth) return auth.response;

  const body = await readSeekBody(request);
  if ('response' in body) return body.response;
  const { positionMs, expectedTrackId } = body;
  const spotify = clientFor(auth.token, dependencies);

  if (expectedTrackId !== undefined) {
    let before: TrackState;
    try {
      before = await readTrack(spotify);
    } catch (error) {
      // Timeout → the client can retry; a provider error stays unavailable.
      const code = isFetchTimeoutError(error) ? 'spotify_timeout' : 'playback_state_unavailable';
      return json({ error: code }, 503);
    }
    if (!before.available) return json({ error: 'playback_state_unavailable' }, 503);
    if (before.id !== expectedTrackId) return json({ error: 'track_changed' }, 409);
  }

  try {
    const seek = await spotify.seekPlaybackPosition(positionMs);
    if (!seek.ok) return json({ error: 'Seek failed' }, seek.failure.status);
  } catch (error) {
    if (isFetchTimeoutError(error)) return json({ error: 'spotify_timeout' }, 503);
    console.error(`[spotify-seek] failed — ${error instanceof Error ? error.message : String(error)}`);
    return json({ error: 'spotify_unavailable' }, 503);
  }

  const seekAppliedAt = Date.now(); // server clock; comparable to SSE poll start timestamps
  if (expectedTrackId === undefined) return json({ ok: true });

  // Spotify's seek response has no track identity. Prefer a post-seek read-back;
  // if it fails, use the successful pre-seek track check so the local clock
  // does not wait for a later poll after a successful Spotify seek.
  let postSeek: TrackState | null = null;
  try {
    postSeek = await readTrack(spotify);
  } catch { /* read-back unavailable; pre-seek track check still permits immediate local seek */ }

  return json({
    ok: true, track_id: seekReceiptTrackId(expectedTrackId, postSeek), seek_applied_at: seekAppliedAt,
  });
}
