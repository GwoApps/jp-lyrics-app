'use client';

import { CheckCircle2, CircleAlert } from 'lucide-react';
import type { CSSProperties, MouseEventHandler } from 'react';

export type ToastType = 'success' | 'error';

interface ToastProps {
  type: ToastType;
  message: string;
  className?: string;
  style?: CSSProperties;
  onClick?: MouseEventHandler<HTMLDivElement>;
}

export default function Toast({ type, message, className = '', style, onClick }: ToastProps) {
  const Icon = type === 'success' ? CheckCircle2 : CircleAlert;

  return (
    <div
      role="alert"
      aria-live={type === 'error' ? 'assertive' : 'polite'}
      className={`toast toast-${type}${className ? ` ${className}` : ''}`}
      style={style}
      onClick={onClick}
    >
      <Icon className="toast-icon" aria-hidden="true" />
      <div className="toast-description">{message}</div>
    </div>
  );
}
