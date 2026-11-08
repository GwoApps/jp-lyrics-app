/**
 * Spotify HTTP client — the only place that talks to Spotify over HTTP.
 *
 * Callers never build a Spotify request themselves. They create a client that
 * already knows the endpoint base, the client credentials and — for a user's
 * session — the access token, then call one method with just their own
 * parameters (a seek position, an OAuth code). The bearer/basic header, the
 * request budget and the status/`Retry-After` handling therefore exist once,
 * and no call site can forget to pass the token or the deadline.
 *
 * Every call runs inside the shared #370 request budget, so an upstream that
 * accepts the connection and then stalls rejects with `FetchTimeoutError`
 * instead of leaving the promise pending forever.
 *
 * No DB imports here on purpose — this module stays loadable by tests and by
 * callers that only need the transport.
 */
import { SPOTIFY_REQUEST_TIMEOUT_MS, withFetchDeadline } from './fetch-timeout';

export const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || '';
export const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || '';
export const SPOTIFY_REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI || 'https://jplrc.kazusa.feng.moe/api/auth/callback';
export const SPOTIFY_SCOPES = 'user-read-currently-playing user-read-playback-state user-modify-playback-state';

const API_BASE = 'https://api.spotify.com/v1';
const PLAYER_BASE = `${API_BASE}/me/player`;
const TOKEN_URL = 'https://accounts.spotify.com/api/token';

