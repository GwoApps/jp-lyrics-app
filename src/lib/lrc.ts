import { lineFuzzyMatch } from './match.ts';

/** Parsed LRC sync line */
export interface SyncLine {
  timeMs: number;
  text: string;
}

/**
 * Standard LRC metadata keys that describe the document (not lyrics).
 * `ar`=artist, `ti`=title, `al`=album, `by`=editor, `offset`=timestamp
 * adjustment, `re`=program, `ve`=version, `length`=track length.
 */
const LRC_METADATA_KEYS = new Set(['ar', 'ti', 'al', 'by', 'offset', 're', 've', 'length']);

/** Match a standard LRC metadata tag line such as `[ar:YOASOBI]` / `[offset:120]`. */
const METADATA_LINE_RE = /^\[([a-z]+):(.*)\]$/i;

/**
 * Source of truth for the LRC timestamp syntax. Every matcher below is built
 * from this one fragment, so the parser, the plain-text stripper and the export
 * pairing can never drift into accepting different forms (issue #340).
 *
 * Groups: 1 = minutes (1-2 digits), 2 = seconds (exactly 2 digits),
 * 3 = optional fraction digits (1-3).
 *
 * The fragment is a JS string embedded into a regular expression constructor,
 * so it carries two escaping layers: a bracket that is literal in the pattern is
 * written with a doubled backslash, and a literal backslash needs four. Digit
 * classes are spelled out as `[0-9]` because inside a plain string `\d` would
 * collapse to a literal `d`.
 *
 * The third segment may be separated by a dot (`[mm:ss.xx]`, the canonical LRC
 * form) or by a colon (`[mm:ss:xx]`, a widely used "dot typed as a colon"
 * variant). The colon form is read as a fraction of a second, so `[00:12:34]`
 * is 12340 ms (`[00:12.340]`) and its digits are zero-padded on the right
 * (`[00:12:3]` -> 300 ms), matching the existing lenient style. Non-standard
 * 1-2 digit minutes and single-digit seconds (`[1:23.45]`, `[0:5]`) stay accepted.
 */
export const LRC_TIMESTAMP_PATTERN = '\\[([0-9]{1,2}):([0-9]{2})(?:[.:]([0-9]{1,3}))?\\]';

/** Global matcher used to expand every timestamp inside a multi-timestamp prefix. */
export const LRC_TIMESTAMP_REGEX = new RegExp(LRC_TIMESTAMP_PATTERN, 'g');

/**
 * A single timestamp as typed into the editor: the same syntax as
 * {@link LRC_TIMESTAMP_PATTERN} without the surrounding brackets.
 */
const LRC_TIMESTAMP_ONLY_REGEX = new RegExp('^(?:' + LRC_TIMESTAMP_PATTERN.slice(2, -2) + ')$');

/** One or more timestamps at the start of an LRC lyric row (any supported form). */
export const LRC_LEADING_TIMESTAMPS_REGEX = new RegExp('^(?:' + LRC_TIMESTAMP_PATTERN + '[\t ]*)+');

/** Multi-line matcher dropping every leading timestamp prefix from a document. */
const LEADING_TIMESTAMPS_MULTILINE_REGEX = new RegExp('^(?:' + LRC_TIMESTAMP_PATTERN + '[\t ]*)+', 'gm');

/**
 * Strip every leading timestamp prefix from a full LRC document, keeping the
 * lyric text after it. Shared with the plain-text derivation of synced lyrics
 * so it can never lag behind {@link LRC_TIMESTAMP_REGEX}.
 */
export function stripLrcTimestamps(value: string): string {
  return value.replace(LEADING_TIMESTAMPS_MULTILINE_REGEX, '');
}

/**
 * Strip every leading timestamp prefix from a single LRC row, keeping the lyric
 * text after it. A row without a timestamp is returned unchanged (trimmed).
 */
