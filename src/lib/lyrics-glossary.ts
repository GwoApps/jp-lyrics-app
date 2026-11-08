/**
 * The per-song terminology table (`songs.lyrics_glossary`) — parsing, state
 * classification and write validation.
 *
 * The column stores a JSON array of `{ original, translation }`. Before this
 * module the column had four states the UI could not tell apart (NULL, 'null',
 * '[]', a damaged blob), while the extraction pipeline treats them very
 * differently: an array is reused as a hard constraint on every later
 * translation, 'null' means "last extraction failed, retry next time", and a
 * damaged value silently degrades to "no terminology" (issue #341).
 *
 * Zero server imports on purpose: the client renders the exact same states.
 */

export interface GlossaryEntry {
  original: string;
  translation: string;
  /**
   * True when a user pinned this term by hand (issue #341). A lyrics edit
   * invalidates the AUTO-extracted table (it was derived from the old text),
   * but hand-written terms are the user's own correction and must survive —
   * they are kept, auto entries are dropped.
   */
  manual?: boolean;
}

/** Hard cap shared with `GLOSSARY_PROMPT` ("Max 20 entries"). */
export const GLOSSARY_MAX_ENTRIES = 20;
/** Per-field cap (characters, after trimming) for hand-written entries. */
export const GLOSSARY_MAX_LENGTH = 200;

/** Marker stored in the column when an extraction FAILED (retry on next run). */
export const GLOSSARY_FAILED_MARKER = 'null';

/**
 * - `absent`  — the column is NULL: never extracted, or explicitly cleared.
 * - `failed`  — the last extraction failed; the next translation retries.
 * - `ok`      — a successful extraction, possibly with zero entries.
 * - `damaged` — unparseable / not an array: the next translation re-extracts
 *   (and repairs the column) instead of running unconstrained forever.
 */
export type GlossaryState = 'absent' | 'failed' | 'ok' | 'damaged';

export interface ParsedGlossary {
  state: GlossaryState;
  entries: GlossaryEntry[];
}

const PARSED_ABSENT: ParsedGlossary = { state: 'absent', entries: [] };
const PARSED_FAILED: ParsedGlossary = { state: 'failed', entries: [] };
const PARSED_DAMAGED: ParsedGlossary = { state: 'damaged', entries: [] };

function isEntry(value: unknown): value is GlossaryEntry {
  return typeof value === 'object' && value !== null
    && typeof (value as GlossaryEntry).original === 'string'
    && typeof (value as GlossaryEntry).translation === 'string';
}

/** Classify the stored column value into one of the four states. */
export function parseLyricsGlossary(raw: string | null | undefined): ParsedGlossary {
  if (raw === null || raw === undefined || raw.trim() === '') return PARSED_ABSENT;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return PARSED_DAMAGED;
  }
  if (parsed === null) return PARSED_FAILED;
  if (!Array.isArray(parsed)) return PARSED_DAMAGED;
  return { state: 'ok', entries: parsed.filter(isEntry) };
}

/**
 * Whether the stored value holds anything a user would miss: real entries, or
 * an unreadable blob. The 'null' retry marker and '[]' do not count.
 */
export function hasGlossaryEntries(raw: string | null | undefined): boolean {
  if (!raw || raw.trim() === '' || raw.trim() === GLOSSARY_FAILED_MARKER) return false;
  const parsed = parseLyricsGlossary(raw);
  if (parsed.state === 'ok') return parsed.entries.length > 0;
  // Damaged values are still the user's stored data — do not claim nothing
  // would be lost when a lyrics change wipes them.
  return parsed.state === 'damaged';
}

/**
 * Whether a lyrics change would actually DESTROY part of the stored value.
 *
 * Hand-pinned entries survive such a write (see `manualGlossaryEntries`), so a
 * table holding only pins loses nothing — it must not trigger the "derived
 * caches were reset" notice.
 */
export function hasAutoGlossaryEntries(raw: string | null | undefined): boolean {
  const parsed = parseLyricsGlossary(raw);
  if (parsed.state === 'damaged') return true;
  return parsed.entries.some((entry) => entry.manual !== true);
}

/** Only the hand-written entries (what survives a lyrics change). */
export function manualGlossaryEntries(raw: string | null | undefined): GlossaryEntry[] {
  return parseLyricsGlossary(raw).entries.filter((entry) => entry.manual === true);
}

/**
 * Merge freshly extracted terms into the user's hand-pinned ones.
 *
 * Manual entries come first and always win: the model must learn the user's
 * correction, not overwrite it. Duplicates (same `original`) are dropped from
 * the extracted side, and the shared 20-entry cap applies to the result.
 */
