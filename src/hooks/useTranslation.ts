'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { readTranslationStream, type TranslationProgress } from '@/lib/translation-stream';
import { TRANSLATION_ERROR_KEYS } from '@/lib/translation-errors';
import { parseTranslationCache } from '@/lib/translation/parse';
import { copyToClipboard } from '@/lib/clipboard';
import { isKnownTargetLang, targetLangDisplay } from '@/lib/target-lang';
import type { SongData } from '@/lib/types';


interface UseTranslationDeps {
  id: string;
  song: SongData | null;
  furiganaLinesLength: number;
  showTranslation: boolean;
  setShowTranslation: React.Dispatch<React.SetStateAction<boolean>>;
  showToast: (type: 'success' | 'error' | 'info', msg: string, actionLabel?: string, onAction?: () => void) => void;
  dismissToast: () => void;
  t: (key: string, params?: Record<string, string>) => string;
  /** Refresh song from server and return the fresh payload. */
  refreshSong: () => Promise<SongData | undefined>;
  /** Update the song state in the orchestrator. */
  setSong: React.Dispatch<React.SetStateAction<SongData | null>>;
}

export interface UseTranslationReturn {
  translations: string[];
  hasTranslation: boolean;
  untranslatedCount: number;
  translatedCount: number;
  translating: boolean;
  translationSaving: boolean;
  translationError: string | null;
  translationProgress: TranslationProgress | null;
  translationStage: string | null;
  translationReasoning: string;
  showTranslationReasoning: boolean;
  setShowTranslationReasoning: (show: boolean) => void;
  toggleTranslationReasoning: () => void;
  hasSavedReasoning: boolean;
  openSavedReasoning: () => void;
  copyReasoning: () => Promise<void>;
  exportReasoning: () => void;
  dismissTranslationError: () => void;
  clearReasoning: () => Promise<void>;
  handleTranslate: (force?: boolean) => Promise<void>;
  cancelTranslate: () => void;
  targetLang: string | null;
  targetLangOverride: string;
  setTargetLang: (code: string) => Promise<void>;
  /**
   * Called by the orchestrator's `applySongResult` to seed reasoning state
   * from the initial song fetch (persisted reasoning). This avoids the
   * orchestrator needing to reach into translation-internal state.
   */
  seedFromLoad: (data: { lyrics_translation_reasoning?: string | null }) => void;
}

/**
 * Sub-hook: translation workflow (SSE streaming, reasoning, target language,
 * derived translation arrays). Owns all translation-related state; writes to
 * `song` only via the orchestrator-injected `setSong` / `refreshSong`.
 */
