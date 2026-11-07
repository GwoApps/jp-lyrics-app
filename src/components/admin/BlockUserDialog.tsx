'use client';

import { useRef } from 'react';
import Dialog from '@/components/ui/dialog';
import { useI18n } from '@/lib/i18n';
import type { AdminUser } from './admin-types';

interface BlockUserDialogProps {
  target: AdminUser | null;
  reason: string;
  onReasonChange: (reason: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Block / unblock dialog with an optional reason input when blocking. */
export default function BlockUserDialog({ target, reason, onReasonChange, onConfirm, onCancel }: BlockUserDialogProps) {
  const { t } = useI18n();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const title = target
    ? `${target.is_blocked === 1 ? t('admin.unblock') : t('admin.block')} ${target.display_name || target.id}`
    : '';

  return (
    <Dialog open={!!target} onClose={onCancel} title={title} className="confirm-dialog" initialFocusRef={cancelRef}>
      {target && <>
        <div className="confirm-dialog-icon">{target.is_blocked === 1 ? '✅' : '🚫'}</div>
        <div className="confirm-dialog-title">
          {target.is_blocked === 1 ? t('admin.unblock') : t('admin.block')}
          {' '}{target.display_name || target.id}
        </div>
        {target.is_blocked === 0 && (
          <div className="mt-3">
            <input
              type="text"
              value={reason}
              onChange={(e) => onReasonChange(e.target.value)}
              placeholder={t('admin.blockReason')}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-xs outline-none focus:border-[var(--primary)] transition-colors"
            />
          </div>
        )}
        <div className="confirm-dialog-actions">
          <button ref={cancelRef} className="confirm-dialog-btn confirm-dialog-btn--cancel" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button
            className={`confirm-dialog-btn ${target.is_blocked === 1 ? 'confirm-dialog-btn--confirm' : 'confirm-dialog-btn--danger'}`}
            onClick={onConfirm}
          >
            {target.is_blocked === 1 ? t('admin.unblock') : t('admin.block')}
          </button>
        </div>
      </>}
    </Dialog>
  );
}
