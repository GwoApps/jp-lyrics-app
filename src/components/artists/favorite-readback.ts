/** Reads remain on demand, but only the latest edit's response may settle each song. */
export function createFavoriteReadbackGate() {
  const revisions = new Map<string, number>();
  return {
    begin(songId: string) { const revision = (revisions.get(songId) ?? 0) + 1; revisions.set(songId, revision); return revision; },
    isCurrent(songId: string, revision: number) { return revisions.get(songId) === revision; },
  };
}
