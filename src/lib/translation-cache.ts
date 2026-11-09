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

import { and, eq } from 'drizzle-orm';
import * as schema from './schema.ts';
import { parseTranslationCache } from './translation/parse.ts';
import { nowUtcSql } from './db-time-sql.ts';
import { applyLineEdits, type LineEdit } from './translation-line-edits.ts';
import {
  decideTranslationLangStamp,
  editedLineIndices,
  type TranslationLangStampDecision,
} from './translation-cache-lang.ts';

/** Max retries for the optimistic-lock merge loop (each retry re-reads the cache). */
const MAX_MERGE_ATTEMPTS = 8;

export type CasWriteResult =
  | { ok: true }
  | { ok: false; reason: 'stale_source' };

export type MergeResult =
  | {
    ok: true;
    cache: string[];
    /**
     * Language stamp the merge committed. `undefined` = the stored stamp was
     * left untouched (the cache may still hold lines of an older language —
     * see `decideTranslationLangStamp`, issue #394). `null` = the cache is now
     * empty, so no language is recorded.
     */
    lang?: string | null;
  }
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
 * The optimistic-lock merge loop shared by every cache writer.
 *
 * Each attempt re-reads the LATEST cache, lets the caller apply its change-set
 * on top of it, and CASes back on the exact `lyrics_translation` value it read;
 * a lost race retries against the winner's cache instead of clobbering it.
 */
async function mergeUnderOptimisticLock(
  db: unknown,
  opts: {
    id: string;
    sourceLyrics: string;
    totalLines: number;
    /** Apply this writer's change-set to the cache read in this attempt. */
    apply: (latest: string[]) => string[];
    /** BCP-47 language to stamp, or undefined to keep the stored stamp. */
    lang?: string;
    /** Extra columns written together with the merged cache (e.g. reasoning). */
    patch?: Record<string, unknown>;
    /**
     * Decide the language stamp from the cache this attempt is about to write,
     * instead of stamping `lang` unconditionally (issue #394: a partial save
     * must not relabel lines it never touched). Runs INSIDE the optimistic-lock
     * attempt so the decision sees the same cache the CAS is based on.
     */
    resolveStamp?: (ctx: { merged: string[]; storedLang: string | null }) => TranslationLangStampDecision;
  },
): Promise<MergeResult> {
  const d = db as {
    select: (cols: unknown) => {
      from: (t: unknown) => {
        where: (w: unknown) => {
          get: () => Promise<{
            lyricsRaw: string;
            lyricsTranslation: string;
            lyricsTranslationLang?: string | null;
          } | undefined>;
        };
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
      lyricsTranslationLang: schema.songs.lyricsTranslationLang,
    }).from(schema.songs).where(eq(schema.songs.id, opts.id)).get();
    if (!latest) return { ok: false, reason: 'not_found' };
    // The song's source lyrics moved on — this request's output is stale.
    if (latest.lyricsRaw !== opts.sourceLyrics) return { ok: false, reason: 'stale_source' };

    const merged = opts.apply(parseCache(latest.lyricsTranslation, opts.totalLines));
    // Language stamp: either the caller's per-attempt decision (which sees the
    // cache actually being written, issue #394) or the previous unconditional
    // "stamp whenever a language is provided" (keeps an existing stamp when
    // none is — a resume into the same language).
    const decision = opts.resolveStamp
      ? opts.resolveStamp({ merged, storedLang: latest.lyricsTranslationLang ?? null })
      : null;
    // `stamp: false` keeps whatever the row already carries (a mixed cache).
    const stampedLang = decision ? (decision.stamp === false ? undefined : decision.stamp) : opts.lang;
    // CAS on the exact cache value we read: if a concurrent writer committed
    // in between, this UPDATE matches no row and we retry against its cache.
    const applied = await d.update(schema.songs)
      .set({
        ...(opts.patch ?? {}),
        lyricsTranslation: JSON.stringify(merged),
        ...(stampedLang !== undefined ? { lyricsTranslationLang: stampedLang } : {}),
        updatedAt: nowUtcSql(),
      })
      .where(and(
        eq(schema.songs.id, opts.id),
        eq(schema.songs.lyricsRaw, opts.sourceLyrics),
        eq(schema.songs.lyricsTranslation, latest.lyricsTranslation ?? ''),
      ))
      .returning({ id: schema.songs.id })
      .get();
    if (applied) {
      return { ok: true, cache: merged, ...(stampedLang !== undefined ? { lang: stampedLang } : {}) };
    }
    // Lost the race — loop re-reads and merges on top of the winner's cache.
  }
  // Retries exhausted (pathological contention). Refuse rather than guess —
  // this is a transient lock contention, NOT a stale source, so the caller
  // can surface a retryable error instead of a misleading conflict.
  return { ok: false, reason: 'contention' };
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
    /**
     * The BCP-47 target language the merged translations were generated in.
     * Recorded together with the cache so a later request can tell whether the
     * stored translations match the current target language. When omitted,
     * the existing stored language is preserved (e.g. a partial resume that
     * keeps translating into the same language).
     */
    lang?: string;
  },
): Promise<MergeResult> {
  return mergeUnderOptimisticLock(db, {
    id: opts.id,
    sourceLyrics: opts.sourceLyrics,
    totalLines: opts.totalLines,
    lang: opts.lang,
    apply: (latest) => mergeSlice(latest, opts.resolved, opts.totalLines, opts.start),
  });
}

