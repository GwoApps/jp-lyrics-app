'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import type { FuriganaLine, ReadingMode, ReadingScheme, SongData } from '@/lib/types';
import type { SyncStage } from '@/lib/lyrics-fetcher';
import type { ProviderStage } from '@/lib/lyrics-provider/types';
import { mapTimelineTimestamps, parseLrc } from '@/lib/lrc';
import type { SpotifyState } from './useSpotifySync';
import type { TranslationProgress } from '@/lib/translation-stream';
import { useI18n } from '@/lib/i18n';

import type { CantoneseDetectionResult } from '@/lib/lyrics-reading';
import { copyToClipboard } from '@/lib/clipboard';
import { useReadingPreferences } from './useReadingPreferences';
import { useImport } from './useImport';
import { useTranslation } from './useTranslation';
import { useSync } from './useSync';
import { matchSong } from '@/lib/match-song';
import { updateReadingScheme } from '@/lib/reading-scheme';
import { usePiP } from './usePiP';
import { useFurigana } from './useFurigana';
import type { ImportAlertState, ImportReviewState } from './models';

interface ToastState {
  type: 'success' | 'error' | 'info';
  msg: string;
  actionLabel?: string;
  onAction?: () => void;
}

export interface UseSongDataReturn {
  song: SongData | null;
  loading: boolean;
  loadError: boolean;
  retryLoad: () => void;
  refreshSong: () => Promise<void>;
  syncLines: ReturnType<typeof parseLrc>;
  furiganaLines: FuriganaLine[];
  translations: string[];
  hasTranslation: boolean;
  // Number of lyric lines still missing a translation (used to surface
  // partial translations in the UI and offer a one-tap resume entry).
  untranslatedCount: number;
  // Number of lyric lines that have a non-empty translation.
  translatedCount: number;
  showTranslation: boolean;
  setShowTranslation: React.Dispatch<React.SetStateAction<boolean>>;
  translating: boolean;
  // True briefly after a cancellation/error while the client re-reads the
  // server's final persisted result to show a reliable coverage number.
  translationSaving: boolean;
  translationError: string | null;
  translationProgress: TranslationProgress | null;
  /** Opaque preparation stage reported by the server before streaming starts
   *  (e.g. glossary extraction) — surfaced to the user as a generic
   *  "preparing" notice, never the internal stage name (issue #172). */
  translationStage: string | null;
  translationReasoning: string;
  showTranslationReasoning: boolean;
  setShowTranslationReasoning: (show: boolean) => void;
  toggleTranslationReasoning: () => void;
  hasSavedReasoning: boolean;
  openSavedReasoning: () => void;
  copyReasoning: () => Promise<void>;
  dismissTranslationError: () => void;
  clearReasoning: () => Promise<void>;
  handleTranslate: (force?: boolean) => Promise<void>;
  cancelTranslate: () => void;
  /** Effective target language for translation (user setting → global default). */
  targetLang: string | null;
  /** The user's own translation-target override ('' when using the system default). */
  targetLangOverride: string;
  /** Persist a new translation target language and refresh the effective value. */
  setTargetLang: (code: string) => Promise<void>;
  furiganaLoading: boolean;
  furiganaError: string;
  retryFurigana: () => void;
  lineTimestamps: (number | null)[];
  syncing: boolean;
  /** Current lyrics source being queried during a sync (SSE stage), for the progress line. */
  syncStage: SyncStage | ProviderStage | null;
  /** Abort the in-flight sync fetch (cancel button next to the spinner). */
  cancelSync: () => void;
  importing: boolean;
  copied: boolean;
  readingMode: ReadingMode;
  setReadingMode: React.Dispatch<React.SetStateAction<ReadingMode>>;
  romanizeFurigana: boolean;
  setRomanizeFurigana: React.Dispatch<React.SetStateAction<boolean>>;
  cantoneseSuggestion: CantoneseDetectionResult | null;
  setSongReadingScheme: (scheme: ReadingScheme) => Promise<void>;
  dismissCantoneseSuggestion: () => Promise<void>;
  debug: boolean;
  setDebug: React.Dispatch<React.SetStateAction<boolean>>;
  deleteConfirm: boolean;
  setDeleteConfirm: React.Dispatch<React.SetStateAction<boolean>>;
  importAlert: ImportAlertState | null;
  setImportAlert: React.Dispatch<React.SetStateAction<ImportAlertState | null>>;
  importReview: ImportReviewState | null;
  setImportReview: React.Dispatch<React.SetStateAction<ImportReviewState | null>>;
  confirmImportReview: () => Promise<void>;
  fontSize: number;
  setFontSize: React.Dispatch<React.SetStateAction<number>>;
  toast: ToastState | null;
  /** Server-side "now playing" match: returns the best DB song for a Spotify track
   *  (or null), fetching only the winning candidate instead of the full list.
   *  `excludeId` skips the song rendered on this page (the "other song" match). */
  matchSong: (track: { id?: string; name: string; artist: string }, excludeId?: string) => Promise<{
    id: string; title: string; artist: string; spotify_track_id?: string | null;
  } | null>;
  handleSync: () => Promise<void>;
  lowConfidenceSync: { source: string; confidence: number; lines: number; lrc: string; candidate: string; match?: ImportReviewState['match'] } | null;
  confirmLowConfidenceSync: () => void;
  cancelLowConfidenceSync: () => void;
  plainHitSync: { source: string; confidence: number; plain: string; candidate: string; match?: ImportReviewState['match'] } | null;
  confirmPlainSync: () => void;
  cancelPlainSync: () => void;
  handleDelete: () => void;
  confirmDelete: () => Promise<void>;
  handleCopy: (mode?: 'original' | 'translation') => Promise<void>;
  handleImportPlaying: (spotify: SpotifyState | null) => Promise<void>;
  openPiP: (
    furiganaLines: FuriganaLine[],
    song: SongData | null,
    highlightLine: number,
    pipWindowRef: React.MutableRefObject<Window | null>,
    timestamps?: (number | null)[],
  ) => Promise<void>;
  showToast: (type: 'success' | 'error' | 'info', msg: string, actionLabel?: string, onAction?: () => void) => void;
}

