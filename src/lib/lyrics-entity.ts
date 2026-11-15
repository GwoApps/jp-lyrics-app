/**
 * HTML entities that leaked into stored lyrics (ISSUE #428).
 *
 * PetitLyrics answers with the song text *encoded* (`fallin&#039; down`,
 * `&quot;SNAP!&quot;`), and the app used to decode only at the orchestration
 * layer (`normalizeCandidateLyrics`). Rows written by any path that bypassed it
 * hold the entity verbatim: the detail page renders `&#039;`, the reading cache
 * was tokenized on the entity characters themselves
 * (`["痛く","て","fallin","&#","039",";"]`), and copy / export / share all
 * carry the garbage forward.
 *
 * This module is the pure half of the repair: detect, decode and re-shape the
 * reading cache. Nothing here touches the database — the repair route decides
 * when to write, and only after the song's owner asked for it. There is
 * deliberately no startup sweep: silently rewriting user-visible lyrics is a
 * different act from folding line endings (#421), so the app asks first.
 */
import * as heModule from 'he';
import type { FuriganaLine } from './types.ts';
import { validateFuriganaPayload } from './furigana-validation.ts';
import { normalizeLyricsEol } from './lyrics-content.ts';

const decodeHtmlEntity = (heModule as unknown as { default?: typeof heModule }).default?.decode ?? heModule.decode;

/**
 * The entities a lyrics provider can emit: named entities with a semicolon,
 * decimal and hex references. Deliberately narrow so a literal `&` in a line —
 * "R&B", "Tom & Jerry" — is never mistaken for a broken payload.
 */
const ENTITY_PATTERN = /&(?:amp|apos|gt|lt|nbsp|quot|#\d{1,7}|#[xX][0-9a-fA-F]{1,6});/;

/** The first encoded character found in `value`, or null when it is clean. */
export function findLyricsHtmlEntity(value: string | null | undefined): string | null {
  if (!value) return null;
  return ENTITY_PATTERN.exec(value)?.[0] ?? null;
}

/** True when any of the given lyric texts still carries an entity. */
export function hasLyricsHtmlEntity(...values: (string | null | undefined)[]): boolean {
  return values.some((value) => findLyricsHtmlEntity(value) !== null);
}

/**
 * Decode one line of lyric text.
 *
 * Repeated up to three times because a doubly-encoded payload (`&amp;#039;`)
 * decodes to another entity. A decoded line break becomes a space: the lyric
 * model is one row per `\n`, so letting `&#10;` through would shift every
 * translation / furigana / timeline index below it.
 */
export function decodeLyricsLine(value: string): string {
  let decoded = value;
  for (let pass = 0; pass < 3; pass += 1) {
    if (!ENTITY_PATTERN.test(decoded)) break;
    const next = decodeHtmlEntity(decoded);
    if (next === decoded) break;
    decoded = next;
  }
  return decoded.replace(/[\r\n]+/g, ' ');
}

/** Decode a whole lyric document line by line (the line count is preserved). */
export function decodeLyricsHtmlEntities(value: string): string {
  return normalizeLyricsEol(value).split('\n').map(decodeLyricsLine).join('\n');
}

/** Kinds of entity repair the UI may offer for one song (one today). */
export const LYRICS_ENTITY_NOTICE_KIND = 'html-entities';

/**
 * `localStorage` key remembering which repairs the owner declined for one set of
 * lyrics. The lyrics text is part of the key on purpose: "do not ask me again"
 * is about *this* text, so a genuinely new document (a re-sync that brought in
 * other markup) is a new question instead of being silenced forever.
 */
export function lyricsEntityNoticeKey(songId: string, lyricsRaw: string): string {
  return `jplrc:song:${songId}:declined-fix:${lyricsFingerprint(lyricsRaw)}`;
}

/**
 * Short, stable fingerprint of a lyrics document (djb2, hex). Not a security
 * hash — it only has to be stable across reloads and cheap to compute during a
 * render, because it names a `localStorage` key.
 */
export function lyricsFingerprint(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash * 33) ^ value.charCodeAt(index)) | 0;
  }
  return (hash >>> 0).toString(16);
}

/** Stored value → the kinds the owner declined (never throws on junk). */
export function parseDeclinedFixes(raw: string | null): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(',').map((kind) => kind.trim()).filter(Boolean))].sort();
}