export function useTranslation(deps: UseTranslationDeps): UseTranslationReturn {
  const {
    id, song, furiganaLinesLength, showTranslation, setShowTranslation,
    showToast, dismissToast, t, refreshSong, setSong,
  } = deps;

  // ── Translation state ───────────────────────────────────
  const [translating, setTranslating] = useState(false);
  const [translationSaving, setTranslationSaving] = useState(false);
  const [translationError, setTranslationError] = useState<string | null>(null);
  const [translationProgress, setTranslationProgress] = useState<TranslationProgress | null>(null);
  const [translationStage, setTranslationStage] = useState<string | null>(null);
  const [translationReasoning, setTranslationReasoning] = useState('');
  const translateAbortRef = useRef<AbortController | null>(null);
  const translationDoneRef = useRef(0);
  const [showTranslationReasoning, setShowTranslationReasoning] = useState(false);
  const [hasSavedReasoning, setHasSavedReasoning] = useState(false);
  const reasoningUserHiddenRef = useRef(false);

  // ── Target language state ───────────────────────────────
  const [targetLang, setTargetLangState] = useState<string | null>(null);
  const [targetLangOverride, setTargetLangOverride] = useState('');

  const applyEffectiveLang = useCallback((code: string | undefined) => {
    if (typeof code !== 'string' || !code.trim()) return;
    const trimmed = code.trim();
    if (isKnownTargetLang(trimmed)) setTargetLangState(trimmed);
  }, []);

  // ── Derived translation arrays ──────────────────────────
  const translations = useMemo<string[]>(() => {
    const totalLines = song?.lyrics_raw ? song.lyrics_raw.split('\n').length : 0;
    if (!song?.lyrics_translation || totalLines === 0) return [];
    return parseTranslationCache(song.lyrics_translation, totalLines);
  }, [song]);

  const hasTranslation = useMemo(
    () => translations.some((line) => line !== ''),
    [translations],
  );

  const { translatedCount, untranslatedCount } = useMemo(() => {
    const rawLines = song?.lyrics_raw ? song.lyrics_raw.split('\n') : [];
    let translated = 0;
    let total = 0;
    rawLines.forEach((raw, i) => {
      if (!raw.trim()) return;
      total += 1;
      if ((translations[i] ?? '').trim() !== '') translated += 1;
    });
    return { translatedCount: translated, untranslatedCount: total - translated };
  }, [song, translations]);

  // ── Coverage helper ─────────────────────────────────────
  const coverageOf = useCallback((rawLyrics: string | undefined, translationCache: string | undefined) => {
    const rawLines = rawLyrics ? rawLyrics.split('\n') : [];
    const cache = parseTranslationCache(translationCache, rawLines.length);
    let covered = 0;
    let coverable = 0;
    rawLines.forEach((raw, i) => {
      if (!raw.trim()) return;
      coverable += 1;
      if ((cache[i] ?? '').trim() !== '') covered += 1;
    });
    return { covered, coverable };
  }, []);

  // ── Target language fetch ───────────────────────────────
  const fetchTargetLang = useCallback(async (): Promise<{
    effective_target_lang?: string;
    settings?: { translation_target_lang?: string };
  } | null> => {
    try {
      const res = await fetch('/api/me/settings', { cache: 'no-store' });
      if (!res.ok) return null;
      return await res.json();
    } catch { return null; }
  }, []);

  useEffect(() => {
    void fetchTargetLang().then((data) => {
      if (!data) return;
      applyEffectiveLang(data.effective_target_lang);
      setTargetLangOverride(data.settings?.translation_target_lang ?? '');
    });
  }, [fetchTargetLang, applyEffectiveLang]);

  const setTargetLang = useCallback(async (code: string) => {
    try {
      const res = await fetch('/api/me/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ translation_target_lang: code }),
      });
      if (!res.ok) return;
      const data = await res.json() as { effective_target_lang?: string; settings?: { translation_target_lang?: string } };
      applyEffectiveLang(data.effective_target_lang);
      setTargetLangOverride(data.settings?.translation_target_lang ?? '');
    } catch { /* keep previous value */ }
  }, [applyEffectiveLang]);

  // ── Seed from initial load ──────────────────────────────
  const seedFromLoad = useCallback((data: { lyrics_translation_reasoning?: string | null }) => {
    if (data.lyrics_translation_reasoning) {
      setTranslationReasoning(data.lyrics_translation_reasoning);
      setHasSavedReasoning(true);
      reasoningUserHiddenRef.current = true;
    }
  }, []);

  // ── Main translate handler ──────────────────────────────
  const handleTranslate = useCallback(async (force = false) => {
    if (translating) return;
    const total = furiganaLinesLength;
    if (total === 0) {
      showToast('error', t('song.translationEmptyLyrics'));
      return;
    }
    setTranslating(true);
    setTranslationError(null);
    setTranslationReasoning('');
    setHasSavedReasoning(false);
    reasoningUserHiddenRef.current = false;
    setTranslationProgress(null);
    setTranslationStage(null);
    translationDoneRef.current = 0;
    const controller = new AbortController();
    translateAbortRef.current = controller;
    try {
      const res = await fetch(`/api/songs/${id}/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stream: true, force }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? 'translation_failed');
      }

      const onProgress = (progress: TranslationProgress) => {
        setTranslationStage(null);
        translationDoneRef.current = progress.requestDone;
        setTranslationProgress(progress);
      };
      let streamedReasoning = '';
      const { translations, lang: streamLang, error: streamError, progress: errorProgress } = await readTranslationStream(
        res.body,
        (delta) => {
          streamedReasoning += delta;
          setTranslationReasoning((prev) => prev + delta);
        },
        onProgress,
        () => setTranslationStage('preparing'),
      );
      const reasoningStreamed = streamedReasoning.length > 0;

      if (translations) {
        setTranslationProgress(null);
        setTranslationStage(null);
        if (reasoningStreamed) setHasSavedReasoning(true);
        const seed: (string | null)[] = Array(total).fill(null);
        try {
          const parsed = JSON.parse(song?.lyrics_translation ?? '[]');
          if (Array.isArray(parsed)) {
            parsed.forEach((item, i) => { if (i < total && typeof item === 'string') seed[i] = item; });
          }
        } catch { /* keep empty seed */ }
        translations.forEach((tr: string, i: number) => { if (i < total) seed[i] = tr; });
        setSong((prev) => prev ? {
          ...prev,
          lyrics_translation: JSON.stringify(seed),
          lyrics_translation_lang: streamLang,
        } : prev);
        setShowTranslation(true);
        const translatedNow = seed.filter((s) => (s ?? '').trim() !== '').length;
        const partial = translatedNow < total;
        const msg = partial
          ? t('song.translationReadyPartial', { done: String(translatedNow), total: String(total) })
          : streamLang
            ? t('song.translationReadyLang', { lang: streamLang })
            : t('song.translationReady');
        showToast(partial ? 'info' : 'success', msg);
        return;
      }

      const errorKey = TRANSLATION_ERROR_KEYS;
      const coveredNow = errorProgress?.covered ?? 0;
      const message = streamError === 'translation_cancelled'
        ? t('song.translationCancelled', { done: String(coveredNow) })
        : streamError && errorKey[streamError]
          ? t(errorKey[streamError])
          : t('song.translationFailed');
      if (errorProgress) {
        setTranslationProgress(errorProgress);
        if (errorProgress.covered > 0) await refreshSong();
      } else {
        setTranslationProgress(null);
      }
      setTranslationStage(null);
      if (reasoningStreamed) setHasSavedReasoning(true);
      setTranslationError(message);
      showToast(streamError === 'translation_cancelled' ? 'info' : 'error', message);
    } catch {
      if (controller.signal.aborted) {
        const requestDone = translationDoneRef.current;
        setTranslationSaving(true);
        try {
          const fresh = (await refreshSong())
            ?? await new Promise<SongData | undefined>((resolve) => {
              setTimeout(async () => { resolve(await refreshSong()); }, 400);
            });
          const { covered, coverable } = coverageOf(fresh?.lyrics_raw, fresh?.lyrics_translation);
          setTranslationProgress({
            requestDone,
            requestTotal: requestDone,
            covered,
            coverable,
          });
          setTranslationError(t('song.translationCancelled', { done: String(covered) }));
          showToast('info', t('song.translationCancelled', { done: String(covered) }));
        } finally {
          setTranslationSaving(false);
        }
        return;
      }
      const message = t('song.networkErrorAlert');
      setTranslationError(message);
      showToast('error', message);
    } finally {
      translateAbortRef.current = null;
      setTranslating(false);
    }
  }, [id, song, furiganaLinesLength, t, showToast, translating, refreshSong, coverageOf, setShowTranslation, setSong]);

  const cancelTranslate = useCallback(() => {
    translateAbortRef.current?.abort();
  }, []);

  // ── Translation prompt effect ───────────────────────────
  const translationPromptedRef = useRef(false);
  useEffect(() => {
    if (
      showTranslation &&
      song?.lyrics_raw?.trim() &&
      !hasTranslation &&
      !translating &&
      !translationPromptedRef.current
    ) {
      translationPromptedRef.current = true;
      const prompt = targetLang
        ? t('song.translationPrompt', { lang: targetLangDisplay(targetLang) })
        : t('song.translationPromptGeneric');
      showToast('info', prompt, t('song.translate'), () => {
        dismissToast();
        void handleTranslate();
      });
    }
  }, [showTranslation, song?.lyrics_raw, hasTranslation, translating, t, showToast, handleTranslate, targetLang, dismissToast]);

  // ── Auto-open reasoning panel ───────────────────────────
  useEffect(() => {
    if (!translationReasoning.trim() || reasoningUserHiddenRef.current) return;
    setShowTranslationReasoning(true);
  }, [translationReasoning]);

  const toggleTranslationReasoning = useCallback(() => {
    setShowTranslationReasoning((prev) => {
      const next = !prev;
      reasoningUserHiddenRef.current = !next;
      return next;
    });
  }, []);

  const openSavedReasoning = useCallback(() => {
    reasoningUserHiddenRef.current = false;
    setShowTranslationReasoning(true);
  }, []);

  const dismissTranslationError = useCallback(() => {
    setTranslationError(null);
    setTranslationProgress(null);
  }, []);

  const clearReasoning = useCallback(async () => {
    if (!song) return;
    try {
      const res = await fetch(`/api/songs/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clear_reasoning: true }),
      });
      const updated = await res.json();
      if (!res.ok) {
        showToast('error', t('song.clearFailed'));
        return;
      }
      setSong(updated);
      setTranslationReasoning('');
      setHasSavedReasoning(false);
      setShowTranslationReasoning(false);
      showToast('success', t('song.reasoningCleared'));
    } catch {
      showToast('error', t('song.clearFailed'));
    }
  }, [id, song, t, showToast, setSong]);

  const copyReasoning = useCallback(async () => {
    const text = translationReasoning.trim();
    if (!text) {
      showToast('error', t('song.copyReasoningEmpty'));
      return;
    }
    const ok = await copyToClipboard(text);
    showToast(ok ? 'success' : 'error', ok ? t('share.copied') : t('song.copyFailed'));
  }, [translationReasoning, t, showToast]);


  // Build a Markdown document from the persisted model thinking and download
  // it as {artist} - {title}.md so the reasoning can be archived/shared offline.
  const exportReasoning = useCallback(() => {
    const text = translationReasoning.trim();
    if (!text) {
      showToast('error', t('song.copyReasoningEmpty'));
      return;
    }
    const title = song?.title?.trim() || '';
    const artist = song?.artist?.trim() || '';
    const target = targetLang ? targetLangDisplay(targetLang) : '';
    // Compose a readable, self-contained Markdown file with song metadata.
    const parts = [
      `# ${title}`,
      artist ? `## ${artist}` : '',
      target ? `> ${t('song.translationTargetSection')}: ${target}` : '',
      '---',
      text,
      '',
    ].filter(Boolean);
    const markdown = parts.join('\n\n');

    // Strip characters that are unsafe / illegal in file names across the
    // target platforms (windows reserved ones, separators, quotes).
    const safeName = (s: string) =>
      s.replace(/[\\/:*?"<>|\n\r\t]/g, ' ').replace(/\s+/g, ' ').trim();
    const base = [artist, title, t('song.translationReasoning')].map(safeName).filter(Boolean).join(' - ');
    const filename = `${base || 'reasoning'}.md`;

    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
    showToast('success', t('song.reasoningExported'));
  }, [translationReasoning, song, targetLang, t, showToast]);

  return {
    translations,

    hasTranslation,
    untranslatedCount,
    translatedCount,
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
    exportReasoning,
    dismissTranslationError,
    clearReasoning,
    handleTranslate,
    cancelTranslate,
    targetLang,
    targetLangOverride,
    setTargetLang,
    seedFromLoad,
  };
}
