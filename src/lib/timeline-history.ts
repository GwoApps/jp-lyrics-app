import type { TimelineDraftLine } from './lrc';

/**
 * Undo history for the timeline editor.
 *
 * Two kinds of entries are tracked:
 * - `line`: a single timestamp edit on one row (recovered by restoring that
 *   row's previous `timeMs`).
 * - `snapshot`: a full-table snapshot captured before high-risk batch
 *   operations (overall offset / sort-by-time), so a single Ctrl+Z restores
 *   the entire table to its previous state.
 */

export interface LineHistoryEntry {
  type: 'line';
  index: number;
  previousTime: number | null;
}

export interface SnapshotHistoryEntry {
  type: 'snapshot';
  before: TimelineDraftLine[];
}

export type HistoryEntry = LineHistoryEntry | SnapshotHistoryEntry;

/** Maximum number of undo steps kept in memory. */
export const MAX_HISTORY = 50;

/** Append a single-line timestamp edit to the history stack. */
export function pushLineEntry(
  history: HistoryEntry[],
  index: number,
  previousTime: number | null,
): HistoryEntry[] {
  return [...history.slice(-(MAX_HISTORY - 1)), { type: 'line', index, previousTime }];
}

/** Append a full-table snapshot (before an offset / sort) to the history stack. */
export function pushSnapshotEntry(
  history: HistoryEntry[],
  before: TimelineDraftLine[],
): HistoryEntry[] {
  return [...history.slice(-(MAX_HISTORY - 1)), { type: 'snapshot', before }];
}

export interface UndoResult {
  /** Remaining history stack after popping the top entry. */
  entries: HistoryEntry[];
  /** Restored lines; present when the stack was non-empty. */
  lines?: TimelineDraftLine[];
  /** For `line` entries: the restored row index. */
  lineIndex?: number;
  /** For `line` entries: the restored timestamp of that row. */
  previousTime?: number | null;
}

/**
 * Pop the most recent entry and compute the lines to restore. Returns the
 * trimmed history stack and, when an entry existed, the restored `lines`.
 */
export function applyUndo(
  history: HistoryEntry[],
  currentLines: TimelineDraftLine[],
): UndoResult {
  const entry = history[history.length - 1];
  if (!entry) return { entries: history };
  const entries = history.slice(0, -1);
  if (entry.type === 'snapshot') {
    return { entries, lines: entry.before };
  }
  return {
    entries,
    lines: currentLines.map((line, index) =>
      index === entry.index ? { ...line, timeMs: entry.previousTime } : line,
    ),
    lineIndex: entry.index,
    previousTime: entry.previousTime,
  };
}