/** The kinds the owner declined → stored value (stable order, no duplicates). */
export function serializeDeclinedFixes(kinds: string[]): string {
  return [...new Set(kinds.filter(Boolean))].sort().join(',');
}

export interface LyricsEntityRepairInput {
  raw: string;
  synced: string;
  /** Raw `lyrics_furigana` column (JSON text, '[]', '' or a damaged value). */
  furigana: string;
}

/**
 * - `unchanged` — the cache had no entity, or already describes the repaired text.
 * - `decoded`   — segment texts decoded and still reconstruct the repaired line,
 *   so the owner's annotation survives the repair.
 * - `cleared`   — the cache was tokenized on the entity characters and cannot
 *   describe the repaired text; it is dropped and re-derived on next open.
 */
export type FuriganaRepairAction = 'unchanged' | 'decoded' | 'cleared';

export interface LyricsEntityRepairResult {
  /** True when at least one column would actually change. */
  changed: boolean;
  raw: string;
  synced: string;
  furigana: string;
  furiganaAction: FuriganaRepairAction;
}

/** Decode one cache value against `repairedRaw`, keeping it only while it still matches. */
function repairFurigana(furiganaJson: string, repairedRaw: string): { value: string; action: FuriganaRepairAction } {
  const trimmed = furiganaJson.trim();
  if (trimmed === '' || trimmed === '[]') return { value: furiganaJson, action: 'unchanged' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(furiganaJson);
  } catch {
    // Damaged value: the annotation paths already re-derive a cache they cannot parse.
    return { value: furiganaJson, action: 'unchanged' };
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return { value: furiganaJson, action: 'unchanged' };
  // A cache that already reconstructs the repaired text never needs rewriting.
  if (validateFuriganaPayload(parsed, repairedRaw).ok) return { value: furiganaJson, action: 'unchanged' };

  const decodedLines = parsed.map((line) => {
    if (!line || typeof line !== 'object' || Array.isArray(line)) return line;
    const segments = (line as { segments?: unknown }).segments;
    if (!Array.isArray(segments)) return line;
    return {
      ...(line as Record<string, unknown>),
      segments: segments.map((segment) => {
        if (!segment || typeof segment !== 'object' || Array.isArray(segment)) return segment;
        const text = (segment as { text?: unknown }).text;
        if (typeof text !== 'string') return segment;
        return { ...(segment as Record<string, unknown>), text: decodeLyricsLine(text) };
      }),
    };
  });

  const validation = validateFuriganaPayload(decodedLines, repairedRaw);
  if (!validation.ok) return { value: '[]', action: 'cleared' };
  return { value: JSON.stringify(validation.lines satisfies FuriganaLine[]), action: 'decoded' };
}

/**
 * Repair one stored lyrics document.
 *
 * The line count is preserved on both text columns, so the translation cache
 * (indexed by line number) stays aligned; only the reading cache — which the
 * entity text genuinely corrupted — is re-shaped or dropped. A row whose three
 * columns are all clean reports `changed: false` and is never written.
 */
export function repairLyricsHtmlEntities(input: LyricsEntityRepairInput): LyricsEntityRepairResult {
  const rawInput = input.raw ?? '';
  const syncedInput = input.synced ?? '';
  const furiganaInput = input.furigana ?? '';

  const raw = decodeLyricsHtmlEntities(rawInput);
  const synced = decodeLyricsHtmlEntities(syncedInput);
  const textChanged = raw !== rawInput || synced !== syncedInput;
  // Only a cache that actually carries an entity is worth touching: a cache that
  // mismatches for some unrelated legacy reason is not this repair's business.
  const furiganaDirty = findLyricsHtmlEntity(furiganaInput) !== null;

  if (!textChanged && !furiganaDirty) {
    return { changed: false, raw, synced, furigana: furiganaInput, furiganaAction: 'unchanged' };
  }

  const furigana = furiganaDirty
    ? repairFurigana(furiganaInput, raw)
    : { value: furiganaInput, action: 'unchanged' as const };

  return {
    changed: textChanged || furigana.action !== 'unchanged',
    raw,
    synced,
    furigana: furigana.value,
    furiganaAction: furigana.action,
  };
}