export function useSongData(id: string): UseSongDataReturn {
  const router = useRouter();
  const { t } = useI18n();
  const {
    readingMode, setReadingMode,
    romanizeFurigana, setRomanizeFurigana,
    showTranslation, setShowTranslation,
    debug, setDebug,
    fontSize, setFontSize,
  } = useReadingPreferences();

  const [song, setSong] = useState<SongData | null>(null);
  const [loading, setLoading] = useState(true);
  // True when the detail fetch failed for a retryable reason (HTTP 5xx/429 or
  // network/timeout). A 404 (genuinely absent song) keeps `song=null` and is
  // shown as "not found" — distinct from a load error.
  const [loadError, setLoadError] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((type: 'success' | 'error' | 'info', msg: string, actionLabel?: string, onAction?: () => void) => {
    // Clear any pending timer from a previous toast so it cannot dismiss the new one early.
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ type, msg, actionLabel, onAction });
    // Action toasts stay longer so the user has time to react.
    toastTimerRef.current = setTimeout(() => {
      toastTimerRef.current = null;
      setToast(null);
    }, actionLabel ? 8000 : 3000);
  }, []);

  const dismissToast = useCallback(() => setToast(null), []);

  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, []);

  // ── Sub-hooks ───────────────────────────────────────────
  const {
    importing, importAlert, setImportAlert, importReview, setImportReview,
    confirmImportReview, handleImportPlaying,
  } = useImport({ showToast, t });

  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [copied, setCopied] = useState(false);

  // Persist font size

  // Derived
  const {
    furiganaLines, furiganaLoading, furiganaError, retryFurigana,
    cantoneseSuggestion, resetFurigana,
  } = useFurigana({ id, song, t });
  const lineTimestamps = useMemo(() => {
    if (!song || !furiganaLines.length) return [] as (number | null)[];
    const renderedRows = furiganaLines.map((line) => line.segments.map((segment) => segment.text).join(''));
    return mapTimelineTimestamps(renderedRows, song.lyrics_raw || '', song.lyrics_synced || '');
  }, [song, furiganaLines]);

  const { openPiP } = usePiP({
    fontSize, readingMode, romanizeFurigana, song, furiganaLines, lineTimestamps, showToast, t,
  });

  const updateReadingPreference = useCallback(async (payload: {
    reading_scheme?: ReadingScheme;
    reading_scheme_confirmed: boolean;
  }) => {
    const updated = await updateReadingScheme(id, payload);
    resetFurigana();
    setSong(updated);
  }, [id, resetFurigana]);

  const setSongReadingScheme = useCallback(async (scheme: ReadingScheme) => {
    try {
      await updateReadingPreference({ reading_scheme: scheme, reading_scheme_confirmed: true });
      showToast('success', t(scheme === 'yue-jyutping' ? 'song.jyutpingEnabled' : 'song.japaneseReadingEnabled'));
    } catch {
      showToast('error', t('song.readingSchemeUpdateFailed'));
    }
  }, [showToast, t, updateReadingPreference]);

  const dismissCantoneseSuggestion = useCallback(async () => {
    try {
      await updateReadingPreference({ reading_scheme_confirmed: true });
    } catch {
      showToast('error', t('song.readingSchemeUpdateFailed'));
    }
  }, [showToast, t, updateReadingPreference]);

  // Refresh song data (e.g. after request-public). Resolves with the fresh
  // song payload (or undefined on failure) so callers can compute derived
  // numbers synchronously without relying on async state propagation.
  const refreshSong = useCallback(async () => {
    try {
      const res = await fetch(`/api/songs/${id}`);
      if (res.ok) {
        const data = await res.json();
        setSong(data);
        return data;
      }
    } catch (error) {
      console.error('刷新歌曲数据失败', error);
    }
    return undefined;
  }, [id]);

  // ── Translation sub-hook ────────────────────────────────
  const {
    translations, hasTranslation, untranslatedCount, translatedCount,
    translating, translationSaving, translationError, translationProgress,
    translationStage, translationReasoning, showTranslationReasoning,
    setShowTranslationReasoning, toggleTranslationReasoning, hasSavedReasoning,
    openSavedReasoning, copyReasoning, dismissTranslationError, clearReasoning,
    handleTranslate, cancelTranslate, targetLang, targetLangOverride, setTargetLang,
    seedFromLoad,
  } = useTranslation({
    id, song, furiganaLinesLength: furiganaLines.length, showTranslation,
    setShowTranslation, showToast, dismissToast, t, refreshSong, setSong,
  });


  // Fetch the single song. Distinguishes a genuine 404 (song absent) from
  // every other failure (HTTP 5xx/429, network or timeout). Pure fetch — no
  // setState — so callers can apply the result inside a promise `.then`
  // callback (avoids synchronous setState in an effect).
  const fetchSong = useCallback(async (): Promise<{ data?: SongData; notFound?: boolean }> => {
    if (!id) return {};
    try {
      const res = await fetch(`/api/songs/${id}`);
      if (res.status === 404) return { notFound: true };
      if (!res.ok) return {};
      const data = await res.json() as SongData;
      return { data };
    } catch {
      // Network failure / timeout / invalid body — retryable.
      return {};
    }
  }, [id]);

  // Apply the fetched result to state. Called from promise `.then` callbacks
  // (mount + retry) so setState never runs synchronously inside an effect.
  const applySongResult = useCallback((result: { data?: SongData; notFound?: boolean }) => {
    if (result.notFound) {
      setLoadError(false);
      setSong(null);
      return;
    }
    const data = result.data;
    if (!data) {
      setLoadError(true);
      return;
    }
    setLoadError(false);
    setSong(data);
    if (data.lyrics_translation_reasoning) {
      seedFromLoad(data);
    }
    if (!data.spotify_track_id && data.permissions?.can_edit) {
      fetch(`/api/songs/${id}/cover`)
        .then(async (metadataResponse) => {
          if (!metadataResponse.ok) return null;
          const refreshed = await fetch(`/api/songs/${id}`, { cache: 'no-store' });
          return refreshed.ok ? refreshed.json() : null;
        })
        .then((enriched) => { if (enriched) setSong(enriched); })
        .catch(() => {});
    }
  }, [id, seedFromLoad]);

  // ── Sync sub-hook ──────────────────────────────────────
  const {
    syncLines, syncing, syncStage,
    lowConfidenceSync, confirmLowConfidenceSync, cancelLowConfidenceSync,
    plainHitSync, confirmPlainSync, cancelPlainSync,
    handleSync, cancelSync,
  } = useSync({
    id, song, setSong, setImportAlert, fetchSong, applySongResult, showToast, t,
  });

  // Retry entry for the error state: re-runs the exact same fetch as mount.
  const retryLoad = useCallback(() => {
    setLoading(true);
    void fetchSong().then((result) => { applySongResult(result); setLoading(false); });
  }, [fetchSong, applySongResult]);

  // Fetch the single song on mount. The previous full public-song list fetch
  // was removed — the detail page no longer needs the entire catalogue for a
  // single "now playing" match; callers use `matchSong` on demand instead.
  useEffect(() => {
    if (!id) return;
    void fetchSong().then((result) => { applySongResult(result); setLoading(false); });
  }, [id, fetchSong, applySongResult]);

  const handleDelete = useCallback(() => {
    if (!song) return;
    setDeleteConfirm(true);
  }, [song]);

  const confirmDelete = useCallback(async () => {
    if (!song) return;
    const res = await fetch(`/api/songs/${id}`, { method: 'DELETE' });
    if (res.ok) { showToast('success', t('home.deleted')); setTimeout(() => router.push('/'), 800); }
    setDeleteConfirm(false);
  }, [id, song, router, t, showToast]);

  const handleCopy = useCallback(async (mode: 'original' | 'translation' = 'original') => {
    if (!song) return;
    let text: string;
    if (mode === 'translation') {
      const lines = translations.filter((tr) => tr.trim() !== '');
      if (lines.length === 0) {
        showToast('error', t('song.copyTranslationEmpty'));
        return;
      }
      text = lines.join('\n');
    } else {
      text = song.lyrics_raw || furiganaLines.map(l => l.segments.map(s => s.text).join('')).join('\n');
    }
    const ok = await copyToClipboard(text);
    if (!ok) {
      showToast('error', t('song.copyFailed'));
      return;
    }
    setCopied(true);
    showToast('success', t('share.copied'));
    setTimeout(() => setCopied(false), 2000);
  }, [song, furiganaLines, translations, t, showToast]);



  return {
    song,
    loading,
    loadError,
    retryLoad,
    refreshSong,
    syncLines,
    furiganaLines,
    translations,
    hasTranslation,
    untranslatedCount,
    translatedCount,
    showTranslation,
    setShowTranslation,
    translating,
    translationSaving,
    translationError,
    translationProgress,
    translationStage,
    translationReasoning,
    showTranslationReasoning,
    setShowTranslationReasoning,
    toggleTranslationReasoning,
    hasSavedReasoning,
    openSavedReasoning,
    copyReasoning,
    dismissTranslationError,
    clearReasoning,
    handleTranslate,
    cancelTranslate,
    targetLang,
    targetLangOverride,
    setTargetLang,
    furiganaLoading,
    furiganaError,
    retryFurigana,
    lineTimestamps,
    syncing,
    syncStage,
    cancelSync,
    importing,
    copied,
    readingMode,
    setReadingMode,
    romanizeFurigana,
    setRomanizeFurigana,
    cantoneseSuggestion,
    setSongReadingScheme,
    dismissCantoneseSuggestion,
    debug,
    setDebug,
    deleteConfirm,
    setDeleteConfirm,
    importAlert,
    setImportAlert,
    importReview,
    setImportReview,
    confirmImportReview,
    fontSize,
    setFontSize,
    toast,
    matchSong,
    handleSync,
    lowConfidenceSync,
    confirmLowConfidenceSync,
    cancelLowConfidenceSync,
    plainHitSync,
    confirmPlainSync,
    cancelPlainSync,
    handleDelete,
    confirmDelete,
    handleCopy,
    handleImportPlaying,
    openPiP,
    showToast,
  };
}
