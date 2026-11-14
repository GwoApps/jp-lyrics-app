/**
 * Self-healing sweep for legacy CRLF lyrics (issue #421).
 *
 * `normalizeLyricsEol()` folds `\r\n` / `\r` to `\n` at the lyrics write
 * boundary, but that fold only ever applied to NEW writes: rows stored before
 * it existed still carry a `\r` at the end of every line, and every reader
 * indexes lyrics by `lyrics_raw.split('\n')` — so those rows read back with a
 * trailing `\r`, their `lyrics_furigana` segments carry the same `\r`, and a
 * furigana save then fails `furigana_source_mismatch` (the stored payload no
 * longer reconstructs the source text).
 *
 * Rather than a one-shot migration script, the repair lives here and runs by
 * itself: on every startup for the Node / Turso / local-SQLite backends (right
 * after the schema migrator in `db.ts`), and once per isolate for Cloudflare
 * D1 — where the Node migrator never runs — via `ensureLyricsEolHealed()`,
 * which the song-detail read calls. It is a no-op on a clean database (a single
 * indexed-in-spirit `instr` scan that matches nothing), so it costs one query
 * per process and nothing else.
 *
 * Each row is rewritten with compare-and-set on the values it was derived
 * from, so a concurrent lyrics write is never clobbered: the UPDATE simply
 * matches no row and the sweep moves on (the row was rewritten by the app
 * anyway, which folds its own input). `updated_at` is deliberately NOT bumped —
 * this is a storage-format fix, not an edit, and it must not reorder the
 * library.
 */

import { and, eq, sql } from 'drizzle-orm';
import * as schema from './schema.ts';
import { normalizeLyricsEol } from './lyrics-content.ts';
import { refoldFuriganaForLyrics } from './lyrics-eol-heal.ts';

/* eslint-disable @typescript-eslint/no-explicit-any -- the Drizzle DB is typed
   `any` by design (see lib/db.ts). */

/** Columns the sweep needs; the furigana cache is re-shaped together with the text. */
interface CandidateRow {
  id: string;
  lyrics_raw: string;
  lyrics_synced: string;
  lyrics_furigana: string;
}

export interface LyricsEolRepairSummary {
  /** Rows that still carried CR when the sweep looked at them. */
  scanned: number;
  /** Rows actually rewritten (a lost CAS race is not counted). */
  repaired: number;
  /** Furigana caches re-folded along with their lyrics. */
  refolded: number;
  /** Furigana caches dropped because they no longer describe the lyrics. */
  cleared: number;
}

const EMPTY_SUMMARY: LyricsEolRepairSummary = { scanned: 0, repaired: 0, refolded: 0, cleared: 0 };

/**
 * A row is a candidate when any of the three columns still carries a CR.
 *
 * The furigana cache is included on its own: a row whose lyrics were already
 * rewritten through one of the folded write paths can still hold a cache
 * derived from the CRLF text, and that combination is exactly what makes a
 * furigana save fail for good.
 *
 * The two text columns are searched for the raw byte (`char(13)`); the JSON
 * cache is searched for the *escaped* form (`char(92) || 'r'`), because a CR
 * inside a JSON string is stored as the two characters `\r` — JSON.stringify
 * never emits a bare CR into a column.
 */
const HAS_CR = sql`instr(${schema.songs.lyricsRaw}, char(13)) > 0
  OR instr(${schema.songs.lyricsSynced}, char(13)) > 0
  OR instr(${schema.songs.lyricsFurigana}, char(92) || 'r') > 0`;

/**
 * Fold every legacy CRLF row's lyrics (and its furigana cache) onto LF.
 *
 * Idempotent and safe to run concurrently with request traffic; returns a
 * summary so a deployment can log what the first boot actually fixed.
 */
export async function healLegacyLyricsEol(db: any): Promise<LyricsEolRepairSummary> {
  const candidates = await db.select({
    id: schema.songs.id,
    lyrics_raw: schema.songs.lyricsRaw,
    lyrics_synced: schema.songs.lyricsSynced,
    lyrics_furigana: schema.songs.lyricsFurigana,
  }).from(schema.songs).where(HAS_CR).all() as CandidateRow[];

  if (candidates.length === 0) return EMPTY_SUMMARY;

  const summary: LyricsEolRepairSummary = { scanned: candidates.length, repaired: 0, refolded: 0, cleared: 0 };

  for (const row of candidates) {
    const raw = normalizeLyricsEol(row.lyrics_raw ?? '');
    const synced = normalizeLyricsEol(row.lyrics_synced ?? '');
    const furigana = refoldFuriganaForLyrics(row.lyrics_furigana, raw);

    const updated = await db.update(schema.songs).set({
      lyricsRaw: raw,
      lyricsSynced: synced,
      ...(furigana.action === 'unchanged' ? {} : { lyricsFurigana: furigana.value }),
    }).where(and(
      eq(schema.songs.id, row.id),
      eq(schema.songs.lyricsRaw, row.lyrics_raw),
      eq(schema.songs.lyricsSynced, row.lyrics_synced),
    )).returning({ id: schema.songs.id }).all() as { id: string }[];

    if (updated.length === 0) {
      // A concurrent write owns this row now; it went through the folding
      // write path, so there is nothing left for the sweep to do.
      continue;
    }
    summary.repaired += 1;
    if (furigana.action === 'folded') summary.refolded += 1;
    if (furigana.action === 'cleared') summary.cleared += 1;
  }

  return summary;
}

let healPromise: Promise<LyricsEolRepairSummary> | null = null;

/**
 * Run the sweep at most once per process (per isolate on Cloudflare Workers).
 *
 * Failures are swallowed on purpose: a broken repair must never take a request
 * down — the write paths fold their own input anyway, so the worst case is a
 * legacy row that stays CRLF until the next boot.
 */
export function ensureLyricsEolHealed(db: any): Promise<LyricsEolRepairSummary> {
  if (!healPromise) {
    healPromise = healLegacyLyricsEol(db)
      .then((summary) => {
        if (summary.repaired > 0) {
          console.log(`[db] CRLF lyrics sweep: folded ${summary.repaired} row(s) `
            + `(${summary.refolded} furigana cache(s) re-folded, ${summary.cleared} cleared) — ISSUE #421`);
        }
        return summary;
      })
      .catch((error: unknown) => {
        console.warn(`[db] CRLF lyrics sweep failed — ${error instanceof Error ? error.message : String(error)}`);
        return EMPTY_SUMMARY;
      });
  }
  return healPromise;
}
