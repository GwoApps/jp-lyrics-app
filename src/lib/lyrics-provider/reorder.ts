/**
 * Pure validation helper for provider reordering (ISSUE #148).
 *
 * Kept free of any DB dependency so the admin reorder flow and its unit tests
 * can validate a candidate ordered id set without instantiating a Drizzle
 * connection. `reorderProviders` (in config.ts) enforces this before batching.
 */

/**
 * Assert that `orderedIds` covers every stored provider id exactly once.
 *
 * Rejects:
 *  - duplicates (same id listed more than once),
 *  - unknown ids (not present in the stored set),
 *  - partial sets (not every stored id appears).
 *
 * Throws on a mismatch so a caller can never leave duplicated / drifting
 * priorities behind.
 */
export function assertFullOrderedSet(storedIds: string[], orderedIds: string[]): void {
  const storedSet = new Set(storedIds);
  const requestedSet = new Set(orderedIds);
  if (
    requestedSet.size !== orderedIds.length
    || storedSet.size !== requestedSet.size
    || [...requestedSet].some((id) => !storedSet.has(id))
  ) {
    throw new Error('ordered_ids must contain every provider id exactly once');
  }
}
