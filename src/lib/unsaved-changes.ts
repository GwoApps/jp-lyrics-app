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

/**
 * Options describing a click on a potential in-app link.
 *
 * Mirrors the fields the guard's capture-phase document listener inspects so
 * the interception decision can be unit-tested without a DOM.
 */
export interface LinkClickDecision {
  /** The link's href attribute, or null when the click wasn't on a link. */
  href: string | null;
  /** The current document URL, used to resolve same-origin links. */
  base: string;
  /** True when another handler already called preventDefault. */
  defaultPrevented: boolean;
  /** The MouseEvent.button value (0 == primary left button). */
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  /** True when the anchor has a `download` attribute. */
  hasDownload: boolean;
  /** True when the anchor targets a new tab/window. */
  targetBlank: boolean;
}

/**
 * True when a click should be intercepted by the unsaved-changes guard so it
 * can be confirmed before an in-app client navigation starts.
 *
 * Plain primary clicks on same-origin in-app links are intercepted; modifier
 * clicks (new tab), fragment links, downloads and external anchors pass
 * through untouched.
 */
export function shouldInterceptLinkClick(decision: LinkClickDecision): boolean {
  if (decision.defaultPrevented) return false;
  if (decision.button !== 0
    || decision.metaKey || decision.ctrlKey
    || decision.shiftKey || decision.altKey) return false;
  const href = decision.href;
  if (!href || href.startsWith('#') || decision.hasDownload || decision.targetBlank) return false;
  return isSameOriginHref(href, decision.base);
}
