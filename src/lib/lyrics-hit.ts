/**
 * Unified lyrics-hit decision logic.
 *
 * Every entry point that writes fetched lyrics (single-song sync, single-song
 * import, playlist import) must route its candidate through `classifyLyricsHit`
 * so the quality gate no longer depends on a hard-coded source string. A
 * candidate is:
 *
 *  - `accepted`     — high-confidence timed hit that may be persisted directly.
 *  - `needs_review` — plausible but risky (low confidence or plain text that
 *                     would wipe an existing timeline). Must not be written
 *                     silently; require explicit confirmation or a persistent
 *                     "pending review" flag.
 *  - `rejected`     — below the hard quality floor. Never persist the candidate.
 */

export type LyricsHitVerdict = 'accepted' | 'needs_review' | 'rejected';

/** Hard floor: anything below this is considered a wrong candidate. */
export const LYRICS_REJECT_THRESHOLD = 60;
/** Shared gate: below this the match may be the wrong song/artist. */
export const LYRICS_REVIEW_THRESHOLD = 80;

export interface LyricsHitInput {
  /** Lyrics source key returned by `fetchLyrics` (e.g. `lrclib-search`, `ytmusic`). */
  source: string;
  /** Heuristic 0–100 confidence from the source chain. */
  confidence: number;
  /** Whether the candidate carries an LRC timeline (`lyrics.synced` non-empty). */
  synced: boolean;
  /** True when the target song already has a timed timeline a plain candidate would erase. */
  hasExistingTimeline: boolean;
}

/**
 * Per-source threshold matrix — currently every source falls back to the
 * shared thresholds; future sources can tighten the gate here without touching
 * the call sites.
 */
export function classifyLyricsHit(input: LyricsHitInput): LyricsHitVerdict {
  const { confidence, synced, hasExistingTimeline } = input;

  // Below the hard floor → treat as a wrong candidate regardless of source.
  if (confidence < LYRICS_REJECT_THRESHOLD) return 'rejected';

  // Below the review threshold → the match may still be the wrong song.
  if (confidence < LYRICS_REVIEW_THRESHOLD) return 'needs_review';

  // A high-confidence but plain-text candidate would still silently destroy an
  // existing timeline — keep the user in the loop before overwriting.
  if (!synced && hasExistingTimeline) return 'needs_review';

  return 'accepted';
}
