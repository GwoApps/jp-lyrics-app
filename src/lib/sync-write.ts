/**
 * Compare-and-set (CAS) persistence for the lyrics-sync route.
 *
 * The sync endpoint fetches lyrics from online sources and overwrites the
 * song's `lyrics_raw` / `lyrics_synced` — and, when the lyric text changed,
 * clears the derived caches (furigana / translation / glossary). Unlike the
 * translation cache, furigana PUT and timeline save, the sync write was NOT
 * guarded: a request started in tab B while tab A edited the lyrics would
 * unconditionally write back the fetched result, silently clobbering the
 * newer lyrics AND wiping the user's confirmed furigana corrections and
 * consumed-AI-quota translations (issue #120).
 *
 * The client therefore submits the `lyrics_raw` snapshot its request was
 * based on (`sourceLyrics`):
 *
 *  - `resolveSyncBaseline` fast-fails the request BEFORE the expensive fetch
 *    when the snapshot already no longer matches the stored lyrics;
 *  - `applySyncWrite` persists the result with `id AND lyrics_raw = <snapshot>`
 *    as the WHERE clause, so a lyrics edit landing between the baseline check
 *    and the write makes the UPDATE match no row — the write is refused with
 *    `stale_source` and NOTHING is persisted (mirrors `writeSongField`).
 *
 * Every mutation is a single conditional UPDATE (no open multi-statement
 * transaction), so it is deadlock-free on every backend (Cloudflare D1,
 * Turso, local SQLite).
 */
import { and, eq, sql } from 'drizzle-orm';
import * as schema from './schema.ts';

/** Result of checking a sync submission against the stored lyrics baseline. */
export type SyncBaseline =
  | { ok: true; sourceLyrics: string }
  | { ok: false; error: 'missing_source_lyrics' | 'stale_source' };

/**
 * Guard a sync submission against a stale lyrics baseline.
 *
 * The client sends the `lyrics_raw` snapshot it displayed when the user hit
 * "sync". When that snapshot is absent the request is malformed; when it no
 * longer equals the stored lyrics, another tab/session already rewrote the
 * song and a sync based on the old baseline must not proceed (a fast-fail
 * before any fetch / AI / network cost is spent).
 */
export function resolveSyncBaseline(
  sourceLyrics: unknown,
  existingRaw: string,
): SyncBaseline {
  if (typeof sourceLyrics !== 'string') {
    return { ok: false, error: 'missing_source_lyrics' };
  }
  if (sourceLyrics !== existingRaw) {
    return { ok: false, error: 'stale_source' };
  }
  return { ok: true, sourceLyrics };
}

/** Result of persisting a sync result under the lyrics CAS. */
export type SyncWriteResult =
  | { ok: true }
  | { ok: false; reason: 'stale_source' };

/**
 * Persist a sync result with compare-and-set on `lyrics_raw`.
 *
 * Returns `{ ok: true }` ONLY after the write committed. Refuses the write
 * when `lyrics_raw` no longer equals `sourceLyrics` (the user edited the
 * lyrics while the fetch was in flight, or a concurrent request won the
 * race) — returns `stale_source` and leaves the row untouched, so a sync can
 * never resurrect data derived from lyrics that were replaced meanwhile.
 */
export async function applySyncWrite(
  db: unknown,
  opts: {
    id: string;
    sourceLyrics: string;
    patch: Record<string, unknown>;
  },
): Promise<SyncWriteResult> {
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
