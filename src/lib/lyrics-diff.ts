/**
 * Line-level diff for the lyrics re-sync confirmation preview (issue #493).
 *
 * Re-syncing lyrics whose text changed wipes the line-indexed derived caches
 * (furigana / translation / auto glossary). The user used to get only a static
 * warning with no idea what changed — even a single blank line could trigger a
 * destructive reset. This module computes a compact, deterministic diff from
 * the two plain-lyrics documents so the confirmation dialog can show exactly
 * which lines were added / removed / changed.
 *
 * Pure and dependency-free: it runs on the server while building the candidate
 * payload, and its result is a small summary carried in the signed candidate
 * token (so confirming never needs a second fetch). Diffs are computed on the
 * same EOL-normalized text that is written to `lyrics_raw`, so line numbers in
 * the preview line up with the furigana / translation row indices.
 */

export interface LyricsDiffLine {
  /** 1-based line number in the new (candidate) document; absent for removals. */
  newLine: number | null;
  /** 1-based line number in the old (stored) document; absent for additions. */
  oldLine: number | null;
  /** 'added' | 'removed' | 'changed' — what happened to this line. */
  type: 'added' | 'removed' | 'changed';
  /** Text of the line from the new document ('' for a removal). */
  text: string;
  /** Text of the line from the old document ('' for an addition). */
  oldText: string;
}

export interface LyricsDiff {
  added: number;
  removed: number;
  changed: number;
  /** Change rows in document order, truncated to `MAX_DIFF_ROWS`. */
  rows: LyricsDiffLine[];
  /** Total change rows before truncation. */
  totalChanges: number;
}

/** Cap the payload / dialog size for long songs. */
export const MAX_DIFF_ROWS = 8;

type Op = { kind: 'removed'; line: number; text: string }
  | { kind: 'added'; line: number; text: string };

/**
 * Split a document into lyric rows on LF. A single trailing newline terminates
 * the last row rather than starting an empty one.
 *
 * `fold` mirrors `hasLyricsContentChanged`: the candidate side is folded to LF
 * (that is exactly what gets written) while the stored side is kept verbatim
 * (legacy CRLF rows end with `\r`, and the caches were derived from those
 * rows). Keeping that asymmetry guarantees the invariant that a content change
 * which invalidates caches always shows up as at least one diff row.
 */
function splitLines(value: string, fold: boolean): string[] {
  const normalized = fold ? value.replace(/\r\n?/g, '\n') : value;
  return (normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized).split('\n');
}

/**
 * Longest Common Subsequence over normalized lyric lines.
 *
 * Lyrics documents are small (tens to low hundreds of lines), so an O(n*m)
 * DP table is cheap and — unlike a greedy line matcher — never reports a
 * spurious "changed" when a couple of identical lines shift position.
 * Exact line equality is intentional: these caches are indexed by row, so a
 * blank-line-only difference is a real change and must show up in the diff.
 */
function lcsTable(a: string[], b: string[]): number[][] {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  return dp;
}

/**
 * Summarize the line-level changes from the stored lyrics to the candidate.
 * Both inputs are normalized to LF first (CRLF/CR from a provider is a
 * transport quirk, not a content change); the returned line numbers index the
 * normalized documents, i.e. exactly what gets written and indexed later.
 *
 * `added` / `removed` count lines present on only one side; a replacement
 * (a removal immediately followed by an addition) is reported as one `changed`
 * row. The summary counts always reflect the full document, while `rows` is
 * capped at `maxRows` so a long song cannot blow up the token or the dialog.
 */
export function diffLyrics(before: string, after: string, maxRows: number = MAX_DIFF_ROWS): LyricsDiff {
  const a = splitLines(before, false);
  const b = splitLines(after, true);
  const dp = lcsTable(a, b);

  // 1. Walk the LCS and collect every non-equal line as an ordered op.
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ kind: 'removed', line: i + 1, text: a[i] });
      i++;
    } else {
      ops.push({ kind: 'added', line: j + 1, text: b[j] });
      j++;
    }
  }
  while (i < a.length) ops.push({ kind: 'removed', line: ++i, text: a[i - 1] });
  while (j < b.length) ops.push({ kind: 'added', line: ++j, text: b[j - 1] });

  // 2. Pair adjacent runs of opposite kinds into 'changed' rows, then emit the
  //    leftovers as pure additions / removals. This keeps a one-line edit
  //    readable ("line 3: old → new") without losing any content.
  const counts = { added: 0, removed: 0, changed: 0 };
  const rows: LyricsDiffLine[] = [];
  const push = (row: LyricsDiffLine) => {
    if (rows.length < maxRows) rows.push(row);
  };
  const nextRunStart = (from: number): number => {
    let k = from;
    while (k < ops.length && ops[k].kind === ops[from].kind) k++;
    return k;
  };

  let idx = 0;
  while (idx < ops.length) {
    const runEnd = nextRunStart(idx);
    const run = ops.slice(idx, runEnd);
    idx = runEnd;

    // If the next run is the opposite kind, consume it and pair positionally.
    let opposite: Op[] = [];
    if (idx < ops.length && ops[idx].kind !== run[0].kind) {
      const oppEnd = nextRunStart(idx);
      opposite = ops.slice(idx, oppEnd);
      idx = oppEnd;
    }

    const paired = Math.min(run.length, opposite.length);
    for (let k = 0; k < paired; k++) {
      const oldOp = run[k];
      const newOp = opposite[k];
      counts.changed++;
      // Normalize pairing order so `oldText` always comes from the old side
      // regardless of whether the walk emitted removals or additions first.
      const removed = oldOp.kind === 'removed' ? oldOp : newOp as Extract<Op, { kind: 'removed' }>;
      const added = oldOp.kind === 'added' ? oldOp : newOp as Extract<Op, { kind: 'added' }>;
      push({
        newLine: added.line,
        oldLine: removed.line,
        type: 'changed',
        text: added.text,
        oldText: removed.text,
      });
    }
    for (let k = paired; k < run.length; k++) {
      const op = run[k];
      if (op.kind === 'removed') {
        counts.removed++;
        push({ newLine: null, oldLine: op.line, type: 'removed', text: '', oldText: op.text });
      } else {
        counts.added++;
        push({ newLine: op.line, oldLine: null, type: 'added', text: op.text, oldText: '' });
      }
    }
    for (let k = paired; k < opposite.length; k++) {
      const op = opposite[k];
      if (op.kind === 'removed') {
        counts.removed++;
        push({ newLine: null, oldLine: op.line, type: 'removed', text: '', oldText: op.text });
      } else {
        counts.added++;
        push({ newLine: op.line, oldLine: null, type: 'added', text: op.text, oldText: '' });
      }
    }
  }

  return {
    ...counts,
    rows,
    totalChanges: counts.added + counts.removed + counts.changed,
  };
}
