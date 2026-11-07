/**
 * Distance from the active lyric in *timed-row* order, not raw row indices.
 * Empty or untimed rows render no time label and must not consume a ±1/±2
 * context slot. Null means either this row has no timestamp or there is no
 * timed active row to anchor the window.
 */
export function timedRowDistances(
  timestamps: (number | null)[],
  activeLine: number,
): (number | null)[] {
  let rank = 0;
  const ranks = timestamps.map((time) => time == null ? null : rank++);
  const activeRank = ranks[activeLine];
  return ranks.map((rowRank) => rowRank == null || activeRank == null
    ? null
    : Math.abs(rowRank - activeRank));
}
