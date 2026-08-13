/**
 * Pure helpers that power the ConfirmDialog modal's focus management.
 *
 * The DOM-querying helpers (getFocusableElements, computeFocusBounds) are used
 * by the React component; the navigation helpers (nextFocusTarget) are kept
 * DOM-agnostic so they can be unit tested with node:test (matching the rest of
 * the codebase).
 */

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(', ');

/**
 * Collect focusable elements inside a container, honouring negative tabindex.
 * Returns an empty array when nothing is focusable.
 */
export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const candidates = Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  );
  return candidates.filter((el) => {
    const tabindex = el.getAttribute('tabindex');
    // Elements with tabindex="-1" are reachable programmatically but not by Tab.
    if (tabindex !== null && Number(tabindex) < 0) return false;
    return !isHidden(el);
  });
}

function isHidden(el: HTMLElement): boolean {
  if (el.hidden) return true;
  const style = el.style;
  return (
    style.display === 'none' ||
    style.visibility === 'hidden' ||
    (style.pointerEvents === 'none' && el.getAttribute('aria-hidden') === 'true')
  );
}

/** Compute the first/last focusable element, or null when none exist. */
export function computeFocusBounds(
  container: HTMLElement,
): { first: HTMLElement; last: HTMLElement } | null {
  const elements = getFocusableElements(container);
  if (elements.length === 0) return null;
  return { first: elements[0], last: elements[elements.length - 1] };
}

/**
 * Compute the next focus target within an ordered list of focusable elements,
 * wrapping at both ends. `current` may be an object not present in `elements`
 * (e.g. focus parked on the container), in which case the traversal jumps to
 * the natural end. Returns null when the list is empty.
 */
export function nextFocusTarget<T>(
  elements: readonly T[],
  current: T | null,
  reverse: boolean,
): T | null {
  if (elements.length === 0) return null;

  const index = elements.indexOf(current as T);
  if (index === -1) {
    return reverse ? elements[elements.length - 1] : elements[0];
  }

  if (reverse) {
    return elements[(index - 1 + elements.length) % elements.length];
  }
  return elements[(index + 1) % elements.length];
}
