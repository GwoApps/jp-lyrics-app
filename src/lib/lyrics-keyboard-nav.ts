/** Keyboard line navigation shared by normal and immersive reading views. */

/** The lyric row is driven through its container: one Tab stop, one aria-current. */
export const NATIVE_SCROLL_KEYS = new Set([
  'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ',
]);

/** Modifiers and IME composition belong to the browser or the current input. */
export function isLineNavigationShortcut(key: string): boolean {
  return key === 'j' || key === 'k' || key === 'J' || key === 'K';
}

/** Enter and Space are the copy activation keys, but Space still scrolls natively. */
export function isLineCopyShortcut(key: string): boolean {
  return key === 'Enter';
}

/** Whether a key event originated from a field/control that consumes typing. */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (target as HTMLInputElement).type;
    return type !== 'checkbox' && type !== 'radio' && type !== 'button' && type !== 'submit';
  }
  return false;
}

/** Whether a layer above the reading view owns the key (dialog/menu/input). */
export function readingViewOwnsKey(target: EventTarget | null): boolean {
  if (isTextEntryTarget(target)) return true;
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false;
  return !!target.closest(
    '[role="dialog"], [role="menu"], [role="listbox"], [role="grid"], [role="tree"], [data-state="open"]',
  );
}

/** Clamp an index to a valid lyric row, or -1 when there are no rows. */
export function clampLineIndex(index: number, lineCount: number): number {
  if (lineCount <= 0) return -1;
  return Math.max(0, Math.min(index, lineCount - 1));
}
