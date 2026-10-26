'use client';

import { useId, useRef, useState } from 'react';
import { Download, FileText, FileClock, FileCode2, Check, X, AlertCircle, Ban, Loader2 } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { useModalFocus } from '@/hooks/useModalFocus';
import { exportErrorMsg } from '@/lib/export-errors';
import { exportFilename, extensionForFormat, fallbackFilename, saveBlob } from '@/lib/download';
import type { ExportFormat, ExportReadingMode } from '@/lib/lyrics-export';

interface DownloadDialogProps {
  songId: string;
  /** True when furigana/reading options should be offered (reading_scheme-dependent). */
  hasReadingData: boolean;
  /** True when the song has a stored translation that can be paired in exports. */
  hasTranslation: boolean;
  /** True when the song has a non-empty synced timeline (whitespace-insensitive). */
  hasSynced: boolean;
  /** Song metadata used for the client-side fallback filename. */
  songTitle: string;
  songArtist?: string | null;
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
  hasSynced,
  songTitle,
  songArtist,
  onClose,
}: DownloadDialogProps) {
  const { t } = useI18n();
  const titleId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  // The dialog is conditionally rendered by the caller, so it always mounts
  // fresh with a clean selection — no stale state from a previous download.
  const [format, setFormat] = useState<ExportFormat>('text');
  const [reading, setReading] = useState<ExportReadingMode>('none');
  const [includeTranslation, setIncludeTranslation] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Focus trap + inert background + focus restore on close.
  useModalFocus({
    open: true,
    dialogRef,
    initialFocusRef: closeRef,
    onEscape: onClose,
  });

  const showReadingOptions = hasReadingData && format !== 'lrc';
  // LRC now supports pairing each timed row with its translation, so the
  // translation toggle is offered for every format (requires a stored translation).
  const showTranslationOption = hasTranslation;
  const lrcDisabled = !hasSynced;
  // The dialog always mounts fresh with a clean selection (see above), and the
  // LRC button is disabled when `lrcDisabled`, so `format` can never stay
  // `'lrc'` while LRC is unavailable. `selectedFormat` is a defensive fallback.
  const selectedFormat = lrcDisabled ? 'text' : format;
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

  const buildUrl = (format: ExportFormat = selectedFormat) => {
    const params = new URLSearchParams({ format });
    if (showReadingOptions && reading !== 'none') params.set('reading', reading);
    if (showTranslationOption && includeTranslation) params.set('include_translation', '1');
    return `/api/songs/${songId}/export?${params.toString()}`;
  };

  // A bare <a download> saves whatever the server returns — including the
  // error JSON of a 4xx/5xx. Fetch instead so the status code is observable:
  // success saves the blob, failure surfaces a localized message + retry.
  const handleDownload = async (format: ExportFormat = selectedFormat) => {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(buildUrl(format));
      if (!res.ok) {
        let code: string | undefined;
        try {
          const body = await res.json();
          code = typeof body?.error === 'string' ? body.error : undefined;
        } catch {
          // Non-JSON body (proxy error page, gateway timeout): generic message.
        }
        setError(exportErrorMsg(t, code));
        return;
      }
      const blob = await res.blob();
      saveBlob(
        blob,
        exportFilename(
          res.headers.get('Content-Disposition'),
          res.headers.get('Content-Type'),
          songTitle,
          songArtist,
          format,
          // Prefer the UI-visible name so the saved file keeps "title - artist".
          fallbackFilename(songTitle, songArtist, extensionForFormat(format)),
        ),
      );
      onClose();
    } catch {
      // Network failure / aborted body.
      setError(t('song.exportFailed'));
    } finally {
      setPending(false);
    }
  };

  const lrcOptionTitle = lrcDisabled
    ? t('song.exportLrcDisabledTitle')
    : t('song.exportLrcHint');

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <section
        ref={dialogRef}
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
            ref={closeRef}
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
              {FORMAT_OPTIONS.map(({ format: f, icon: Icon }) => {
                const isLrc = f === 'lrc';
                const disabled = isLrc && lrcDisabled;
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => {
                      if (disabled) return;
                      setFormat(f);
                      setError(null);
                    }}
                    aria-pressed={selectedFormat === f}
                    aria-disabled={disabled}
                    title={isLrc ? lrcOptionTitle : undefined}
                    className={`flex flex-col items-center gap-1 rounded-xl border px-2 py-3 text-xs font-medium transition-colors ${
                      selectedFormat === f
                        ? 'song-editor-choice--active border'
                        : disabled
                          ? 'cursor-not-allowed border-[var(--border)] bg-[var(--accent)] text-[var(--muted-foreground)]/50 opacity-60'
                          : 'border-[var(--border)] bg-[var(--accent)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    <span className="inline-flex items-center gap-1">
                      .{f === 'text' ? 'txt' : f}
                      {isLrc && disabled && <Ban className="h-3 w-3" />}
                    </span>
                  </button>
                );
              })}
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
                    onClick={() => {
                      setReading(mode);
                      setError(null);
                    }}
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
                onChange={(event) => {
                  setIncludeTranslation(event.target.checked);
                  setError(null);
                }}
              />
            </label>
          )}

          {!showReadingOptions && !showTranslationOption && format === 'lrc' && !lrcDisabled && (
            <div className="flex items-start gap-2 rounded-xl border border-[var(--warning)]/30 bg-[var(--warning-muted)] px-3 py-2.5 text-xs text-[var(--warning)]">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{t('song.exportLrcHint')}</span>
            </div>
          )}

          {lrcDisabled && (
            <div className="flex items-start gap-2 rounded-xl border border-[var(--warning)]/30 bg-[var(--warning-muted)] px-3 py-2.5 text-xs text-[var(--warning)]">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{t('song.exportLrcUnavailable')}</span>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-xl border border-[var(--destructive)]/30 bg-[var(--destructive)]/10 px-3 py-2.5 text-xs text-[var(--destructive)]"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1">{error}</span>
              <button
                type="button"
                onClick={() => void handleDownload()}
                disabled={pending}
                className="shrink-0 font-medium underline underline-offset-2 disabled:opacity-60"
              >
                {t('song.exportRetry')}
              </button>
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-[var(--border)] px-4 py-3 sm:px-5">
          <button
            type="button"
            onClick={() => void handleDownload()}
            disabled={pending}
            aria-busy={pending}
            className="song-editor-primary-button inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            {pending ? t('song.exportDownloading') : t('song.exportDownloadBtn')}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="rounded-md px-4 py-2 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-60"
          >
            {t('common.cancel')}
          </button>
        </footer>
      </section>
    </div>
  );
}
