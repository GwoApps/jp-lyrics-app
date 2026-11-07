import { parseJsonBody } from './admin';

interface PlaybackDependencies<T extends Request> {
  getAuthUser: (request: T) => Promise<{ email: string } | null>;
  getSpotifyTokenForUser: (email: string) => Promise<string | null>;
  fetch: typeof fetch;
}

function failure(error: string, status: number, headers?: HeadersInit): Response {
  return Response.json({ error }, { status, headers });
}

/** Translate Spotify failures to stable codes, never forwarding provider text. */
async function spotifyFailure(response: Response): Promise<Response> {
  switch (response.status) {
    case 401: return failure('spotify_unauthorized', 401);
    case 403: {
      let error: { reason?: unknown; message?: unknown } | undefined;
      try {
        const body = await response.json();
        error = body?.error;
      } catch { /* Empty/non-JSON errors still have a safe fallback. */ }
      const message = typeof error?.message === 'string' ? error.message : '';
      if (error?.reason === 'PREMIUM_REQUIRED' || /premium required/i.test(message)) {
        return failure('premium_required', 403);
      }
      if (error?.reason === 'INSUFFICIENT_SCOPE' || /insufficient (?:client )?scope/i.test(message)) {
        return failure('insufficient_scope', 403);
      }
      return failure('playback_forbidden', 403);
    }
    case 404: return failure('no_active_device', 404);
    case 429: {
      const retryAfter = response.headers.get('Retry-After');
      return failure('rate_limited', 429,
        retryAfter && /^\d+$/.test(retryAfter) ? { 'Retry-After': retryAfter } : undefined);
    }
    default:
      return response.status >= 500
        ? failure('spotify_unavailable', 503)
        : failure('playback_failed', 502);
  }
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
    token = await dependencies.getSpotifyTokenForUser(user.email);
  } catch {
    return failure('spotify_unavailable', 503);
  }
  if (!token) return failure('spotify_not_connected', 401);

  const headers = { Authorization: 'Bearer ' + token };
  if (expectedTrackId !== undefined) {
    try {
      const response = await dependencies.fetch('https://api.spotify.com/v1/me/player/currently-playing', {
        headers, cache: 'no-store',
      });
      if (response.status === 204 || response.status === 202) return failure('track_changed', 409);
      if (!response.ok) return await spotifyFailure(response);
      const playback = await response.json();
      if (!playback || typeof playback !== 'object' || Array.isArray(playback)) {
        return failure('playback_state_unavailable', 503);
      }
      if (playback.item?.id !== expectedTrackId) return failure('track_changed', 409);
    } catch {
      return failure('playback_state_unavailable', 503);
    }
  }

  try {
    const response = await dependencies.fetch(`https://api.spotify.com/v1/me/player/${action}`, {
      method: 'PUT', headers, cache: 'no-store',
    });
    if (!response.ok) return await spotifyFailure(response);
    // Spotify returns 204; don't parse it or turn an optional readback failure
    // into a failed command. The client refreshes its authoritative now-playing.
    return Response.json({ ok: true });
  } catch {
    return failure('spotify_unavailable', 503);
  }
}