/**
 * Persist **line-level** manual edits under the same optimistic lock
 * (issue #272).
 *
 * The proofreading page sends only the lines the user actually changed, so
 * this writer merges exactly those lines into the latest stored cache. A
 * concurrent AI slice (or another editor) keeps its lines instead of being
 * rolled back by a whole-snapshot write, and vice versa.
 *
 * The language stamp is decided from the cache the merge is about to write, not
 * from the target language alone (issue #394): a manual save refreshes the
 * stamp (issue #189) only when the resulting cache really is all in `lang`.
 * Old-language lines the user merely scrolled past must keep the old stamp
 * visible, otherwise the mismatch banner and the coverage counter start
 * vouching for translations nobody re-translated.
 *
 * Returns the merged cache so the client can adopt lines written elsewhere
 * while still showing its own saved edits.
 */
export async function mergeLineEditsIntoCache(
  db: unknown,
  opts: {
    id: string;
    sourceLyrics: string;
    totalLines: number;
    edits: LineEdit[];
    /** See `mergeSliceIntoCache` — omitted keeps the stored language stamp. */
    lang?: string;
    /** Extra columns written together with the merged cache (e.g. reasoning). */
    patch?: Record<string, unknown>;
  },
): Promise<MergeResult> {
  const edited = editedLineIndices(opts.edits);
  return mergeUnderOptimisticLock(db, {
    id: opts.id,
    sourceLyrics: opts.sourceLyrics,
    totalLines: opts.totalLines,
    patch: opts.patch,
    apply: (latest) => applyLineEdits(latest, opts.edits, opts.totalLines),
    // A user-driven save: the untouched lines are on screen and editable, so
    // the stored stamp speaks for them. An unrecorded stamp (legacy rows /
    // earlier manual corrections) is trusted as "the language shown is the
    // language the user just confirmed", or row #189's fix would never apply.
    resolveStamp: ({ merged, storedLang }) => decideTranslationLangStamp({
      merged,
      editedIndices: edited,
      targetLang: opts.lang,
      storedLang,
      assumeStoredLang: true,
    }),
  });
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
    .set({ ...opts.patch, updatedAt: nowUtcSql() })
    .where(and(
      eq(schema.songs.id, opts.id),
      eq(schema.songs.lyricsRaw, opts.sourceLyrics),
    ))
    .returning({ id: schema.songs.id })
    .get();
  return applied ? { ok: true } : { ok: false, reason: 'stale_source' };
}
