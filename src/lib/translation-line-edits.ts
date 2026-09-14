/**
 * Line-level translation edits (issue #272).
 *
 * The manual proofreading page used to PUT its **whole** snapshot back, so any
 * line another session had written meanwhile (AI resume / whole-song run) was
 * silently rolled back to the editor's stale copy — a lost update with no
 * conflict signal anywhere. The fix is a change-set contract: the client sends
 * only the lines it actually changed, and the server merges exactly those lines
 * into the LATEST stored cache under the existing optimistic lock.
 *
 * Both sides of the wire use the helpers below so the client's diff, the
 * server's validation and the merge stay in lockstep (and stay unit-testable
 * without a browser or a DB).
 *
 * Values are compared and stored **trimmed**: the write path has always stored
 * trimmed translations, so comparing raw values would leave the editor
 * permanently "dirty" after saving a line with trailing whitespace.
 */

export type LineEdit = { index: number; translation: string };

export type LineEditParseResult =
  | { ok: true; edits: LineEdit[] }
  | { ok: false; error: 'missing_changes' | 'invalid_changes' };

/**
 * Diff the editor's draft against the baseline it loaded, returning one edit
 * per line whose trimmed content differs. Untouched lines are not part of the
 * request at all, which is what makes concurrent writes survivable.
 */
export function computeLineEdits(current: readonly string[], baseline: readonly string[]): LineEdit[] {
  const total = Math.max(current.length, baseline.length);
  const edits: LineEdit[] = [];
  for (let i = 0; i < total; i += 1) {
    const value = (current[i] ?? '').trim();
    if (value !== (baseline[i] ?? '').trim()) edits.push({ index: i, translation: value });
  }
  return edits;
}

/**
 * Validate an incoming `changes` payload against the song's source lines.
 *
 * - every entry must be `{ index: number, translation: string }` with `index`
 *   inside the current lyric range (a request built for older lyrics is
 *   rejected outright instead of writing at a shifted index);
 * - duplicate indices collapse to the last one;
 * - blank source lines never carry a translation (same rule as the AI write
 *   path), whatever the client sent for them.
 */
export function parseLineEdits(raw: unknown, sourceLines: readonly string[]): LineEditParseResult {
  if (!Array.isArray(raw)) return { ok: false, error: 'missing_changes' };

  const totalLines = sourceLines.length;
  const byIndex = new Map<number, string>();
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) return { ok: false, error: 'invalid_changes' };
    const { index, translation } = entry as { index?: unknown; translation?: unknown };
    if (typeof index !== 'number' || !Number.isInteger(index)) return { ok: false, error: 'invalid_changes' };
    if (index < 0 || index >= totalLines) return { ok: false, error: 'invalid_changes' };
    if (typeof translation !== 'string') return { ok: false, error: 'invalid_changes' };
    byIndex.set(index, (sourceLines[index] ?? '').trim() ? translation.trim() : '');
  }

  return {
    ok: true,
    edits: [...byIndex.entries()]
      .map(([index, translation]) => ({ index, translation }))
      .sort((a, b) => a.index - b.index),
  };
}

/**
 * Apply edits on top of a base cache, normalising the result to exactly
 * `totalLines` entries so the stored JSON stays index-aligned to the lyrics.
 */
export function applyLineEdits(
  base: readonly string[],
  edits: readonly LineEdit[],
  totalLines: number,
): string[] {
  const merged = base.slice(0, totalLines);
  while (merged.length < totalLines) merged.push('');
  for (const edit of edits) {
    if (edit.index >= 0 && edit.index < totalLines) merged[edit.index] = edit.translation;
  }
  return merged;
}

/**
 * Fold the server's authoritative merged cache back into the draft after a
 * save.
 *
 * A line is adopted when the user has not typed into it since the request went
 * out (`previous[i] === submitted[i]`) — that covers both the lines this save
 * persisted (trimmed by the server) and the lines another session wrote while
 * the save was in flight. Lines the user is actively editing keep their value
 * and stay dirty.
 */
export function reconcileDraft(
  previous: readonly string[],
  submitted: readonly string[],
  merged: readonly string[],
): string[] {
  return previous.map((value, i) => {
    if (i >= merged.length) return value;
    return value === (submitted[i] ?? '') ? merged[i] : value;
  });
}

/**
 * How many lines the save picked up from another session — i.e. lines this
 * request did not edit whose stored value changed while the editor was open.
 * Used to tell the user "saved, and N lines written elsewhere came along"
 * instead of leaving the sync invisible.
 */
export function countAdoptedLines(
  baseline: readonly string[],
  edits: readonly LineEdit[],
  merged: readonly string[],
): number {
  const edited = new Set(edits.map((edit) => edit.index));
  let count = 0;
  for (let i = 0; i < merged.length; i += 1) {
    if (edited.has(i)) continue;
    if (merged[i] !== (baseline[i] ?? '')) count += 1;
  }
  return count;
}