export function mergeGlossaryEntries(
  manual: GlossaryEntry[],
  extracted: GlossaryEntry[],
): GlossaryEntry[] {
  const seen = new Set(manual.map((entry) => entry.original));
  const merged = [...manual];
  for (const entry of extracted) {
    if (merged.length >= GLOSSARY_MAX_ENTRIES) break;
    if (seen.has(entry.original)) continue;
    seen.add(entry.original);
    merged.push({ original: entry.original, translation: entry.translation });
  }
  return merged;
}

/**
 * Whether the stored table still needs an extraction run.
 *
 * 'absent' / 'failed' obviously do. So does a table made ONLY of hand-written
 * terms: that is the state a lyrics edit leaves behind (the auto entries were
 * invalidated, the pins were kept), and the new text deserves its own
 * extraction. A table with at least one auto entry — including the empty
 * `[]` "extracted, no terms" result — is reused as-is, which is what stops a
 * pending empty extraction from re-running on every translation.
 *
 * Cost note: a song with hand-pinned terms where the extractor genuinely finds
 * nothing stays in this state, so each later translation re-runs the (cheap,
 * bounded) extraction call once. That is preferred over the alternative — a
 * stored flag that would silently skip extraction after the lyrics changed and
 * leave the auto half of the table permanently stale.
 */
export function needsGlossaryExtraction(parsed: ParsedGlossary): boolean {
  // 'damaged' is included on purpose: an unreadable value must not pin the song
  // to "no terminology" forever, and a successful run repairs the column.
  if (parsed.state !== 'ok') return true;
  return parsed.entries.length > 0 && parsed.entries.every((entry) => entry.manual === true);
}

/** Serialize entries for storage ('[]' is a real value: "extracted, no terms"). */
export function serializeLyricsGlossary(entries: GlossaryEntry[]): string {
  return JSON.stringify(entries);
}

/**
 * Mark which submitted entries the user actually vouched for.
 *
 * An entry is pinned (survives a later lyrics edit) when it is NEW, or when its
 * translation differs from what was stored — i.e. the user typed a correction.
 * Terms the user merely passed through unchanged keep their extracted status,
 * so a lyrics edit still invalidates them: they were derived from text that no
 * longer exists. Client-supplied `manual` flags are ignored entirely.
 */
export function applyManualPins(
  submitted: GlossaryEntry[],
  storedRaw: string | null | undefined,
): GlossaryEntry[] {
  const stored = new Map(parseLyricsGlossary(storedRaw).entries.map((entry) => [entry.original, entry]));
  return submitted.map((entry) => {
    const previous = stored.get(entry.original);
    const pinned = !previous || previous.manual === true || previous.translation !== entry.translation;
    return { original: entry.original, translation: entry.translation, ...(pinned ? { manual: true } : {}) };
  });
}

export type GlossaryValidation =
  | { ok: true; entries: GlossaryEntry[] }
  | { ok: false; error: 'invalid_glossary' | 'glossary_too_long' | 'glossary_entry_invalid' | 'glossary_entry_too_long' | 'glossary_duplicate' };

/**
 * Validate a client-submitted glossary (PUT /api/songs/[id]).
 *
 * Shape, entry count and per-field length are all bounded here so the column
 * can never be used to smuggle unbounded text into every future prompt.
 * Duplicate `original` values are rejected rather than silently deduped: two
 * conflicting translations for one term is exactly the state that makes the
 * injected constraint meaningless.
 */
export function validateGlossaryInput(value: unknown): GlossaryValidation {
  if (!Array.isArray(value)) return { ok: false, error: 'invalid_glossary' };
  if (value.length > GLOSSARY_MAX_ENTRIES) return { ok: false, error: 'glossary_too_long' };
  const entries: GlossaryEntry[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!isEntry(item)) return { ok: false, error: 'glossary_entry_invalid' };
    const original = item.original.trim();
    const translation = item.translation.trim();
    if (!original || !translation) return { ok: false, error: 'glossary_entry_invalid' };
    if (original.length > GLOSSARY_MAX_LENGTH || translation.length > GLOSSARY_MAX_LENGTH) {
      return { ok: false, error: 'glossary_entry_too_long' };
    }
    if (seen.has(original)) return { ok: false, error: 'glossary_duplicate' };
    seen.add(original);
    // No `manual` flag here on purpose: whether an entry counts as pinned
    // depends on what is already stored (see `applyManualPins`), and a client
    // must not be able to declare its own terms immune to invalidation.
    entries.push({ original, translation });
  }
  return { ok: true, entries };
}
