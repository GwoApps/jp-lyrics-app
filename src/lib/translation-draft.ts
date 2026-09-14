/**
 * Draft merge helpers for the translation editor's two AI entry points.
 *
 * Both「AI 补全缺失行」(batch slices over the blank lines) and「重新翻译此行」
 * (single-line re-translation of the focused line) merge model output back into
 * the in-memory draft, and both must obey the SAME protection rules — otherwise
 * one entry point silently destroys work the other one protects (issue #269,
 * a leftover of the #160 fix that only patched the batch path):
 *
 *  - **A blank model value never replaces an existing translation.** A model
 *    that skips a line, a slice whose items normalize to `''` after trim, or a
 *    degraded-but-2xx response would otherwise overwrite a non-empty draft line
 *    with an empty string, turning a translated line back into an untranslated
 *    one with no way to tell what it used to say.
 *  - **「AI 补全缺失行」never touches a line that already has content.** Manual
 *    edits typed while earlier slices were still in flight must survive, and a
 *    line that received an AI translation in a previous run must not be
 *    re-rolled by a later batch.
 *
 * Only the WRITE decision lives here; the per-entry-point UI feedback (which
 * toast to show) stays in the page and is decided from the model response.
 */

export interface SliceMergeOptions {
  /**
   * `true` for「AI 补全缺失行」— lines that already have non-blank content are
   * left untouched. `false` for「重新翻译此行」— the target line is replaced, but
   * still only by a non-blank value.
   */
  onlyFillBlank: boolean;
}

/** Whether a model value counts as a real translation (non-blank after trim). */
export function isTranslated(value: string | undefined | null): boolean {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * Merge one translated slice — `translations[i]` belongs to
 * `draft[start + i]` — into `draft` and return the new array.
 *
 * The input array is never mutated (the caller keeps its previous draft for the
 * React state update). Indices outside the draft are ignored, so a model that
 * returns more items than asked for can never append phantom lines.
 */
export function mergeTranslatedSlice(
  draft: readonly string[],
  start: number,
  translations: readonly string[],
  { onlyFillBlank }: SliceMergeOptions,
): string[] {
  const next = draft.slice();
  translations.forEach((value, i) => {
    const index = start + i;
    if (index < 0 || index >= next.length) return;
    // Blank output is never written: keep whatever the line already shows.
    if (!isTranslated(value)) return;
    //「补全缺失行」only fills holes — it never overwrites existing content.
    if (onlyFillBlank && isTranslated(next[index])) return;
    next[index] = value;
  });
  return next;
}

/**
 * Whether「重新翻译此行」should ask for confirmation before running.
 *
 * A re-translation replaces the line, which is the button's intent — but when
 * the line already holds a translation (possibly typed by hand) an accidental
 * click silently discards it, and the draft's 放弃 exits are the only way back.
 */
export function shouldConfirmRetranslate(currentTranslation: string | undefined | null): boolean {
  return isTranslated(currentTranslation);
}
