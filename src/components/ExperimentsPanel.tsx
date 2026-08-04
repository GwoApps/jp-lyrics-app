'use client';

import { FlaskConical, Mic, X, CircleAlert } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

interface ExperimentsPanelProps {
  spectrumOn: boolean;
  spectrumError: string | null;
  onToggleSpectrum: () => void;
  onClose: () => void;
}

/**
 * Experimental features panel (opened from the song "more" menu).
 * Currently hosts the "microphone spectrum" toggle: captures audio from the
 * Web Audio API and drives the lyrics dot grid's bottom rows as a spectrum
 * wave (peak capped at one third of the panel).
 */
export default function ExperimentsPanel({
  spectrumOn,
  spectrumError,
  onToggleSpectrum,
  onClose,
}: ExperimentsPanelProps) {
  const { t } = useI18n();

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label={t('common.close')}
        onClick={onClose}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
      />
      <div className="relative w-full max-w-sm overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <FlaskConical className="h-4 w-4 text-[var(--primary)]" />
            {t('song.experimentsTitle')}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="rounded-md p-1 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm">
              <Mic className="h-4 w-4 text-[var(--muted-foreground)]" />
              <span>{t('song.experimentSpectrum')}</span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={spectrumOn}
              onClick={onToggleSpectrum}
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                spectrumOn ? 'bg-[var(--primary)]' : 'bg-[var(--border)]'
              }`}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                  spectrumOn ? 'translate-x-[22px]' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>

          {spectrumError && (
            <div className="flex items-start gap-2 rounded-lg border border-[var(--destructive)]/30 bg-[var(--destructive)]/5 px-3 py-2 text-xs text-[var(--destructive)]">
              <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{spectrumError}</span>
            </div>
          )}

          <p className="text-[11px] leading-relaxed text-[var(--muted-foreground)]">
            {t('song.experimentSpectrumHint')}
          </p>
        </div>
      </div>
    </div>
  );
}
