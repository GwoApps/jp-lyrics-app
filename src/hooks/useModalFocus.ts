'use client';

import { useEffect, type RefObject } from 'react';
import {
  computeFocusBounds,
  getFocusableElements,
  nextFocusTarget,
} from '@/lib/focus-trap';

/** Marker attribute used to remember which elements were made inert. */
const RESTORE_ATTR = 'data-modal-restore-focus';

interface UseModalFocusOptions<T extends HTMLElement = HTMLElement> {
  /** Whether the dialog is currently open. When false the hook is a no-op. */
  open: boolean;
  /** Ref to the dialog container (the element with role="dialog"). */
  dialogRef: RefObject<T | null>;
  /** Optional element to receive initial focus. Falls back to the first focusable element. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Called when Escape is pressed. */
  onEscape?: () => void;
}

/**
 * Shared modal focus management for custom (hand-rolled) dialogs.
 *
 * While `open`, this hook:
 *  1. Records the triggering element so focus can be restored on close.
 *  2. Moves focus into the dialog (to `initialFocusRef`, or the first focusable
 *     element, or the container itself when nothing is focusable).
 *  3. Marks every background sibling `inert` and locks body scrolling so
 *     keyboard and assistive-tech users cannot reach the page behind the modal.
 *  4. Traps Tab / Shift+Tab inside the dialog.
 *  5. On close, removes the inert markers, restores scrolling, and returns
 *     focus to the trigger.
 *
 * Escape handling is left to the caller via `onEscape` so dialogs can decide
 * whether to dismiss or confirm.
 */
export function useModalFocus<T extends HTMLElement>({
  open,
  dialogRef,
  initialFocusRef,
  onEscape,
}: UseModalFocusOptions<T>): void {
  useEffect(() => {
    if (!open) return;

    const dialogEl = dialogRef.current;

    // 1) Record the element that opened the dialog for focus restore.
    const active = document.activeElement;
    let trigger: HTMLElement | null = null;
    if (active instanceof HTMLElement && !active.closest('[role="dialog"]')) {
      trigger = active;
    }

    const previouslyInert: Element[] = [];
    const previousBodyOverflow = document.body.style.overflow;
    const previousDialogTabIndex = dialogEl?.getAttribute('tabindex') ?? null;

    // 2) Move focus into the dialog.
    const focusTarget = initialFocusRef?.current
      ?? (dialogEl && getFocusableElements(dialogEl)[0]);
    if (focusTarget) {
      focusTarget.focus({ preventScroll: true });
    } else if (dialogEl) {
      // Nothing focusable: make the container itself focusable and park focus.
      dialogEl.setAttribute('tabindex', '-1');
      dialogEl.focus({ preventScroll: true });
    }

    // 3) Isolate background content by marking every sibling of the dialog's
    //    ancestor chain inert, and lock body scrolling. Falls back to inert
    //    on major landmarks when the dialog is not deeply nested.
    if (dialogEl && typeof (dialogEl as HTMLElement).inert === 'boolean') {
      const chain: HTMLElement[] = [];
      let node = dialogEl.parentElement;
      while (node && node !== document.documentElement && node !== document.body) {
        chain.push(node);
        node = node.parentElement;
      }
      if (chain.length > 0) {
        chain.forEach((ancestor) => {
          Array.from(ancestor.children).forEach((child) => {
            if (child === dialogEl || child.contains(dialogEl)) return;
            if (child instanceof HTMLElement) {
              child.setAttribute('inert', '');
              child.setAttribute(RESTORE_ATTR, '1');
              previouslyInert.push(child);
            }
          });
        });
      } else {
        document.body.querySelectorAll<HTMLElement>(
          'header, nav, main, footer, aside',
        ).forEach((el) => {
          if (el.contains(dialogEl)) return;
          el.setAttribute('inert', '');
          el.setAttribute(RESTORE_ATTR, '1');
          previouslyInert.push(el);
        });
      }
    }
    document.body.style.overflow = 'hidden';

    // 4) Trap Tab / Shift+Tab within the dialog and route Escape.
    const handleTab = (event: KeyboardEvent) => {
      if (!dialogEl) return;
      const bounds = computeFocusBounds(dialogEl);
      if (!bounds) {
        // Nothing focusable inside; keep focus on the dialog container itself.
        event.preventDefault();
        dialogEl.focus({ preventScroll: true });
        return;
      }
      const current = document.activeElement;
      const reverse = event.shiftKey;
      const atBoundary =
        !(current instanceof HTMLElement) ||
        !dialogEl.contains(current) ||
        current === (reverse ? bounds.last : bounds.first);
      const focus = (el: HTMLElement | null) => {
        if (el) el.focus({ preventScroll: true });
      };
      if (atBoundary) {
        event.preventDefault();
        focus(reverse ? bounds.last : bounds.first);
      } else {
        const next = nextFocusTarget(
          getFocusableElements(dialogEl),
          current as HTMLElement,
          reverse,
        );
        if (next) {
          event.preventDefault();
          focus(next);
        }
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Tab') {
        handleTab(event);
        return;
      }
      if (event.key === 'Escape') onEscape?.();
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);

      // Restore body scroll.
      document.body.style.overflow = previousBodyOverflow;

      // Remove inert markers and restore original attributes.
      previouslyInert.forEach((el) => {
        el.removeAttribute('inert');
        el.removeAttribute(RESTORE_ATTR);
      });

      // Restore dialog container's tabindex.
      if (dialogEl && previousDialogTabIndex === null) {
        dialogEl.removeAttribute('tabindex');
      } else if (dialogEl && previousDialogTabIndex !== null) {
        dialogEl.setAttribute('tabindex', previousDialogTabIndex);
      }

      // 5) Return focus to the element that opened the dialog.
      if (trigger) trigger.focus({ preventScroll: true });
    };
  }, [open, dialogRef, initialFocusRef, onEscape]);
}
