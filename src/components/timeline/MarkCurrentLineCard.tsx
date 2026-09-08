'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, LocateFixed } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { fmtMs, parseLrcTimestamp } from '@/lib/lrc';
import type { TimelineDraftLine } from '@/lib/lrc';

interface MarkCurrentLineCardProps {
  currentIndex: number;
  totalLines: number;
  currentLine: TimelineDraftLine | undefined;
  liveProgress: number;
  canUseSpotifyTime: boolean;
  onMark: () => void;
  onMarkManual: (timeMs: number) => void;
  onSelectPrev: () => void;
  onSelectNext: () => void;
}

/** Sticky current-line card: navigation, live text, live mark-at, and a
 * Spotify-independent manual timestamp entry. */
export default function MarkCurrentLineCard({
  currentIndex,
  totalLines,
  currentLine,
  liveProgress,
  canUseSpotifyTime,
  onMark,
  onMarkManual,
  onSelectPrev,
  onSelectNext,
}: MarkCurrentLineCardProps) {
  const { t } = useI18n();
  const [manualDraft, setManualDraft] = useState('');

  const submitManual = () => {
    const parsed = parseLrcTimestamp(manualDraft);
    if (parsed == null) return;
    onMarkManual(parsed);
    setManualDraft('');
  };

  return (
    <section className="sticky top-14 z-40 mb-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 sm:p-5">
      <div className="grid items-center gap-4 md:grid-cols-[40px_minmax(0,1fr)_40px]">
        <button type="button" onClick={onSelectPrev} disabled={currentIndex === 0} className="hidden h-10 w-10 items-center justify-center rounded-md text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)] disabled:opacity-30 md:flex" aria-label={t('timelineWorkspace.previousLine')}><ChevronUp className="h-5 w-5" /></button>
        <div className="min-w-0 text-center">
          <div className="mb-2 text-[10px] font-medium text-[var(--muted-foreground)]">{t('timelineWorkspace.currentLine', { current: String(currentIndex + 1), total: String(totalLines) })}</div>
          <div className="text-lg font-medium leading-relaxed sm:text-2xl">{currentLine?.text}</div>
          <div className="mt-2 font-mono text-xs text-[var(--muted-foreground)]">{currentLine?.timeMs == null ? t('timelineWorkspace.unmarked') : fmtMs(currentLine.timeMs)}</div>
        </div>
        <button type="button" onClick={onSelectNext} disabled={currentIndex >= totalLines - 1} className="hidden h-10 w-10 items-center justify-center rounded-md text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)] disabled:opacity-30 md:flex" aria-label={t('timelineWorkspace.nextLine')}><ChevronDown className="h-5 w-5" /></button>
      </div>
      <button type="button" onClick={onMark} disabled={!canUseSpotifyTime} className="song-editor-primary-button mx-auto mt-5 flex min-h-12 w-full max-w-md items-center justify-center gap-2 rounded-lg px-5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40">
        <LocateFixed className="h-5 w-5" />
        {canUseSpotifyTime ? t('timelineWorkspace.markAt', { time: fmtMs(liveProgress) }) : t('timelineWorkspace.waitingSpotify')}
      </button>
      <form className="mx-auto mt-3 flex max-w-md items-center gap-2" onSubmit={(event) => { event.preventDefault(); submitManual(); }}>
        <input value={manualDraft} onChange={(event) => setManualDraft(event.target.value)} placeholder={t('timelineWorkspace.manualTimePlaceholder')} className="h-10 min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--input)] px-3 font-mono text-xs tabular-nums outline-none focus:border-[var(--song-accent)]" aria-label={t('timelineWorkspace.manualTimePlaceholder')} />
        <button type="submit" className="song-accent-button inline-flex h-10 shrink-0 items-center gap-1.5 rounded-md px-3 text-xs font-medium" aria-label={t('timelineWorkspace.setManualTime')}>{t('timelineWorkspace.setManualTime')}</button>
      </form>
      <div className="mt-3 hidden items-center justify-center gap-4 text-[10px] text-[var(--muted-foreground)] sm:flex">
        <span>{t('timelineWorkspace.shortcutMark')}</span><span>{t('timelineWorkspace.shortcutNavigate')}</span><span>{t('timelineWorkspace.shortcutSave')}</span>
      </div>
    </section>
  );
}
