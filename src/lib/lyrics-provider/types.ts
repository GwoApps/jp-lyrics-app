/**
 * Transport-agnostic lyrics provider contract (ISSUE #148).
 *
 * Built-in sources (LRCLIB / PetitLyrics / Uta-Net / ytmusic) and runtime
 * hot-plugged HTTP providers share one unified interface: a `search` that
 * returns structured candidates + a status, leaving confidence scoring, LRC
 * parsing, size limits, low-confidence review and security policy to jplrc.
 */

/** Metadata describing one song a provider is asked to look up. */
export interface LyricsProviderQuery {
  title: string;
  artists: string[];
  album?: string;
  durationMs?: number;
  isrc?: string;
  spotifyTrackId?: string;
  locale?: string;
}

/** A single candidate lyric hit returned by a provider. */
export interface ProviderCandidate {
  /** Opaque provider-side identifier (echoed back in diagnostics / source links). */
  candidateId?: string;
  title: string;
  artists: string[];
  album?: string;
  durationMs?: number;
  /** Plain text lyrics (may be empty when only `syncedLyrics` is present). */
  plainLyrics?: string;
  /** LRC-format synced lyrics (may be empty when only `plainLyrics` is present). */
  syncedLyrics?: string;
  /** Optional human-verifiable link (must be a safe https: URL; rendered with noopener noreferrer). */
  sourceUrl?: string;
  /**
   * Pre-scored confidence (0–100) supplied by a provider that already ran its
   * own scoring (the builtin chain). When absent, the orchestrator applies the
   * shared `scoreCandidate` evidence pipeline instead.
   */
  confidence?: number;
  /** Pre-scored match metadata for the review UI (builtin sources). */
  match?: { title: string; artist: string; link: string; ambiguous?: boolean };
  /** True when the provider was rate-limited even though it produced no hit. */
  rateLimited?: boolean;
  /** True when the candidate's duration conflicts with the requested one. */
  durationMismatch?: boolean;
}

/** Language-neutral outcome status for a single provider query. */
export type ProviderStatus =
  | 'hit'                       // returned at least one candidate
  | 'empty'                     // HTTP 200 + [] (normal no-match)
  | 'invalid_request'           // 400 / 422
  | 'auth_failed'               // 401 / 403 (never leaks token)
  | 'timeout'                   // 408 / client timeout
  | 'rate_limited'              // 429 (with optional retry-after)
  | 'temporary_unavailable'     // 5xx
  | 'invalid_response'          // non-JSON / protocol mismatch / size overrun
  | 'error';                    // network / unexpected

/** Result of invoking one provider. */
export interface ProviderOutcome {
  status: ProviderStatus;
  candidates: ProviderCandidate[];
  /** Present only when the provider answered 429; seconds, capped by caller. */
  retryAfterMs?: number;
  /** True when the provider was rate-limited even though it produced no hit. */
  rateLimited?: boolean;
  /** Structured diagnostic detail (truncated, language-neutral). */
  diagnostic?: string;
}

/** Human-facing identifier for the dynamic SSE stage. */
export interface ProviderStage {
  id: string;
  displayName: string;
  kind: 'builtin' | 'http';
}

/** Per-request execution context handed to every provider. */
export interface ProviderContext {
  signal?: AbortSignal;
  /** Called right before the provider starts its network work (SSE progress). */
  onStage?: (stage: ProviderStage) => void;
}

/** The uniform provider interface shared by builtin adapters and HTTP plugins. */
export interface LyricsProvider {
  id: string;
  displayName: string;
  kind: 'builtin' | 'http';
  search(
    query: LyricsProviderQuery,
    context: ProviderContext,
  ): Promise<ProviderOutcome>;
}
