/**
 * Shared normalization & safety helpers used across builtin and HTTP providers.
 *
 * The main project owns all post-processing: HTML-entity decoding, LRC parsing,
 * plain/synced consistency, size limits and `needs_review` classification.
 * Providers only return candidates; everything below runs on the server before
 * anything is persisted or surfaced to the user.
 */
import * as heModule from 'he';

const decodeHtmlEntity = (heModule as unknown as { default?: typeof heModule }).default?.decode ?? heModule.decode;

/** Decode named + numeric HTML entities returned by third-party lyrics providers. */
export function unescapeLyrics(value: string): string {
  return decodeHtmlEntity(value);
}

/** Strip LRC timestamps + metadata tags from synced lyrics to derive plain text. */
export function stripTimestamps(lrc: string): string {
  return lrc
    // Drop standard metadata tags ([ar:], [ti:], [al:], [by:], [offset:], …)
    .replace(/^\[[a-z]+:[^\]]*\]\s*$/gim, '')
    // Drop every leading timestamp tag, keeping any lyric text after them.
    .replace(/^(?:\[(?:\d{1,2}:\d{2}(?:\.\d{1,3})?)\]\s*)+/gm, '')
    .trim();
}

/**
 * Ensure a candidate always carries both plain + synced text. When only one
 * side is present we derive the other (strip timestamps from synced, or wrap
 * plain into no timeline), and HTML-decode both sides.
 */
export function normalizeCandidateLyrics(input: {
  plainLyrics?: string;
  syncedLyrics?: string;
}): { plain: string; synced: string } {
  const synced = input.syncedLyrics ? unescapeLyrics(input.syncedLyrics) : '';
  const plainFromSynced = synced ? stripTimestamps(synced) : '';
  const plain = input.plainLyrics
    ? unescapeLyrics(input.plainLyrics)
    : plainFromSynced;
  return { plain, synced };
}

/** Hard limits enforced by jplrc, not the provider. */
export const MAX_CANDIDATES_PER_PROVIDER = 20;
export const MAX_RESPONSE_BYTES = 1_048_576; // 1 MiB
export const MAX_LYRICS_CHARS = 200_000;
