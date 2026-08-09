/**
 * Pure helpers for the unsaved-changes navigation guard.
 *
 * The guard itself lives in src/hooks/useUnsavedChangesGuard.tsx; this module
 * keeps the side-effect-free pieces here so they can be unit-tested without
 * a DOM.
 */

/** True when `href` points at the same origin as `base` (an in-app navigation). */
export function isSameOriginHref(href: string, base: string): boolean {
  try {
    return new URL(href, base).origin === new URL(base).origin;
  } catch {
    return false;
  }
}
