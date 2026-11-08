import { parseJsonBody } from './admin';
import {
  createSpotifyClient,
  type SpotifyApiClient,
  type SpotifyFailure,
  type SpotifyPlaybackAction,
} from './spotify-api';

interface PlaybackDependencies<T extends Request> {
  getAuthUser: (request: T) => Promise<{ email: string } | null>;
  /** Token lookup — the route passes the DB-backed implementation. */
  getSpotifyTokenForUser: (email: string) => Promise<string | null>;
  /** Transport override for tests; production uses the global fetch. */
  fetch?: typeof fetch;
  /** Per-request budget; injected by the tests so they need no real waiting. */
  timeoutMs?: number;
}

function failure(error: string, status: number, headers?: HeadersInit): Response {
  return Response.json({ error }, { status, headers });
}

function upstreamMessage(body: unknown): { reason?: unknown; message: string } {
  const error = (body as { error?: { reason?: unknown; message?: unknown } } | null)?.error;
  return {
    reason: error?.reason,
    message: typeof error?.message === 'string' ? error.message : '',
  };
}

/** Translate Spotify failures to stable codes, never forwarding provider text. */
function spotifyFailure(body: SpotifyFailure): Response {
  switch (body.status) {
    case 401: return failure('spotify_unauthorized', 401);
    case 403: {
      const { reason, message } = upstreamMessage(body.body);
      if (reason === 'PREMIUM_REQUIRED' || /premium required/i.test(message)) {
        return failure('premium_required', 403);
      }
      if (reason === 'INSUFFICIENT_SCOPE' || /insufficient (?:client )?scope/i.test(message)) {
        return failure('insufficient_scope', 403);
      }
      return failure('playback_forbidden', 403);
    }
    case 404: return failure('no_active_device', 404);
    case 429: return failure('rate_limited', 429,
      body.retryAfter ? { 'Retry-After': body.retryAfter } : undefined);
    default:
      return body.status >= 500
        ? failure('spotify_unavailable', 503)
        : failure('playback_failed', 502);
  }
}

/** One client per request: token, endpoint base and the #370 budget live in it. */
function clientFor<T extends Request>(token: string, dependencies: PlaybackDependencies<T>): SpotifyApiClient {
  return createSpotifyClient({
    accessToken: token,
    fetchImpl: dependencies.fetch,
    timeoutMs: dependencies.timeoutMs,
  });
}

/**
 * Resume/pause the user's current Spotify session; never supply a URI, context,
 * offset or device override. An optional track guard is best-effort: Spotify
 * does not provide an atomic compare-and-set playback endpoint.
 * Dependencies are explicit so tests exercise the full authenticated handler.
 */
export async function handleSpotifyPlayback<T extends Request>(
  request: T,
  dependencies: PlaybackDependencies<T>,
): Promise<Response> {
  const tokenForUser = dependencies.getSpotifyTokenForUser;

  let user: { email: string } | null;
  try {
    user = await dependencies.getAuthUser(request);
  } catch {
    return failure('auth_unavailable', 503);
  }
  if (!user) return failure('unauthorized', 401);

  // Validate before token refresh (which can itself make a network request).
  const body = await parseJsonBody(request);
  if ('error' in body || Object.keys(body).some(key => key !== 'action' && key !== 'expected_track_id')) {
    return failure('invalid_body', 400);
  }
  const { action, expected_track_id: expectedTrackId } = body;
  if (action !== 'play' && action !== 'pause') return failure('invalid_action', 400);
  if (expectedTrackId !== undefined
    && (typeof expectedTrackId !== 'string' || !/^[A-Za-z0-9]{1,128}$/.test(expectedTrackId))) {
    return failure('invalid_track_id', 400);
  }

  let token: string | null;
  try {
    token = await tokenForUser(user.email);
  } catch {
    return failure('spotify_unavailable', 503);
  }
  if (!token) return failure('spotify_not_connected', 401);

  // One deadline for the whole command: an upstream that accepts the connection
  // and then stalls surfaces as a retryable failure, never an indefinitely
  // pending command (issue #370).
  const spotify = clientFor(token, dependencies);

  if (expectedTrackId !== undefined) {
    try {
      const current = await spotify.readNowPlaying();
      if (current.kind === 'failed') {
        // A 2xx body we cannot read is "state unavailable", not a command failure.
        if (current.failure.unparsable) return failure('playback_state_unavailable', 503);
        return spotifyFailure(current.failure);
      }
      if (current.kind === 'idle' || current.trackId !== expectedTrackId) return failure('track_changed', 409);
    } catch {
      return failure('playback_state_unavailable', 503);
    }
  }

  try {
    const result = await spotify.sendPlaybackCommand(action as SpotifyPlaybackAction);
    if (!result.ok) return spotifyFailure(result.failure);
    // Spotify returns 204; don't parse it or turn an optional readback failure
    // into a failed command. The client refreshes its authoritative now-playing.
    return Response.json({ ok: true });
  } catch {
    return failure('spotify_unavailable', 503);
  }
}
