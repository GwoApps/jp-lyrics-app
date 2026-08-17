'use client';

import { useId, useRef, type ReactNode } from 'react';
import { useModalFocus } from '@/hooks/useModalFocus';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body?: string;
  /** Optional extra content rendered below the body (e.g. a lyric preview). */
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  variant?: 'danger' | 'default';
  alert?: boolean;
  /** Focus this element (by class) first. Defaults to Cancel for danger, Confirm otherwise. */
  initialFocus?: 'cancel' | 'confirm';
  onConfirm: () => void;
  onCancel?: () => void;
}

export default function ConfirmDialog({
  open,
  title,
  body,
  children,
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

  // Escape dismisses for non-alert dialogs, confirms (fire-and-forget) for
  // alerts — mirroring the overlay click behaviour below.
  useModalFocus({
    open,
    dialogRef,
    initialFocusRef:
      (initialFocus === 'cancel') ||
      (initialFocus !== 'confirm' && variant === 'danger' && !alert)
        ? cancelRef
        : confirmRef,
    onEscape: alert ? onConfirm : onCancel,
  });

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
        {children && <div className="confirm-dialog-children">{children}</div>}
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
