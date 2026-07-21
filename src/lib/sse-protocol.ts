export interface SseDiffEnvelope<T> {
  seq: number;
  c: number;
  d: Partial<T>;
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
