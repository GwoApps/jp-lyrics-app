'use client';

import { useEffect, useId, useRef } from 'react';
import {
  computeFocusBounds,
  getFocusableElements,
  nextFocusTarget,
} from '@/lib/focus-trap';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body?: string;
  confirmLabel: string;
  cancelLabel?: string;
  variant?: 'danger' | 'default';
  alert?: boolean;
  /** Focus this element (by class) first. Defaults to Cancel for danger, Confirm otherwise. */
  initialFocus?: 'cancel' | 'confirm';
  onConfirm: () => void;
  onCancel?: () => void;
}

const RESTORE_ATTR = 'data-confirm-restore-focus';

/**
 * Capture the currently focused element so it can be restored on close.
 * Only records the first element that opened the dialog (not later Tab moves).
 */
function captureTrigger(): HTMLElement | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return null;
  // Skip elements inside the dialog itself (e.g. nested re-open).
  if (active.closest('[role="dialog"]')) return null;
  return active;
}

/** Ancestors of the dialog, excluding <html> and <body>. */
function ancestorChain(el: HTMLElement): HTMLElement[] {
  const chain: HTMLElement[] = [];
  let node = el.parentElement;
  while (node && node !== document.documentElement && node !== document.body) {
    chain.push(node);
    node = node.parentElement;
  }
  return chain;
}

function focusElement(el: HTMLElement | null): void {
  if (el && typeof el.focus === 'function') {
    el.focus({ preventScroll: true });
  }
}

function handleTab(
  event: KeyboardEvent,
  dialog: HTMLElement | null,
): void {
  if (!dialog) return;
  const bounds = computeFocusBounds(dialog);
  if (!bounds) {
    // Nothing focusable inside; keep focus on the dialog container itself.
    event.preventDefault();
    dialog.focus({ preventScroll: true });
    return;
  }
  const current = document.activeElement;
  const reverse = event.shiftKey;
  // Escaping the first/last element should wrap, otherwise let the browser cycle.
  const atBoundary =
    !(current instanceof HTMLElement) ||
    !dialog.contains(current) ||
    current === (reverse ? bounds.first : bounds.last);
  if (atBoundary) {
    event.preventDefault();
    focusElement(reverse ? bounds.last : bounds.first);
  } else {
    const next = nextFocusTarget(
      getFocusableElements(dialog),
      current as HTMLElement,
      reverse,
    );
    if (next) {
      event.preventDefault();
      focusElement(next);
    }
  }
}

export default function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  variant = 'default',
  alert = false,
  initialFocus,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const dialogEl = dialogRef.current;

    // 1) Record the trigger so we can restore focus after close.
    const trigger = captureTrigger();
    const previouslyInert: Element[] = [];
    const previousBodyOverflow = document.body.style.overflow;
    const previousDialogTabIndex = dialogEl?.getAttribute('tabindex') ?? null;

    // 2) Decide which button receives initial focus.
    const wantCancel =
      (initialFocus === 'cancel') ||
      (initialFocus !== 'confirm' && variant === 'danger' && !alert);
    focusElement(wantCancel ? cancelRef.current : confirmRef.current);

    // If no buttons are focusable, make the dialog container itself focusable.
    if (dialogEl && getFocusableElements(dialogEl).length === 0) {
      dialogEl.setAttribute('tabindex', '-1');
      dialogEl.focus({ preventScroll: true });
    }

    // 3) Isolate background content by marking every sibling of the dialog's
    //    ancestor chain inert, and lock body scrolling. Falls back to inert
    //    on major landmarks when the dialog is not deeply nested.
    if (dialogEl && typeof (dialogEl as HTMLElement).inert === 'boolean') {
      const chain = ancestorChain(dialogEl);
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

    // 4) Trap Tab / Shift+Tab within the dialog.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Tab') {
        handleTab(event, dialogEl);
        return;
      }
      if (event.key !== 'Escape') return;
      if (alert) onConfirm();
      else onCancel?.();
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
      focusElement(trigger);
    };
  }, [alert, onCancel, onConfirm, open, initialFocus, variant]);

  if (!open) return null;

  const handleOverlayClick = () => {
    if (alert) onConfirm();
    else onCancel?.();
  };

  return (
    <div className="confirm-overlay" onClick={handleOverlayClick}>
      <div
        className="confirm-dialog"
        data-confirm-dialog=""
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="confirm-dialog-icon">{variant === 'danger' ? '🗑️' : '⚠️'}</div>
        <div id={titleId} className="confirm-dialog-title">{title}</div>
        {body && (
          <div className="confirm-dialog-body">
            <p>{body}</p>
          </div>
        )}
        <div className="confirm-dialog-actions">
          {!alert && (
            <button
              ref={cancelRef}
              className="confirm-dialog-btn confirm-dialog-btn--cancel"
              onClick={onCancel}
            >
              {cancelLabel}
            </button>
          )}
          <button
            ref={confirmRef}
            className={`confirm-dialog-btn ${variant === 'danger' ? 'confirm-dialog-btn--danger' : 'confirm-dialog-btn--confirm'}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
