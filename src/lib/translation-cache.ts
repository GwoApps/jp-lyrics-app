/**
 * Compare-and-set (CAS) persistence for the translation cache.
 *
 * The translate endpoint writes the merged translation / reasoning /
 * glossary back to the `songs` row. Two consistency hazards are addressed
 * here (see the translate route for the full story):
 *
 * 1. **Persist-before-success** — every "done" a client sees is emitted
 *    ONLY after the corresponding write has been awaited and committed.
 *    There are no `void`-dropped promises left dangling past the response
 *    (Cloudflare Workers may abort untracked promises when the response
 *    finishes, and even on Node a client that refreshes right after `done`
 *    must see the persisted cache).
 *
 * 2. **Stale-source protection** — every write is guarded by
 *    `id AND lyrics_raw = <snapshot at request start>`. If the user edits
 *    the lyrics mid-flight (the edit API clears the translation cache), the
 *    write is rejected and the caller reports `stale_annotation_source`
 *    instead of resurrecting stale output generated from old lyrics.
 *
 * Concurrent slice merges (multi-tab resume / parallel partial requests)
 * use an **optimistic lock**: each attempt re-reads the LATEST stored
 * cache, merges this request's slice on top, and CASes back on the exact
 * `lyrics_translation` value it read. A lost race retries against the
 * winner's cache instead of blindly last-write-wins, so two overlapping
 * slices never drop each other's lines.
 *
 * Every mutation is a single conditional UPDATE (no open multi-statement
 * transaction), so it is deadlock-free on every backend (Cloudflare D1,
 * Turso, local SQLite — mirroring the ai-usage reservation guard).
 */

import { and, eq, sql } from 'drizzle-orm';
import * as schema from './schema.ts';
import { parseTranslationCache } from './translation/parse.ts';

/** Max retries for the optimistic-lock merge loop (each retry re-reads the cache). */
const MAX_MERGE_ATTEMPTS = 8;

export type CasWriteResult =
  | { ok: true }
  | { ok: false; reason: 'stale_source' };

export type MergeResult =
  | { ok: true; cache: string[] }
  | { ok: false; reason: 'stale_source' | 'not_found' | 'contention' };

/**
 * Parse a stored cache string into a string[] index-aligned to the source
 * lyric lines. Non-string entries are replaced with '' at their original
 * index (never filtered) so line numbers never shift; damaged/missing → [].
 */
function parseCache(raw: string | null | undefined, totalLines: number): string[] {
  return parseTranslationCache(raw, totalLines);
}

/**
 * Merge a request's slice into a cache array and return the merged array,
 * normalised to exactly `totalLines` entries (trimmed if longer, padded if
 * shorter) so the stored JSON stays line-aligned to the current lyrics.
 */
function mergeSlice(
  base: string[],
  resolved: (string | null)[],
  totalLines: number,
  start: number,
): string[] {
  const merged = base.slice(0, totalLines);
  while (merged.length < totalLines) merged.push('');
  resolved.forEach((tr, i) => { if (tr !== null) merged[start + i] = tr; });
  return merged;
}

/**
 * Persist a slice merge under the optimistic lock.
 *
 * Guarantees:
 *  - returns `{ ok: true }` ONLY after the merged cache is committed, so the
 *    caller can emit "done" right after `await`ing this;
 *  - refuses to write when `lyrics_raw` no longer equals `sourceLyrics`
 *    (user edited the lyrics mid-flight) — returns `stale_source` and leaves
 *    the row untouched;
 *  - under concurrent merges, each writer re-reads the latest cache and
 *    CASes on the exact value it read, retrying on conflict, so no slice is
 *    lost (no plain last-write-wins).
 */
export async function mergeSliceIntoCache(
  db: unknown,
  opts: {
    id: string;
    sourceLyrics: string;
    totalLines: number;
    start: number;
    resolved: (string | null)[];
  },
): Promise<MergeResult> {
  const d = db as {
    select: (cols: unknown) => {
      from: (t: unknown) => {
        where: (w: unknown) => { get: () => Promise<{ lyricsRaw: string; lyricsTranslation: string } | undefined> };
      };
    };
    update: (t: unknown) => {
      set: (v: Record<string, unknown>) => {
        where: (w: unknown) => {
          returning: (cols: unknown) => { get: () => Promise<{ id: string } | undefined> };
        };
      };
    };
  };

  for (let attempt = 0; attempt < MAX_MERGE_ATTEMPTS; attempt++) {
    const latest = await d.select({
      lyricsRaw: schema.songs.lyricsRaw,
      lyricsTranslation: schema.songs.lyricsTranslation,
    }).from(schema.songs).where(eq(schema.songs.id, opts.id)).get();
    if (!latest) return { ok: false, reason: 'not_found' };
    // The song's source lyrics moved on — this request's output is stale.
    if (latest.lyricsRaw !== opts.sourceLyrics) return { ok: false, reason: 'stale_source' };

    const merged = mergeSlice(parseCache(latest.lyricsTranslation, opts.totalLines), opts.resolved, opts.totalLines, opts.start);
    // CAS on the exact cache value we read: if a concurrent writer committed
    // in between, this UPDATE matches no row and we retry against its cache.
    const applied = await d.update(schema.songs)
      .set({
        lyricsTranslation: JSON.stringify(merged),
        updatedAt: sql`(datetime('now', 'localtime'))`,
      })
      .where(and(
        eq(schema.songs.id, opts.id),
        eq(schema.songs.lyricsRaw, opts.sourceLyrics),
        eq(schema.songs.lyricsTranslation, latest.lyricsTranslation ?? ''),
      ))
      .returning({ id: schema.songs.id })
      .get();
    if (applied) return { ok: true, cache: merged };
    // Lost the race — loop re-reads and merges on top of the winner's cache.
  }
  // Retries exhausted (pathological contention). Refuse rather than guess —
  // this is a transient lock contention, NOT a stale source, so the caller
  // can surface a retryable error instead of a misleading conflict.
  return { ok: false, reason: 'contention' };
}

/**
 * Write a single guarded column (reasoning / glossary / …) back to the song
 * row. Refuses the write when `lyrics_raw` no longer equals the request's
 * source snapshot, so a long AI run can never re-pin data derived from
 * lyrics that were edited meanwhile.
 */
export async function writeSongField(
  db: unknown,
  opts: {
    id: string;
    sourceLyrics: string;
    patch: Record<string, unknown>;
  },
): Promise<CasWriteResult> {
  const d = db as {
    update: (t: unknown) => {
      set: (v: Record<string, unknown>) => {
        where: (w: unknown) => {
          returning: (cols: unknown) => { get: () => Promise<{ id: string } | undefined> };
        };
      };
    };
  };
  const applied = await d.update(schema.songs)
    .set({ ...opts.patch, updatedAt: sql`(datetime('now', 'localtime'))` })
    .where(and(
      eq(schema.songs.id, opts.id),
      eq(schema.songs.lyricsRaw, opts.sourceLyrics),
    ))
    .returning({ id: schema.songs.id })
    .get();
  return applied ? { ok: true } : { ok: false, reason: 'stale_source' };
}
