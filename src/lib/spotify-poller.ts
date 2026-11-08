import { getSpotifyTokenForUser } from './spotify';
import { createSpotifyClient } from './spotify-api';
import {
  createSpotifyPoller,
  type DiffMessage,
  type NowPlayingData,
  type SyncState,
} from './spotify-poller-core';

export type { DiffMessage, NowPlayingData, SyncState };

/**
 * One observation of the user's current playback.
 *
 * Both upstream calls are bounded: the token refresh (`getSpotifyTokenForUser`)
 * and the playback read (`SpotifyApiClient.readNowPlaying`, which owns the #370
 * deadline). A bare
 * `fetch` here used to leave this promise pending forever on a stalled upstream,
 * and because the next tick was only scheduled after it settled, that user's
 * poller stopped permanently while SSE kept sending heartbeats.
 */
async function fetchNowPlaying(userEmail: string, onFetchStart: (at: number) => void): Promise<NowPlayingData> {
  const accessToken = await getSpotifyTokenForUser(userEmail);
  if (!accessToken) return { connected: false, is_playing: false, progress_ms: 0, duration_ms: 0, track: null };

  onFetchStart(Date.now()); // token refresh may take time; timestamp the actual Spotify GET
  const playback = await createSpotifyClient({ accessToken }).readNowPlaying();

  if (playback.kind === 'idle') {
    return { connected: true, is_playing: false, progress_ms: 0, duration_ms: 0, track: null };
  }
  if (playback.kind === 'failed') {
    // An unreadable 2xx body is an upstream fault, so report it as one (502) and
    // let the poller's transient branch back off instead of freezing.
    const status = playback.failure.unparsable ? 502 : playback.failure.status;
    return { connected: true, is_playing: false, progress_ms: 0, duration_ms: 0, track: null, error: status };
  }

  const track = playback.track;
  return {
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
  };
}

/**
 * In-process poller shared by every SSE subscriber of one user.
 *
 * The state machine lives in `spotify-poller-core` so "a hung upstream still
 * reschedules the next tick" is covered by a test with an injected fetch.
 */
const poller = createSpotifyPoller({ fetchNowPlaying });

export const subscribe = poller.subscribe;
export const resumePolling = poller.resumePolling;
export const getPollerStats = poller.getStats;
