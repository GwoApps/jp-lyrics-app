'use client';

import { useEffect, useId, useRef } from 'react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body?: string;
  confirmLabel: string;
  cancelLabel?: string;
  variant?: 'danger' | 'default';
  alert?: boolean;
  onConfirm: () => void;
  onCancel?: () => void;
}

export default function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  variant = 'default',
  alert = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (alert) onConfirm();
      else onCancel?.();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [alert, onCancel, onConfirm, open]);

  if (!open) return null;

  const handleOverlayClick = () => {
    if (alert) onConfirm();
    else onCancel?.();
  };

  return (
    <div className="confirm-overlay" onClick={handleOverlayClick}>
      <div
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
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
            <button className="confirm-dialog-btn confirm-dialog-btn--cancel" onClick={onCancel}>
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
