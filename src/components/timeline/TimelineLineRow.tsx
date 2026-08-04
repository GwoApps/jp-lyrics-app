'use client';

import { CheckCircle2, Circle, Eraser, Headphones } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { fmtMs, parseLrcTimestamp, type TimelineDraftLine } from '@/lib/lrc';

interface TimelineLineRowProps {
  line: TimelineDraftLine;
  index: number;
  selected: boolean;
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
  canSeek,
  registerRow,
  onSelect,
  onSetTime,
  onClearTime,
  onSeek,
}: TimelineLineRowProps) {
  const { t } = useI18n();

  return (
    <div ref={registerRow} onClick={onSelect} className={`mb-1 grid cursor-pointer grid-cols-[28px_minmax(0,1fr)_72px] items-center gap-2 rounded-lg border px-2 py-2 transition-colors sm:grid-cols-[32px_112px_minmax(0,1fr)_72px] sm:gap-3 sm:px-3 ${selected ? 'border-[var(--song-accent)] bg-[var(--song-accent)]/8' : 'border-transparent hover:bg-[var(--accent)]'}`}>
      <div className="flex justify-center">{line.timeMs == null ? <Circle className="h-4 w-4 text-[var(--muted-foreground)]/50" /> : <CheckCircle2 className="h-4 w-4 text-[var(--success)]" />}</div>
      <div className="hidden sm:block">
        <input key={`${index}-${line.timeMs ?? 'empty'}`} defaultValue={line.timeMs == null ? '' : fmtMs(line.timeMs)} placeholder="--:--.---" onClick={(event) => event.stopPropagation()} onBlur={(event) => {
          const value = event.currentTarget.value.trim();
          if (!value) {
            if (line.timeMs != null) onSetTime(index, null);
            return;
          }
          const parsed = parseLrcTimestamp(value);
          if (parsed != null) onSetTime(index, parsed);
          else event.currentTarget.value = line.timeMs == null ? '' : fmtMs(line.timeMs);
        }} className="h-8 w-full rounded-md border border-[var(--border)] bg-[var(--input)] px-2 font-mono text-[11px] tabular-nums outline-none focus:border-[var(--song-accent)]" aria-label={t('timeline.timestamp', { line: String(index + 1) })} />
      </div>
      <div className="min-w-0">
        <div className={`truncate text-sm ${selected ? 'font-medium text-[var(--foreground)]' : 'text-[var(--muted-foreground)]'}`}>{line.text}</div>
        <div className="mt-0.5 font-mono text-[10px] text-[var(--muted-foreground)] sm:hidden">{line.timeMs == null ? t('timelineWorkspace.unmarked') : fmtMs(line.timeMs)}</div>
      </div>
      <div className="flex justify-end gap-1">
        {line.timeMs != null && (
          <button type="button" onClick={(event) => { event.stopPropagation(); onSeek(line.timeMs!); }} disabled={!canSeek} className="rounded-md p-2 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)] disabled:opacity-30" aria-label={t('timelineWorkspace.seekToLine')} title={t('timelineWorkspace.seekToLine')}><Headphones className="h-3.5 w-3.5" /></button>
        )}
        <button type="button" onClick={(event) => { event.stopPropagation(); onClearTime(index); }} disabled={line.timeMs == null} className="rounded-md p-2 text-[var(--muted-foreground)] hover:bg-[var(--destructive)]/10 hover:text-[var(--destructive)] disabled:opacity-20" aria-label={t('timelineWorkspace.clearTime')} title={t('timelineWorkspace.clearTime')}><Eraser className="h-3.5 w-3.5" /></button>
      </div>
    </div>
  );
}
