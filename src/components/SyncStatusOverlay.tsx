'use client';

import { Loader2, X } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import type { SyncStage } from '@/lib/lyrics-fetcher';
import type { ProviderStage } from '@/lib/lyrics-provider/types';

interface SyncStatusOverlayProps {
  /** True while a sync request is in flight. */
  syncing: boolean;
  /** The lyrics source currently being queried (from the server's SSE stage). */
  stage: SyncStage | ProviderStage | null;
  /** Abort the in-flight sync. */
  onCancel: () => void;
}

// Maps the server's SSE stage key to the flat i18n key (the t() helper only
// splits on the first dot, so nested objects are not addressable). Only used
// for the legacy builtin stages.
const STAGE_KEYS: Record<SyncStage, string> = {
  lrclib: 'syncStageLrclib',
  'lrclib-search': 'syncStageLrclibSearch',
  petitlyrics: 'syncStagePetitlyrics',
  'uta-net': 'syncStageUtaNet',
  ytmusic: 'syncStageYtmusic',
};

/** Resolve the human-readable progress line for a stage (builtin or plugin). */
function stageLabel(stage: SyncStage | ProviderStage, t: (key: string, params?: Record<string, string | number>) => string): string {
  // Legacy builtin stage (string) — backward compatible i18n key.
  if (typeof stage === 'string') {
    return t(`song.${STAGE_KEYS[stage] ?? 'syncing'}`);
  }
  // Dynamic provider stage — third-party names are NOT hardcoded into i18n;
  // render a generic template with the provider's own display name.
  return t('song.syncStageProvider', { provider: stage.displayName });
}

/**
 * Fixed viewport-level sync progress line: a spinner with the live source
 * being queried (e.g. "正在查询 LRCLIB…") and a 取消 button so a long
 * multi-source fetch — or an accidental one — can be stopped without reloading.
 * Rendered at the page root (mirroring TranslationStatusOverlay) so the lyrics
 * panel's overflow/transform cannot clip it. Shown only while syncing; hidden
 * once the request settles (result, not-found, cancelled, etc.).
 */
export default function SyncStatusOverlay({ syncing, stage, onCancel }: SyncStatusOverlayProps) {
  const { t } = useI18n();
  if (!syncing) return null;

  return (
    <div className="fixed left-1/2 top-3 z-[100] flex -translate-x-1/2 items-center gap-2">
      <span className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-[var(--border)] bg-[var(--background)]/90 px-3 py-1.5 text-xs text-[var(--muted-foreground)] shadow-sm backdrop-blur-sm">
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--primary)]" />
        {stage ? stageLabel(stage, t) : t('song.syncing')}
        <button
          type="button"
          onClick={onCancel}
          aria-label={t('song.syncCancel')}
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[var(--destructive)]/50 px-2 py-0.5 text-[11px] font-medium text-[var(--destructive)] transition-colors hover:bg-[var(--destructive)]/10"
        >
          <X className="h-3 w-3" />
          {t('song.syncCancel')}
        </button>
      </span>
    </div>
  );
}
