'use client';

import { useRef, type ReactNode } from 'react';
import Dialog from '@/components/ui/dialog';

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
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const focusCancel = initialFocus === 'cancel'
    || (initialFocus !== 'confirm' && variant === 'danger' && !alert);

  return (
    <Dialog open={open} onClose={alert ? onConfirm : onCancel} title={title}
      className="confirm-dialog" data-confirm-dialog=""
      initialFocusRef={focusCancel ? cancelRef : confirmRef}>
        <div className="confirm-dialog-icon">{variant === 'danger' ? '🗑️' : '⚠️'}</div>
        <div className="confirm-dialog-title">{title}</div>
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
    </Dialog>
  );
}
