/**
 * Diff payload. A field can also be explicitly `null`, which is how a cleared
 * optional value (e.g. `error` after a recovered upstream) survives JSON
 * serialisation — `undefined` would simply be dropped, leaving the client stuck
 * on the stale value.
 */
export type SseDiff<T> = { [K in keyof Partial<T>]: Partial<T>[K] | null };

export interface SseDiffEnvelope<T> {
  seq: number;
  c: number;
  d: SseDiff<T>;
  v?: number;
  _full?: boolean;
}

/** Build a versioned SSE envelope; full refreshes must carry the complete state in d. */
export function buildSsePayload<T extends object>(
  fullData: T,
  diff: SseDiffEnvelope<T>,
  wantFull: boolean,
): SseDiffEnvelope<T> {
  return wantFull
    ? { ...diff, v: 2, d: fullData, _full: true }
    : { ...diff, v: 2 };
}
