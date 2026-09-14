/** Minimal translation function signature compatible with useI18n().t. */
export type TranslateFn = (
  key: string,
  vars?: Record<string, string | number>,
) => string;

/**
 * DOM id of the source-lyrics cell that labels the translation input of the
 * line at `index`. Used with `aria-labelledby` so screen readers announce the
 * original line of the row currently being edited (issue #276).
 */
export function translationSourceLineId(index: number): string {
  return `tl-source-${index}`;
}

/** DOM id of the translation input of the line at `index`. */
export function translationLineInputId(index: number): string {
  return `tl-input-${index}`;
}

/**
 * Accessible name of the translation input of the line at `index`. Prefixes the
 * translated-column name with the 1-based line number so keyboard and
 * screen-reader users can tell the dozens of otherwise identically named inputs
 * apart, including the disabled inputs of empty lines.
 */
export function translationLineLabel(
  index: number,
  columnLabel: string,
): string {
  return `${index + 1}. ${columnLabel}`;
}
