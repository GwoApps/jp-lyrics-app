'use client';

import { Minus, Plus } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

interface OffsetControlsProps {
  offsetDraft: string;
  onOffsetDraftChange: (value: string) => void;
  onApply: (offsetMs: number) => void;
}

/** Quick ±offset buttons and a custom offset input for the timeline. */
export default function OffsetControls({ offsetDraft, onOffsetDraftChange, onApply }: OffsetControlsProps) {
  const { t } = useI18n();

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="text-xs font-medium text-[var(--muted-foreground)]">{t('timeline.offset')}</div>
      <div className="mt-3 grid grid-cols-4 gap-1.5">
        {[-500, -100, 100, 500].map((offset) => (
          <button key={offset} type="button" onClick={() => onApply(offset)} className="song-accent-button inline-flex h-8 min-w-0 items-center justify-center rounded-md px-1 text-[10px] tabular-nums">
            {offset > 0 ? <Plus className="mr-0.5 h-3 w-3 shrink-0" /> : <Minus className="mr-0.5 h-3 w-3 shrink-0" />}{Math.abs(offset)}ms
          </button>
        ))}
      </div>
      <div className="mt-2 flex min-w-0 items-center gap-1">
        <input type="number" step="10" value={offsetDraft} onChange={(event) => onOffsetDraftChange(event.target.value)} className="h-8 min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--input)] px-2 text-xs tabular-nums outline-none focus:border-[var(--song-accent)]" aria-label={t('timeline.customOffset')} />
        <button type="button" onClick={() => onApply(Number(offsetDraft))} className="song-accent-button h-8 shrink-0 rounded-md px-3 text-xs">{t('timeline.apply')}</button>
      </div>
    </div>
  );
}
