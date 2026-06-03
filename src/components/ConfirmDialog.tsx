'use client';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'default';
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = '確認',
  cancelLabel = 'キャンセル',
  variant = 'default',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) return null;

  return (
    <div className="confirm-overlay" onClick={onCancel}>
      <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="confirm-dialog-icon">{variant === 'danger' ? '🗑️' : '⚠️'}</div>
        <div className="confirm-dialog-title">{title}</div>
        {body && (
          <div className="confirm-dialog-body">
            <p>{body}</p>
          </div>
        )}
        <div className="confirm-dialog-actions">
          <button className="confirm-dialog-btn confirm-dialog-btn--cancel" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
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