/** Base64 encode — Node Buffer first, btoa fallback for Edge/CF Workers */
export function base64Encode(str: string): string {
  try {
    return Buffer.from(str).toString('base64');
  } catch {
    return btoa(str);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Everything a client holds on behalf of its callers. */
export interface SpotifyClientOptions {
  fetchImpl?: typeof fetch;
  /**
   * Per-request budget; defaults to {@link SPOTIFY_REQUEST_TIMEOUT_MS}. The
   * deadline is disabled by `withFetchDeadline` only when this is `Infinity`.
   */
  timeoutMs?: number;
  /**
   * Caller cancel signal (e.g. a route's `request.signal`). A cancel rejects
   * with the original `AbortError`, so it is never mistaken for the deadline.
   */
  signal?: AbortSignal;
  /** Bearer token for the user-scoped endpoints; token calls do not need one. */
  accessToken?: string;
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
}

/** Options with the module defaults filled in. */
type ResolvedSpotifyClientOptions = SpotifyClientOptions & Required<
  Pick<SpotifyClientOptions, 'clientId' | 'clientSecret' | 'redirectUri' | 'timeoutMs'>
>;

/** Everything a caller may need to translate a failed Spotify call. */
export interface SpotifyFailure {
  status: number;
  /** Parsed response body (null when the body was empty or not JSON). */
  body: unknown;
  /** `Retry-After` header, only when it is a plain number of seconds. */
  retryAfter: string | null;
  /** A 2xx body that did not match the expected JSON shape. */
  unparsable?: boolean;
}

export type SpotifyResult<T> = { ok: true; data: T } | { ok: false; failure: SpotifyFailure };

export interface SpotifyTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

export interface SpotifyProfile {
  id?: string;
  account_id?: string;
  email?: string;
  display_name?: string;
}

export interface SpotifyImage {
  width?: number;
  url: string;
}

export interface SpotifyTrackPayload {
  id?: string;
  uri?: string;
  name?: string;
  duration_ms?: number;
  artists?: { name?: string }[];
  album?: { name?: string; images?: SpotifyImage[] };
  images?: SpotifyImage[];
}

export interface SpotifyNowPlayingPayload {
  is_playing?: boolean;
  progress_ms?: number;
  item?: SpotifyTrackPayload | null;
}

export interface SpotifyTrackMetadata {
  id: string;
  uri: string;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  coverUrl: string | null;
}

export type SpotifyPlaybackAction = 'play' | 'pause';

/** Result of reading `/me/player/currently-playing`, already classified. */
export type SpotifyNowPlayingRead =
  | { kind: 'idle' }
  | { kind: 'failed'; failure: SpotifyFailure }
  | {
    kind: 'playing';
    trackId: string | null;
    isPlaying: boolean;
    progressMs: number;
    durationMs: number;
    track: SpotifyTrackMetadata | null;
  };

interface RawResponse {
  response: Response;
  body: unknown;
  parsed: boolean;
}

function failureFrom(response: Response, body: unknown): SpotifyFailure {
  const retryAfter = response.headers.get('Retry-After');
  return {
    status: response.status,
    body,
    retryAfter: retryAfter && /^\d+$/.test(retryAfter) ? retryAfter : null,
  };
}

function unparsable(status: number): SpotifyFailure {
  return { status, body: null, retryAfter: null, unparsable: true };
}

function finiteMs(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : fallback;
}

/** Pick the largest image URL from a Spotify image array */
export function pickLargestImage(images: { width?: number; url: string }[]): string | null {
  if (!images || images.length === 0) return null;
  return images.reduce((big, img) => (img.width || 0) > (big.width || 0) ? img : big, images[0]).url || null;
}

export function normalizeSpotifyTrack(track: SpotifyTrackPayload | null | undefined): SpotifyTrackMetadata | null {
  if (!track?.id || !track.name) return null;
  return {
    id: track.id,
    uri: track.uri || `spotify:track:${track.id}`,
    title: track.name,
    artist: track.artists?.map((artist) => artist.name || '').filter(Boolean).join(', ') || '',
    album: track.album?.name || '',
    durationMs: finiteMs(track.duration_ms, 0),
    coverUrl: pickLargestImage(track.album?.images || []) || pickLargestImage(track.images || []) || null,
  };
}

/**
 * A Spotify API client.
 *
 * ```ts
 * const client = new SpotifyApiClient({ accessToken });
 * const playback = await client.readNowPlaying();
 * ```
 *
 * Instances are cheap and immutable — {@link SpotifyApiClient.withAccessToken}
 * returns a new client instead of mutating a shared one, so a token exchange
 * can reuse the transport without a second construction site.
 */
export class SpotifyApiClient {
  private readonly options: ResolvedSpotifyClientOptions;

  constructor(options: SpotifyClientOptions = {}) {
    this.options = {
      ...options,
      clientId: options.clientId ?? SPOTIFY_CLIENT_ID,
      clientSecret: options.clientSecret ?? SPOTIFY_CLIENT_SECRET,
      redirectUri: options.redirectUri ?? SPOTIFY_REDIRECT_URI,
      timeoutMs: options.timeoutMs ?? SPOTIFY_REQUEST_TIMEOUT_MS,
    };
  }

  /** The bearer token this client authenticates with, if any. */
  get accessToken(): string | undefined {
    return this.options.accessToken;
  }

  /** Same transport, different session. */
  withAccessToken(accessToken: string | undefined): SpotifyApiClient {
    return new SpotifyApiClient({ ...this.options, accessToken });
  }

  /** One bounded request; the body read happens inside the same deadline. */
  private async send(url: string, init: RequestInit): Promise<RawResponse> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const { timeoutMs, signal } = this.options;
    return withFetchDeadline(fetchImpl, url, { ...init, signal }, timeoutMs, async (response): Promise<RawResponse> => {
      if (response.status === 204) return { response, body: null, parsed: true };
      try {
        return { response, body: await response.json(), parsed: true };
      } catch {
        return { response, body: null, parsed: false };
      }
    });
  }

  private bearer(): Record<string, string> {
    if (!this.options.accessToken) throw new Error('spotify_access_token_missing');
    return { Authorization: `Bearer ${this.options.accessToken}` };
  }

  private basic(): Record<string, string> {
    return { Authorization: `Basic ${base64Encode(`${this.options.clientId}:${this.options.clientSecret}`)}` };
  }

  /**
   * Authenticated request against the Web API; `path` is relative to
   * `https://api.spotify.com/v1`. Returns the parsed body, or the failure that
   * a caller can map to its own error code — nobody reads `res.ok` by hand.
   */
  async request<T>(path: string, init: RequestInit = {}): Promise<SpotifyResult<T>> {
    return this.requestUrl<T>(`${API_BASE}${path}`, init);
  }

  /**
   * Same as {@link SpotifyApiClient.request} but for an absolute URL — Spotify's
   * paging links (`next`) are full URLs, so paged reads cannot be expressed as a
   * path.
   */
  async requestUrl<T>(url: string, init: RequestInit = {}): Promise<SpotifyResult<T>> {
    const { response, body, parsed } = await this.send(url, {
      ...init,
      cache: 'no-store',
      headers: { ...this.bearer(), ...(init.headers as Record<string, string> | undefined) },
    });
    if (!response.ok) return { ok: false, failure: failureFrom(response, body) };
    if (!parsed || !isPlainObject(body)) return { ok: false, failure: unparsable(response.status) };
    return { ok: true, data: body as T };
  }

  private async postTokenRequest(params: Record<string, string>): Promise<SpotifyResult<SpotifyTokenResponse>> {
    const { response, body, parsed } = await this.send(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...this.basic() },
      body: new URLSearchParams(params),
    });
    if (!response.ok) return { ok: false, failure: failureFrom(response, body) };
    if (!parsed || !isPlainObject(body) || typeof body.access_token !== 'string' || !body.access_token) {
      return { ok: false, failure: unparsable(response.status) };
    }
    return {
      ok: true,
      data: {
        access_token: body.access_token,
        refresh_token: typeof body.refresh_token === 'string' ? body.refresh_token : undefined,
        expires_in: Number(body.expires_in) || 0,
      },
    };
  }

  /** Exchange an OAuth authorization code for tokens. */
  exchangeAuthorizationCode(code: string): Promise<SpotifyResult<SpotifyTokenResponse>> {
    return this.postTokenRequest({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.options.redirectUri,
    });
  }

  /** Refresh a stored refresh token. */
  refreshAccessToken(refreshToken: string): Promise<SpotifyResult<SpotifyTokenResponse>> {
    return this.postTokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken });
  }

  /** `/me` — carries the email (when the scope allows) and the account id. */
  async fetchProfile(): Promise<SpotifyProfile | null> {
    const result = await this.request<Record<string, unknown>>('/me');
    if (!result.ok) return null;
    const body = result.data;
    const str = (value: unknown) => (typeof value === 'string' && value ? value : undefined);
    return {
      id: str(body.id),
      account_id: str(body.account_id),
      email: str(body.email),
      display_name: str(body.display_name),
    };
  }

  /** Read the current playback state of the user's session. */
  async readNowPlaying(): Promise<SpotifyNowPlayingRead> {
    const { response, body, parsed } = await this.send(`${PLAYER_BASE}/currently-playing`, {
      headers: this.bearer(),
      cache: 'no-store',
    });

    // 202/204: no active device or nothing playing.
    if (response.status === 202 || response.status === 204) return { kind: 'idle' };
    if (!response.ok) return { kind: 'failed', failure: failureFrom(response, body) };
    if (!parsed || !isPlainObject(body)) return { kind: 'failed', failure: unparsable(response.status) };

    const payload = body as SpotifyNowPlayingPayload;
    if (!isPlainObject(payload.item)) return { kind: 'idle' };
    const item = payload.item as SpotifyTrackPayload;

    return {
      kind: 'playing',
      trackId: typeof item.id === 'string' && item.id ? item.id : null,
      isPlaying: payload.is_playing === true,
      progressMs: finiteMs(payload.progress_ms, 0),
      durationMs: finiteMs(item.duration_ms, 0),
      track: normalizeSpotifyTrack(item),
    };
  }

  /** Bodyless play/pause for the current session — never a URI, device or offset. */
  async sendPlaybackCommand(action: SpotifyPlaybackAction): Promise<SpotifyResult<null>> {
    const { response, body } = await this.send(`${PLAYER_BASE}/${action}`, {
      method: 'PUT',
      headers: this.bearer(),
      cache: 'no-store',
    });
    if (!response.ok) return { ok: false, failure: failureFrom(response, body) };
    return { ok: true, data: null };
  }

  /** Seek the current session to `positionMs`. */
  async seekPlaybackPosition(positionMs: number): Promise<SpotifyResult<null>> {
    const { response, body } = await this.send(
      `${PLAYER_BASE}/seek?position_ms=${Math.round(positionMs)}`,
      { method: 'PUT', headers: this.bearer(), cache: 'no-store' },
    );
    if (!response.ok) return { ok: false, failure: failureFrom(response, body) };
    return { ok: true, data: null };
  }

  /** Canonical metadata for a known track id. */
  async fetchTrack(trackId: string): Promise<SpotifyResult<SpotifyTrackPayload | null>> {
    return this.request<SpotifyTrackPayload>(`/tracks/${trackId}`);
  }

  /** Search for a single track (`query` is a Spotify search expression). */
  async searchTracks(query: string): Promise<SpotifyResult<SpotifyTrackPayload | null>> {
    const result = await this.request<{ tracks?: { items?: unknown } }>(
      `/search?q=${encodeURIComponent(query)}&type=track&limit=1`,
    );
    if (!result.ok) return result;
    const items = result.data.tracks?.items;
    const first = Array.isArray(items) && isPlainObject(items[0]) ? items[0] as SpotifyTrackPayload : null;
    return { ok: true, data: first };
  }
}

/** A client with no session — for OAuth code exchange and profile lookups. */
export function createSpotifyClient(options: SpotifyClientOptions = {}): SpotifyApiClient {
  return new SpotifyApiClient(options);
}