export function stripLrcTimestampsFromLine(value: string): string {
  const trimmed = value.trim();
  const prefix = trimmed.match(LRC_LEADING_TIMESTAMPS_REGEX)?.[0] ?? '';
  return prefix ? trimmed.slice(prefix.length).trim() : trimmed;
}

/**
 * Parse minutes/seconds/fraction (as captured by {@link LRC_TIMESTAMP_REGEX})
 * into ms. The fraction separator (dot or colon) is not part of the capture, so
 * both forms share this single numeric conversion.
 */
function timestampCapturesToMs(minutes: string, seconds: string, fraction: string | undefined): number {
  const secs = Number.parseInt(seconds, 10);
  if (secs >= 60) return NaN;
  const frac = (fraction ?? '').padEnd(3, '0');
  return Number.parseInt(minutes, 10) * 60000
    + secs * 1000
    + (frac ? Number.parseInt(frac, 10) : 0);
}

/**
 * Expand a multi-timestamp LRC row into one entry per timestamp.
 * Supports non-standard forms (`[1:23.45]`, `[01:23]`, `[00:12:34]`) with 1-2
 * digit minutes and an optional dot- or colon-separated fraction. Returns null
 * when the row has no leading timestamp.
 */
function parseTimestampedRow(raw: string): SyncLine[] | null {
  const prefix = raw.match(LRC_LEADING_TIMESTAMPS_REGEX)?.[0];
  if (!prefix) return null;
  const text = raw.slice(prefix.length).trim();
  if (!text) return [];
  const lines: SyncLine[] = [];
  for (const match of prefix.matchAll(LRC_TIMESTAMP_REGEX)) {
    const timeMs = timestampCapturesToMs(match[1], match[2], match[3]);
    if (!Number.isNaN(timeMs)) lines.push({ timeMs, text });
  }
  return lines;
}

/** True when a trimmed line is a standard LRC metadata tag (case-insensitive). */
export function isLrcMetadataLine(trimmed: string): boolean {
  const match = trimmed.match(METADATA_LINE_RE);
  return !!match && LRC_METADATA_KEYS.has(match[1].toLowerCase());
}

/** Parsed standard LRC metadata tags. */
export interface LrcMetadata {
  /** `[offset:±ms]` value, or null when absent / invalid. */
  offsetMs: number | null;
  /** Tag values keyed by lowercased tag name (`ar`, `ti`, `al`, `by`, …). */
  tags: Record<string, string>;
}

/**
 * Extract standard LRC metadata tags (`ar`/`ti`/`al`/`by`/`offset`/`re`/`ve`/
 * `length`, case-insensitive). `offset` is parsed and preserved but deliberately
 * NOT auto-applied to timestamps: the timeline editor already exposes explicit
 * offset controls, and silently shifting every timestamp on parse would
 * surprise users editing an existing sync. Metadata is never part of lyric text.
 */
export function extractLrcMetadata(lrc: string): LrcMetadata {
  const tags: Record<string, string> = {};
  let offsetMs: number | null = null;
  for (const line of lrc.split('\n')) {
    const trimmed = line.trim();
    const match = trimmed.match(METADATA_LINE_RE);
    if (!match || !LRC_METADATA_KEYS.has(match[1].toLowerCase())) continue;
    const key = match[1].toLowerCase();
    const value = match[2].trim();
    tags[key] = value;
    if (key === 'offset') {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed)) offsetMs = parsed;
    }
  }
  return { offsetMs, tags };
}

/** Editable timeline row. A null timestamp means the lyric line has not been marked yet. */
export interface TimelineDraftLine {
  timeMs: number | null;
  text: string;
}

/** Return lyric text from standard or partially annotated LRC, preserving row order. */
export function getLrcTextLines(value: string): string[] {
  return value.split('\n').flatMap((raw) => {
    const trimmed = raw.trim();
    if (!trimmed || isLrcMetadataLine(trimmed)) return [];
    const text = stripLrcTimestampsFromLine(trimmed);
    return text ? [text] : [];
  });
}

