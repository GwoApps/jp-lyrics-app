'use client';

import { useEffect, useMemo, useState } from 'react';
import { Clock3, LocateFixed, Minus, Plus, X } from 'lucide-react';
import { fmtMs, offsetLrcLines, parseLrcTimestamp, serializeLrc, type SyncLine } from '@/lib/lrc';
import { useI18n } from '@/lib/i18n';
import ConfirmDialog from '@/components/ConfirmDialog';

interface LrcTimelineEditorProps {
  initialLines: SyncLine[];
  currentPositionMs?: number | null;
  saving?: boolean;
  onSave: (lrc: string) => Promise<void> | void;
  onClose: () => void;
}

export default function LrcTimelineEditor({
  initialLines,
  currentPositionMs,
  saving = false,
  onSave,
  onClose,
}: LrcTimelineEditorProps) {
  const { t } = useI18n();
  const [lines, setLines] = useState<SyncLine[]>(() => initialLines.map((line) => ({ ...line })));
  const [timeDrafts, setTimeDrafts] = useState<string[]>(() => initialLines.map((line) => fmtMs(line.timeMs)));
  const [offsetDraft, setOffsetDraft] = useState('0');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const initialSerialized = useMemo(() => serializeLrc(initialLines), [initialLines]);

  const invalidRows = useMemo(() => new Set(
    timeDrafts.flatMap((value, index) => parseLrcTimestamp(value) == null ? [index] : []),
  ), [timeDrafts]);
  const dirty = serializeLrc(lines) !== initialSerialized
    || timeDrafts.some((draft, index) => draft !== fmtMs(lines[index]?.timeMs ?? 0));

  useEffect(() => {
    if (!dirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [dirty]);

  const requestClose = () => {
    if (dirty) setConfirmDiscard(true);
    else onClose();
  };


  const applyOffset = (offsetMs: number) => {
    if (!Number.isFinite(offsetMs) || offsetMs === 0) return;
    const shifted = offsetLrcLines(lines, offsetMs);
    setLines(shifted);
    setTimeDrafts(shifted.map((line) => fmtMs(line.timeMs)));
    setOffsetDraft('0');
  };

  const commitTime = (index: number, value: string) => {
    const parsed = parseLrcTimestamp(value);
    if (parsed == null) return;
    setLines((current) => current.map((line, lineIndex) =>
      lineIndex === index ? { ...line, timeMs: parsed } : line,
    ));
    setTimeDrafts((current) => current.map((draft, lineIndex) =>
      lineIndex === index ? fmtMs(parsed) : draft,
    ));
  };

  const setCurrentTime = (index: number) => {
    if (currentPositionMs == null) return;
    const next = Math.max(0, Math.round(currentPositionMs));
    setLines((current) => current.map((line, lineIndex) =>
      lineIndex === index ? { ...line, timeMs: next } : line,
    ));
    setTimeDrafts((current) => current.map((draft, lineIndex) =>
      lineIndex === index ? fmtMs(next) : draft,
    ));
  };

  return (
    <section className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--card)] p-3 sm:p-4" aria-label={t('timeline.title')}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium">
            <Clock3 className="h-4 w-4 text-[var(--song-accent)]" />
            {t('timeline.title')}
          </div>
          <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">{t('timeline.description')}</p>
        </div>
        <button type="button" onClick={requestClose} className="rounded-md p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]" aria-label={t('common.close')} title={t('common.close')}>
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md bg-[var(--muted)] p-2">
        <span className="text-[11px] font-medium text-[var(--muted-foreground)]">{t('timeline.offset')}</span>
        {[-500, -100, 100, 500].map((offset) => (
          <button key={offset} type="button" onClick={() => applyOffset(offset)} className="rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-[11px] tabular-nums hover:border-[var(--song-accent)]">
            {offset > 0 ? <Plus className="mr-0.5 inline h-3 w-3" /> : <Minus className="mr-0.5 inline h-3 w-3" />}{Math.abs(offset)}ms
          </button>
        ))}
        <div className="flex items-center gap-1">
          <input type="number" step="10" value={offsetDraft} onChange={(event) => setOffsetDraft(event.target.value)} className="w-24 rounded-md border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-[11px] tabular-nums outline-none focus:border-[var(--song-accent)]" aria-label={t('timeline.customOffset')} />
          <button type="button" onClick={() => applyOffset(Number(offsetDraft))} className="rounded-md bg-[var(--accent)] px-2 py-1 text-[11px] hover:text-[var(--foreground)]">{t('timeline.apply')}</button>
        </div>
      </div>

      <div className="max-h-[42vh] space-y-1.5 overflow-y-auto pr-1">
        {lines.map((line, index) => (
          <div key={index} className="grid grid-cols-[86px_minmax(0,1fr)_32px] items-center gap-2 rounded-md border border-[var(--border)]/70 bg-[var(--background)]/60 p-2">
            <input
              value={timeDrafts[index] ?? fmtMs(line.timeMs)}
              onChange={(event) => setTimeDrafts((current) => current.map((draft, lineIndex) => lineIndex === index ? event.target.value : draft))}
              onBlur={(event) => commitTime(index, event.target.value)}
              className={`w-full rounded border bg-[var(--input)] px-1.5 py-1 font-mono text-[11px] tabular-nums outline-none ${invalidRows.has(index) ? 'border-[var(--destructive)]' : 'border-[var(--border)] focus:border-[var(--song-accent)]'}`}
              aria-label={t('timeline.timestamp', { line: String(index + 1) })}
            />
            <input
              value={line.text}
              onChange={(event) => setLines((current) => current.map((item, lineIndex) => lineIndex === index ? { ...item, text: event.target.value } : item))}
              className="min-w-0 rounded border border-transparent bg-transparent px-1.5 py-1 text-xs outline-none hover:border-[var(--border)] focus:border-[var(--song-accent)]"
              aria-label={t('timeline.lyricLine', { line: String(index + 1) })}
            />
            <button type="button" onClick={() => setCurrentTime(index)} disabled={currentPositionMs == null} className="rounded p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--song-accent)] disabled:opacity-30" aria-label={t('timeline.useCurrent')} title={t('timeline.useCurrent')}>
              <LocateFixed className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="text-[10px] text-[var(--muted-foreground)]">{t('timeline.lineCount', { count: String(lines.length) })}</span>
        <div className="flex gap-2">
          <button type="button" onClick={requestClose} className="rounded-md px-3 py-1.5 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]">{t('common.cancel')}</button>
          <button type="button" onClick={() => onSave(serializeLrc(lines))} disabled={saving || lines.length === 0 || invalidRows.size > 0} className="song-editor-primary-button rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50">
            {saving ? t('timeline.saving') : t('common.save')}
          </button>
        </div>
      </div>
      <ConfirmDialog
        open={confirmDiscard}
        title={t('timeline.unsavedTitle')}
        body={t('timeline.unsavedBody')}
        confirmLabel={t('timeline.discard')}
        cancelLabel={t('common.cancel')}
        variant="danger"
        onConfirm={onClose}
        onCancel={() => setConfirmDiscard(false)}
      />
    </section>
  );
}
