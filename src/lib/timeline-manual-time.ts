import { parseLrcTimestamp } from '@/lib/lrc';

/** Minimal translation function signature compatible with useI18n().t. */
export type TranslateFn = (
  key: string,
  vars?: Record<string, string | number>,
) => string;

/**
 * Dictionary key of the shared inline error shown by both manual timestamp
 * entry points of the timeline editor (the sticky current-line card and the
 * per-row timestamp input of issue #297).
 */
export const INVALID_TIME_FORMAT_KEY = 'timelineWorkspace.invalidTimeFormat';

/**
 * Translation key for an unparseable manual timestamp, or `null` when the
 * value parses. Both entry points share this check so they can never disagree
 * about which input is accepted, and so neither of them silently drops or
 * reverts an invalid value again.
 */
export function manualTimeErrorKey(value: string): string | null {
  return parseLrcTimestamp(value) == null ? INVALID_TIME_FORMAT_KEY : null;
}

/** Translated inline error for `value`, or `null` when it parses. */
export function manualTimeError(value: string, t: TranslateFn): string | null {
  const key = manualTimeErrorKey(value);
  return key == null ? null : t(key);
}