/**
 * Result of aligning a plain-lyrics draft against a synced LRC source.
 * `lines` is what the editor edits; the counts drive the mismatch hint so a
 * fuzzy-matched / unmatched sync never silently disappears.
 */
export interface TimelineDraftResult {
  lines: TimelineDraftLine[];
  /** Number of plain lines whose timestamp was attached via fuzzy matching. */
  fuzzyMatched: number;
  /** Number of synced timed rows that could not be attached to any plain line. */
  unmatched: number;
}

/**
 * Build an editor draft from plain lyrics and any existing full or partial LRC.
 *
 * Alignment prefers exact, order-preserving text matches (so repeated chorus
 * lines consume their own timestamp queue in order). Lines that would otherwise
 * lose their timestamp to a tiny text difference (full/half-width, punctuation,
 * bracket, furigana drift) fall back to position-aware fuzzy matching via
 * `lineFuzzyMatch`, keeping the detail page's follow-scroll/seek usable instead
 * of silently dropping timestamps.
 */
export function buildTimelineDraft(plainLyrics: string, syncedLyrics: string): TimelineDraftResult {
  const plain = plainLyrics.split('\n')
    .map((line) => line.trim())
    .filter((line) => Boolean(line) && !isLrcMetadataLine(line));
  const syncedRows = syncedLyrics.split('\n').flatMap<TimelineDraftLine>((raw) => {
    const trimmed = raw.trim();
    if (!trimmed || isLrcMetadataLine(trimmed)) return [];
    const parsed = parseTimestampedRow(trimmed);
    if (parsed === null) return [{ timeMs: null, text: trimmed }];
    return parsed;
  });

  if (plain.length === 0) return { lines: syncedRows, fuzzyMatched: 0, unmatched: 0 };
  if (syncedRows.length === plain.length && syncedRows.every((row, index) => row.text === plain[index])) {
    return { lines: syncedRows, fuzzyMatched: 0, unmatched: 0 };
  }

  const lines: TimelineDraftLine[] = plain.map((text) => ({ text, timeMs: null }));

  // Exact, order-preserving pass: each distinct text gets an ordered queue, so
  // repeated chorus lines consume their own timestamps in the order they appear.
  const exactQueues = new Map<string, number[]>();
  for (const row of syncedRows) {
    if (row.timeMs == null) continue;
    const queue = exactQueues.get(row.text) ?? [];
    queue.push(row.timeMs);
    exactQueues.set(row.text, queue);
  }
  const consumed = new Array(syncedRows.length).fill(false);
  for (let i = 0; i < plain.length; i += 1) {
    const queue = exactQueues.get(plain[i]);
    const timeMs = queue?.shift();
    if (timeMs != null) {
      lines[i] = { ...lines[i], timeMs };
      // Mark the earliest unconsumed synced row with this text as consumed so the
      // fuzzy pass never reuses it.
      for (let j = 0; j < syncedRows.length; j += 1) {
        if (!consumed[j] && syncedRows[j].text === plain[i] && syncedRows[j].timeMs === timeMs) {
          consumed[j] = true;
          break;
        }
      }
    }
  }

  // Position-aware fuzzy fallback for lines still missing a timestamp. Pick the
  // nearest available timed synced row (by row index) that fuzzy-matches, so
  // alignment stays localized and avoids grabbing a far-away duplicate.
  const timedIndexes = syncedRows
    .map((row, index) => (row.timeMs != null ? index : -1))
    .filter((index) => index >= 0);
  let fuzzyMatched = 0;
  for (let i = 0; i < plain.length; i += 1) {
    if (lines[i].timeMs != null) continue;
    let best = -1;
    let bestDist = Infinity;
    for (const j of timedIndexes) {
      if (consumed[j]) continue;
      if (!lineFuzzyMatch(plain[i], syncedRows[j].text)) continue;
      const dist = Math.abs(j - i);
      if (dist < bestDist) {
        bestDist = dist;
        best = j;
      }
    }
    if (best >= 0) {
      lines[i] = { ...lines[i], timeMs: syncedRows[best].timeMs };
      consumed[best] = true;
      fuzzyMatched += 1;
    }
  }

  const unmatched = consumed.reduce(
    (count, wasConsumed, index) => count + (wasConsumed || syncedRows[index].timeMs == null ? 0 : 1),
    0,
  );
  return { lines, fuzzyMatched, unmatched };
}

