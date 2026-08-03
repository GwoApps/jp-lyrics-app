'use client';

import { CheckCircle2, CircleAlert, Sparkles } from 'lucide-react';
import type { CSSProperties, MouseEventHandler } from 'react';

export type ToastType = 'success' | 'error' | 'info';

interface ToastProps {
  type: ToastType;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
  style?: CSSProperties;
  onClick?: MouseEventHandler<HTMLDivElement>;
}

export default function Toast({ type, message, actionLabel, onAction, className = '', style, onClick }: ToastProps) {
  const Icon = type === 'success' ? CheckCircle2 : type === 'error' ? CircleAlert : Sparkles;

  return (
    <div
      role="alert"
      aria-live={type === 'error' ? 'assertive' : 'polite'}
      className={`toast toast-${type}${actionLabel ? ' toast--with-action' : ''}${className ? ` ${className}` : ''}`}
      style={style}
      onClick={onClick}
    >
      <Icon className="toast-icon" aria-hidden="true" />
      <div className="toast-description">{message}</div>
      {actionLabel && onAction && (
        <button
          type="button"
          className="toast-action"
          onClick={(e) => {
            e.stopPropagation();
            onAction();
          }}
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
