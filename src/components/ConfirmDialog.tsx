'use client';

import { Fragment, useRef, type ReactNode } from 'react';
import ArtistLinks from '@/components/ArtistLinks';
import Dialog from '@/components/ui/dialog';

/** Interpolate this marker instead of an artist into localized dialog text. */
export const ARTIST_LINK_MARKER = '\uFFF0artist\uFFF1';

export function artistLinkedDialogBody(text: string, artist?: string | null): ReactNode {
  return text.split(ARTIST_LINK_MARKER).map((part, index) => (
    <Fragment key={index}>
      {index > 0 && <ArtistLinks artist={artist} />}
      {part}
    </Fragment>
  ));
}

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body?: ReactNode;
  /** Optional extra content rendered below the body (e.g. a lyric preview). */
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  variant?: 'danger' | 'default';
  alert?: boolean;
  /** Focus this element (by class) first. Defaults to Cancel for danger, Confirm otherwise. */
  initialFocus?: 'cancel' | 'confirm';
  /** The confirm action is in flight: the dialog stays open, both actions are
   *  inert and the confirm button shows a spinner so it cannot be fired twice. */
  pending?: boolean;
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
  pending = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const focusCancel = initialFocus === 'cancel'
    || (initialFocus !== 'confirm' && variant === 'danger' && !alert);

  return (
    // A pending operation must stay visible: outside/Escape dismissal would
    // hide the failure reason that is about to replace the dialog body.
    <Dialog open={open} onClose={alert ? onConfirm : onCancel} title={title}
      className="confirm-dialog" data-confirm-dialog="" dismissible={!pending}
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
              disabled={pending}
              onClick={onCancel}
            >
              {cancelLabel}
            </button>
          )}
          <button
            ref={confirmRef}
            className={`confirm-dialog-btn ${variant === 'danger' ? 'confirm-dialog-btn--danger' : 'confirm-dialog-btn--confirm'}`}
            disabled={pending}
            aria-busy={pending || undefined}
            onClick={onConfirm}
          >
            {pending && <span className="confirm-dialog-spinner" aria-hidden="true" />}
            {confirmLabel}
          </button>
        </div>
    </Dialog>
  );
}