/**
 * Build an editor draft from plain lyrics and any existing full or partial LRC.
 * Convenience wrapper returning only the editable lines (backwards compatible).
 */
export function createTimelineDraft(plainLyrics: string, syncedLyrics: string): TimelineDraftLine[] {
  return buildTimelineDraft(plainLyrics, syncedLyrics).lines;
}

/**
 * Align a non-blank timeline draft to rendered lyric rows that may preserve blank separators.
 * Blank rendered rows do not consume a timeline entry.
 */
export function mapTimelineTimestamps(
  renderedRows: string[],
  plainLyrics: string,
  syncedLyrics: string,
): (number | null)[] {
  const draft = createTimelineDraft(plainLyrics, syncedLyrics);
  let draftIndex = 0;
  const timestamps = renderedRows.map((text) => {
    if (!text.trim()) return null;
    const timestamp = draft[draftIndex]?.timeMs ?? null;
    draftIndex += 1;
    return timestamp;
  });

  return fillMissingTimestampsByText(timestamps, renderedRows, syncedLyrics);
}

/**
 * Detail-page fallback for rendered lyric rows the strict order-preserving
 * alignment left untimed.
 *
 * The rendered rows come from `lyrics_furigana` (server pre-computed), whose
 * text can drift from `lyrics_raw` in full/half-width, bracketed notes, case or
 * wording — e.g. the furigana was regenerated from a synced source. When such a
 * row does not line up with any `lyrics_raw` line, its timestamps entry is null
 * even though the synced LRC carries the correct lyric text with its own time.
 * Rather than leave "has an LRC but can't highlight" dead zones, match the
 * rendered text directly against the synced lines and fill the gap.
 *
 * This is a pure read-only overlay: it never writes to stored data, and it
 * never reuses a timestamp the alignment already assigned elsewhere, so a
 * repeated chorus line cannot double-highlight / double-seek.
 */
function fillMissingTimestampsByText(
  timestamps: (number | null)[],
  renderedRows: string[],
  syncedLyrics: string,
): (number | null)[] {
  if (!timestamps.some((ts) => ts == null)) return timestamps;
  const syncLines = parseLrc(syncedLyrics);
  if (syncLines.length === 0) return timestamps;

  const usedTimes = new Set<number>(timestamps.filter((ts): ts is number => ts != null));
  const result = [...timestamps];
  for (let i = 0; i < renderedRows.length; i += 1) {
    if (result[i] != null) continue;
    const text = renderedRows[i];
    if (!text.trim()) continue;

    let bestIndex = -1;
    let bestDist = Infinity;
    for (let j = 0; j < syncLines.length; j += 1) {
      const candidate = syncLines[j];
      if (usedTimes.has(candidate.timeMs)) continue;
      if (!lineFuzzyMatch(text, candidate.text)) continue;
      const dist = Math.abs(j - i);
      if (dist < bestDist) {
        bestDist = dist;
        bestIndex = j;
      }
    }
    if (bestIndex >= 0) {
      result[i] = syncLines[bestIndex].timeMs;
      usedTimes.add(syncLines[bestIndex].timeMs);
    }
  }
  return result;
}

/** Serialize a full or partial draft. Untimed rows remain plain so draft progress is not lost. */
export function serializeTimelineDraft(lines: TimelineDraftLine[]): string {
  return lines.map((line) => line.timeMs == null
    ? line.text
    : `[${fmtMs(line.timeMs)}]${line.text}`
  ).join('\n');
}

