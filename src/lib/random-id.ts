/** Stable random id for UI keys and audit rows, safe on http and older browsers. */
export function randomId(prefix = ''): string {
  const c = globalThis.crypto as Crypto | undefined;
  const uuid = c && typeof c.randomUUID === 'function' ? c.randomUUID() : null;
  return `${prefix}${uuid ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`}`;
}
