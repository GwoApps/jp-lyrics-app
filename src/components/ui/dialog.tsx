'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import './dialog.css';

interface DialogProps extends Omit<React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>, 'children' | 'title'> {
  open: boolean;
  onClose?: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  overlayClassName?: string;
  overlayOpacity?: number;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  /** Prevent outside/Escape dismissal while an operation must remain visible. */
  dismissible?: boolean;
}

/**
 * Shared modal lifecycle. Radix Presence observes the closing CSS animation;
 * keeping the last open content also preserves target-based dialogs during exit.
 * Callers keep this component mounted and control `open`, not `{open && …}`.
 */
const Dialog = React.forwardRef<HTMLDivElement, DialogProps>(function Dialog({
  open, onClose, title, children, className = '', overlayClassName = '', overlayOpacity = .45, style,
  initialFocusRef, dismissible = true, onOpenAutoFocus, onCloseAutoFocus, onEscapeKeyDown,
  onPointerDownOutside, ...props
}, ref) {
  const restoreFocusRef = React.useRef<HTMLElement | null>(null);
  const [snapshot, setSnapshot] = React.useState({ children, title });
  if (open && (snapshot.children !== children || snapshot.title !== title)) {
    setSnapshot({ children, title });
  }
  const visible = open ? { children, title } : snapshot;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => { if (!next && dismissible) onClose?.(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={`ui-dialog-overlay ${overlayClassName}`}
          style={{ backgroundColor: `rgb(0 0 0 / ${overlayOpacity})` }} />
        <DialogPrimitive.Content
          {...props}
          ref={ref}
          className={`ui-dialog-content ${className}`}
          style={{ width: 'calc(100vw - 2rem)', ...style }}
          aria-describedby={props['aria-describedby']}
          onOpenAutoFocus={(event) => {
            const active = document.activeElement;
            const menuLabel = active instanceof HTMLElement
              ? active.closest('[role="menu"]')?.getAttribute('aria-labelledby') : null;
            const menuTrigger = menuLabel ? document.getElementById(menuLabel) : null;
            restoreFocusRef.current = menuTrigger ?? (active instanceof HTMLElement ? active : null);
            onOpenAutoFocus?.(event);
            if (!event.defaultPrevented && initialFocusRef?.current) {
              event.preventDefault();
              initialFocusRef.current.focus({ preventScroll: true });
            }
          }}
          onCloseAutoFocus={(event) => {
            if (!open) setSnapshot({ children: null, title: null });
            onCloseAutoFocus?.(event);
            if (event.defaultPrevented) return;
            // Controlled callers do not render Radix Trigger. Restore the real
            // opener (or a menu's trigger), not a now-unmounted menu item.
            event.preventDefault();
            const target = restoreFocusRef.current;
            if (target?.isConnected && !target.closest('[inert]')) target.focus({ preventScroll: true });
          }}
          onEscapeKeyDown={(event) => {
            onEscapeKeyDown?.(event);
            if (!dismissible) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            onPointerDownOutside?.(event);
            if (!dismissible) event.preventDefault();
          }}
        >
          <DialogPrimitive.Title className="sr-only">{visible.title}</DialogPrimitive.Title>
          {visible.children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
});

export default Dialog;