/** Parse LRC timestamp text into sorted SyncLine array */
export function parseLrc(lrc: string): SyncLine[] {
  const lines: SyncLine[] = [];
  for (const raw of lrc.split('\n')) {
    if (isLrcMetadataLine(raw.trim())) continue;
    const parsed = parseTimestampedRow(raw);
    if (parsed) lines.push(...parsed);
  }
  return lines.sort((a, b) => a.timeMs - b.timeMs);
}

/** Shift all timestamps by an offset, clamping negative values to zero. */
export function offsetLrcLines(syncLines: SyncLine[], offsetMs: number): SyncLine[] {
  return syncLines.map((line) => ({
    ...line,
    timeMs: Math.max(0, Math.round(line.timeMs + offsetMs)),
  }));
}

/** Update one line timestamp and return a chronologically sorted copy. */
export function updateLrcLineTime(syncLines: SyncLine[], index: number, timeMs: number): SyncLine[] {
  return syncLines
    .map((line, lineIndex) => lineIndex === index
      ? { ...line, timeMs: Math.max(0, Math.round(timeMs)) }
      : { ...line })
    .sort((a, b) => a.timeMs - b.timeMs);
}

/** Serialize sync lines using millisecond-precision LRC timestamps. */
export function serializeLrc(syncLines: SyncLine[]): string {
  return [...syncLines]
    .sort((a, b) => a.timeMs - b.timeMs)
    .map((line) => `[${fmtMs(line.timeMs)}]${line.text}`)
    .join('\n');
}

/** Compare only the ordered lyric text, ignoring all timestamp changes. */
export function hasSameLrcText(left: string, right: string): boolean {
  const leftText = getLrcTextLines(left);
  const rightText = getLrcTextLines(right);
  return leftText.length === rightText.length
    && leftText.every((text, index) => text === rightText[index]);
}

/** Resolve a submitted LRC without touching plain lyrics for timestamp-only edits. */
export function resolveLrcTextUpdate(existingRaw: string, existingSynced: string, submittedSynced: string) {
  if (hasSameLrcText(existingSynced, submittedSynced)) {
    return { lyricsRaw: existingRaw, contentChanged: false };
  }
  const submittedText = getLrcTextLines(submittedSynced);
  const existingText = getLrcTextLines(existingRaw);
  if (submittedText.length === existingText.length
    && submittedText.every((text, index) => text === existingText[index])) {
    return { lyricsRaw: existingRaw, contentChanged: false };
  }
  const lyricsRaw = submittedText.join('\n');
  return { lyricsRaw, contentChanged: lyricsRaw !== existingRaw };
}

/** Result of guarding a timeline-save submission against stale plain lyrics. */
export type TimelineSaveGuard =
  | { ok: true; lyricsRaw: string; contentChanged: boolean }
  | { ok: false; error: 'missing_source_lyrics' | 'stale_timeline_source' };

/**
 * Guard a timeline-save submission against silent lost updates.
 *
 * The timeline editor loads `lyrics_raw` once and lets the user edit for a
 * long time. When it finally saves, another tab/session may have already
 * rewritten the plain lyrics — writing the submitted LRC back would
 * reverse-fill stale text into `lyrics_raw` and clobber the newer lyrics.
 * The client submits the `lyrics_raw` snapshot it was built from
 * (`sourceLyrics`); when it no longer matches the current database value the
 * submission is refused instead of overwriting (mirrors the stale-source
 * protection used by the furigana/translation save endpoints).
 */
export function resolveTimelineSave(
  existingRaw: string,
  existingSynced: string,
  submittedSynced: string,
  sourceLyrics: string,
): TimelineSaveGuard {
  if (typeof sourceLyrics !== 'string') {
    return { ok: false, error: 'missing_source_lyrics' };
  }
  if (sourceLyrics !== existingRaw) {
    return { ok: false, error: 'stale_timeline_source' };
  }
  return { ok: true, ...resolveLrcTextUpdate(existingRaw, existingSynced, submittedSynced) };
}

