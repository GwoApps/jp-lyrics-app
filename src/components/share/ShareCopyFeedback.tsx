'use client';

import type { ReactNode } from 'react';
import { Check } from 'lucide-react';

interface ShareCopyFeedbackProps {
  copied: boolean;
  label: string;
  copiedLabel: string;
  icon: ReactNode;
}

/** Both labels stay mounted so success and reset can crossfade without resizing. */
export default function ShareCopyFeedback({ copied, label, copiedLabel, icon }: ShareCopyFeedbackProps) {
  return (
    <span className="share-copy-feedback" data-copied={copied}>
      <span className="share-copy-feedback__state share-copy-feedback__default" aria-hidden="true">
        {icon}
        <span>{label}</span>
      </span>
      <span className="share-copy-feedback__state share-copy-feedback__success" aria-hidden="true">
        <Check className="h-4 w-4" />
        <span>{copiedLabel}</span>
      </span>
      <span className="sr-only" aria-live="polite" aria-atomic="true">{copied ? copiedLabel : label}</span>
    </span>
  );
}
