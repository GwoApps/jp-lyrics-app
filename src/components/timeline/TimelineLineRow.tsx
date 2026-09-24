'use client';

import { useState } from 'react';
import { CheckCircle2, Circle, Eraser, Headphones } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { fmtMs, parseLrcTimestamp, type TimelineDraftLine } from '@/lib/lrc';
import { manualTimeError } from '@/lib/timeline-manual-time';

interface TimelineLineRowProps {
  line: TimelineDraftLine;
  index: number;
  selected: boolean;
  conflicted?: boolean;
  canSeek: boolean;
  /** Ref callback to register the row for scroll-into-view. */
  registerRow: (el: HTMLDivElement | null) => void;
  onSelect: () => void;
  onSetTime: (index: number, timeMs: number | null) => void;
  onClearTime: (index: number) => void;
  onSeek: (timeMs: number) => void;
}

/** One editable lyric row in the timeline list: status, timestamp, text, actions. */
export default function TimelineLineRow({
  line,
  index,
  selected,
  conflicted = false,
  canSeek,
  registerRow,
  onSelect,
  onSetTime,
  onClearTime,
  onSeek,
}: TimelineLineRowProps) {
  const { t } = useI18n();
  const [inlineError, setInlineError] = useState<string | null>(null);

  const rowCls = selected
    ? 'border-[var(--song-accent)] bg-[var(--song-accent)]/8'
    : conflicted
      ? 'border-[var(--destructive)]/40 bg-[var(--destructive)]/5 hover:bg-[var(--destructive)]/10'
      : 'border-transparent hover:bg-[var(--accent)]';

  return (
    <div ref={registerRow} onClick={onSelect} className={`mb-1 rounded-lg border px-2 py-2 transition-colors sm:px-3 ${rowCls}`}>
      <div className="grid cursor-pointer grid-cols-[28px_96px_minmax(0,1fr)_72px] items-center gap-2 sm:grid-cols-[32px_112px_minmax(0,1fr)_72px] sm:gap-3">
        <div className="flex justify-center">{line.timeMs == null ? <Circle className="h-4 w-4 text-[var(--muted-foreground)]/50" /> : <CheckCircle2 className="h-4 w-4 text-[var(--success)]" />}</div>
        <input key={`${index}-${line.timeMs ?? 'empty'}`} data-timeline-key-target="" defaultValue={line.timeMs == null ? '' : fmtMs(line.timeMs)} placeholder="--:--.---" onClick={(event) => event.stopPropagation()} onBlur={(event) => {
          const value = event.currentTarget.value.trim();
          if (!value) {
            setInlineError(null);
            if (line.timeMs != null) onSetTime(index, null);
            return;
          }
          const parsed = parseLrcTimestamp(value);
          if (parsed != null) {
            setInlineError(null);
            onSetTime(index, parsed);
          } else {
            // Keep the user's input and explain the format instead of silently
            // reverting to the previous timestamp, which looked like a
            // successful mark while the old value stayed in place (issue #297).
            setInlineError(manualTimeError(value, t));
          }
        }} title={inlineError ?? undefined} aria-invalid={inlineError != null} className={`h-8 w-full rounded-md border bg-[var(--input)] px-2 font-mono text-[11px] tabular-nums outline-none focus:border-[var(--song-accent)] ${inlineError ? 'border-[var(--destructive)]' : 'border-[var(--border)]'}`} aria-label={t('timeline.timestamp', { line: String(index + 1) })} />
        <div className="min-w-0">
          <div className={`truncate text-sm ${selected ? 'font-medium text-[var(--foreground)]' : 'text-[var(--muted-foreground)]'}`}>{line.text}</div>
        </div>
        <div className="flex justify-end gap-1">
          {line.timeMs != null && (
            <button type="button" onClick={(event) => { event.stopPropagation(); onSeek(line.timeMs!); }} disabled={!canSeek} className="rounded-md p-2 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)] disabled:opacity-30" aria-label={t('timelineWorkspace.seekToLine')} title={t('timelineWorkspace.seekToLine')}><Headphones className="h-3.5 w-3.5" /></button>
          )}
          <button type="button" onClick={(event) => { event.stopPropagation(); onClearTime(index); }} disabled={line.timeMs == null} className="rounded-md p-2 text-[var(--muted-foreground)] hover:bg-[var(--destructive)]/10 hover:text-[var(--destructive)] disabled:opacity-20" aria-label={t('timelineWorkspace.clearTime')} title={t('timelineWorkspace.clearTime')}><Eraser className="h-3.5 w-3.5" /></button>
        </div>
      </div>
      {inlineError && <p role="alert" aria-live="polite" className="mt-1 pl-[36px] text-[11px] text-[var(--destructive)] sm:pl-[44px]">{inlineError}</p>}
    </div>
  );
}