/**
 * Parse an editor timestamp: M:SS with an optional dot- or colon-separated
 * fraction (M:SS, M:SS.d, M:SS.dd, M:SS.ddd, M:SS:dd, M:SS:ddd). The colon form
 * is the same "dot typed as a colon" variant {@link LRC_TIMESTAMP_REGEX}
 * accepts, and shares its numeric conversion.
 */
export function parseLrcTimestamp(value: string): number | null {
  const match = value.trim().match(LRC_TIMESTAMP_ONLY_REGEX);
  if (!match) return null;
  const timeMs = timestampCapturesToMs(match[1], match[2], match[3]);
  // `timestampCapturesToMs` reports seconds >= 60 as NaN; the editor contract is
  // a nullable parse, so NaN is normalised to null (unchanged behaviour).
  return Number.isNaN(timeMs) ? null : timeMs;
}

/** Find the active sync line index for a given progress position */
export function findActiveLine(syncLines: SyncLine[], progressMs: number): number {
  for (let i = syncLines.length - 1; i >= 0; i--) {
    if (progressMs >= syncLines[i].timeMs) return i;
  }
  return 0;
}

/**
 * A monotonicity conflict in a timeline: `index` must not be earlier than
 * `previousIndex` (1-based `line` is reported to the user for display).
 */
export interface TimelineConflict {
  /** 0-based index of the offending line in the draft. */
  index: number;
  /** 1-based line number shown to the user. */
  line: number;
  /** 0-based index of the previous timed line this line violates. */
  previousIndex: number;
  /** 1-based line number of the previous timed line. */
  previousLine: number;
  /** Offending timestamp in milliseconds. */
  timeMs: number;
  /** Timestamp of the previous timed line in milliseconds. */
  previousTimeMs: number;
}

/**
 * Validate that all non-null timestamps are strictly increasing.
 * Returns every violation (a line earlier than or equal to the previous
 * timed line); an empty array means the draft is monotonic. Untimed rows are
 * skipped and never reported. When `ignoreDuplicates` is set, equal timestamps
 * are tolerated so the same timeline can be offset/clamped without noise.
 */
export function findTimelineConflicts(
  lines: TimelineDraftLine[],
  ignoreDuplicates = false,
): TimelineConflict[] {
  const conflicts: TimelineConflict[] = [];
  let previousIndex = -1;
  let previousTimeMs = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const timeMs = lines[index]?.timeMs;
    if (timeMs == null) continue;
    if (previousIndex >= 0) {
      const violates = ignoreDuplicates ? timeMs < previousTimeMs : timeMs <= previousTimeMs;
      if (violates) {
        conflicts.push({
          index,
          line: index + 1,
          previousIndex,
          previousLine: previousIndex + 1,
          timeMs,
          previousTimeMs,
        });
      }
    }
    previousIndex = index;
    previousTimeMs = timeMs;
  }
  return conflicts;
}

/**
 * Validate an LRC string against the same strict monotonic rule used by the
 * editor and the highlight engine. Used by the write API to stop invalid data
 * from bypassing the UI. Returns an empty array when valid.
 */
export function findLrcConflicts(lrc: string): TimelineConflict[] {
  const lines: TimelineDraftLine[] = [];
  for (const raw of lrc.split('\n')) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const parsed = parseTimestampedRow(trimmed);
    if (parsed === null) {
      // Untimed rows are kept in timeline drafts; they are ignored by the check.
      lines.push({ timeMs: null, text: trimmed });
      continue;
    }
    // A timestamp with no lyric text (e.g. `[00:12.00]`) carries nothing to highlight.
    if (parsed.length === 0) continue;
    lines.push(...parsed);
  }
  return findTimelineConflicts(lines);
}
export function fmtMs(ms: number): string {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const ss = ms % 1000;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ss).padStart(3, '0')}`;
}

/** Format milliseconds as M:SS (for progress display) */
export function fmtTime(ms: number): string {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${String(s).padStart(2, '0')}`;
}
