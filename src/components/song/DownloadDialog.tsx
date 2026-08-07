'use client';

import { useEffect, useId, useState } from 'react';
import { Download, FileText, FileClock, FileCode2, Check, X, AlertCircle } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import type { ExportFormat, ExportReadingMode } from '@/lib/lyrics-export';

interface DownloadDialogProps {
  songId: string;
  /** True when furigana/reading options should be offered (reading_scheme-dependent). */
  hasReadingData: boolean;
  /** True when the song has a stored translation that can be paired in exports. */
  hasTranslation: boolean;
  onClose: () => void;
}

const FORMAT_OPTIONS: { format: ExportFormat; icon: typeof FileText }[] = [
  { format: 'text', icon: FileText },
  { format: 'lrc', icon: FileClock },
  { format: 'html', icon: FileCode2 },
];

export default function DownloadDialog({
  songId,
  hasReadingData,
  hasTranslation,
  onClose,
}: DownloadDialogProps) {
  const { t } = useI18n();
  const titleId = useId();
  // The dialog is conditionally rendered by the caller, so it always mounts
  // fresh with a clean selection — no stale state from a previous download.
  const [format, setFormat] = useState<ExportFormat>('text');
  const [reading, setReading] = useState<ExportReadingMode>('none');
  const [includeTranslation, setIncludeTranslation] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const showReadingOptions = hasReadingData && format !== 'lrc';
  const showTranslationOption = hasTranslation && format !== 'lrc';
  const readingLabel = (mode: ExportReadingMode) => {
    switch (mode) {
      case 'furigana': return t('song.exportReadingFurigana');
      case 'romaji': return t('song.exportReadingRomaji');
      default: return t('song.exportReadingNone');
    }
  };
  const readingHint = (mode: ExportReadingMode) => {
    switch (mode) {
      case 'furigana':
        return t('song.exportReadingFuriganaHint');
      case 'romaji':
        return t('song.exportReadingRomajiHint');
      default:
        return t('song.exportReadingNoneHint');
    }
  };

  const buildUrl = () => {
    const params = new URLSearchParams({ format });
    if (showReadingOptions && reading !== 'none') params.set('reading', reading);
    if (showTranslationOption && includeTranslation) params.set('include_translation', '1');
    return `/api/songs/${songId}/export?${params.toString()}`;
  };

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3 sm:px-5 sm:py-4">
          <span className="song-accent-surface inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full">
            <Download className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="truncate text-sm font-semibold sm:text-base">{t('song.export')}</h2>
            <p className="truncate text-xs text-[var(--muted-foreground)]">{t('song.exportSubtitle')}</p>
          </div>
          <button
            type="button"
            autoFocus
            onClick={onClose}
            className="rounded-md p-2 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
            aria-label={t('common.close')}
            title={t('common.close')}
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="grid gap-4 p-4 sm:p-5">
          {/* Format */}
          <div>
            <div className="mb-2 text-xs font-medium text-[var(--muted-foreground)]">{t('song.exportFormatLabel')}</div>
            <div className="grid grid-cols-3 gap-2">
              {FORMAT_OPTIONS.map(({ format: f, icon: Icon }) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFormat(f)}
                  aria-pressed={format === f}
                  className={`flex flex-col items-center gap-1 rounded-xl border px-2 py-3 text-xs font-medium transition-colors ${
                    format === f
                      ? 'song-editor-choice--active border'
                      : 'border-[var(--border)] bg-[var(--accent)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span>.{f === 'text' ? 'txt' : f}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Reading mode */}
          {showReadingOptions && (
            <div>
              <div className="mb-2 text-xs font-medium text-[var(--muted-foreground)]">{t('song.exportReadingLabel')}</div>
              <div className="grid gap-2">
                {(['none', 'furigana', 'romaji'] as ExportReadingMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setReading(mode)}
                    aria-pressed={reading === mode}
                    className={`flex w-full items-start gap-3 rounded-xl border px-3 py-2 text-left transition-colors ${
                      reading === mode
                        ? 'song-editor-choice--active border'
                        : 'border-[var(--border)] bg-[var(--accent)] hover:border-[var(--border)]'
                    }`}
                  >
                    <span
                      className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                        reading === mode
                          ? 'border-[var(--song-accent)] song-editor-primary-button'
                          : 'border-[var(--border)] bg-[var(--background)]'
                      }`}
                    >
                      {reading === mode && <Check className="h-3.5 w-3.5" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm">{readingLabel(mode)}</span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-[var(--muted-foreground)]">
                        {readingHint(mode)}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Translation */}
          {showTranslationOption && (
            <label className="flex w-full cursor-pointer items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--accent)] px-3 py-2.5 transition-colors hover:border-[var(--border)]">
              <span
                className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                  includeTranslation
                    ? 'border-[var(--song-accent)] song-editor-primary-button'
                    : 'border-[var(--border)] bg-[var(--background)]'
                }`}
              >
                {includeTranslation && <Check className="h-3.5 w-3.5" />}
              </span>
              <span className="min-w-0">
                <span className="block text-sm">{t('song.exportTranslationLabel')}</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-[var(--muted-foreground)]">
                  {t('song.exportTranslationHint')}
                </span>
              </span>
              <input
                type="checkbox"
                className="sr-only"
                checked={includeTranslation}
                onChange={(event) => setIncludeTranslation(event.target.checked)}
              />
            </label>
          )}

          {!showReadingOptions && !showTranslationOption && format === 'lrc' && (
            <div className="flex items-start gap-2 rounded-xl border border-[var(--warning)]/30 bg-[var(--warning-muted)] px-3 py-2.5 text-xs text-[var(--warning)]">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{t('song.exportLrcHint')}</span>
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-[var(--border)] px-4 py-3 sm:px-5">
          <a
            href={buildUrl()}
            download
            className="song-editor-primary-button inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-xs font-medium"
          >
            <Download className="h-3.5 w-3.5" />
            {t('song.exportDownloadBtn')}
          </a>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-4 py-2 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
          >
            {t('common.cancel')}
          </button>
        </footer>
      </section>
    </div>
  );
}
