'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import type { CoverPaletteJson, FuriganaLine, ReadingMode, ReadingScheme } from '@/lib/types';
import { mapTimelineTimestamps, parseLrc } from '@/lib/lrc';
import type { SpotifyState } from './useSpotifySync';
import { readTranslationStream, type TranslationProgress } from '@/lib/translation-stream';
import { TRANSLATION_ERROR_KEYS } from '@/lib/translation-errors';
import { useI18n } from '@/lib/i18n';
import { buildManualCreateUrl } from '@/lib/song-prefill';
import {
  convertLyricsReading,
  detectCantoneseLyrics,
  normalizeReadingScheme,
  type CantoneseDetectionResult,
} from '@/lib/lyrics-reading';
import {
  isKatakanaReadingSegment,
  isKoreanReadingSegment,
  normalizeFuriganaSegments,
  resolveFuriganaReading,
  splitLyricScriptRuns,
} from '@/lib/romaji';

const LYRICS_SOURCE_KEYS: Record<string, string> = {
  manual: 'lyricsSources.manual',
  none: 'lyricsSources.none',
  'lrclib-exact': 'lyricsSources.lrclibExact',
  'lrclib-canonical': 'lyricsSources.lrclibCanonical',
  'lrclib-search': 'lyricsSources.lrclibSearch',
  petitlyrics: 'lyricsSources.petitlyrics',
  utanet: 'lyricsSources.utanet',
  ytmusic: 'lyricsSources.ytmusic',
};

const escapeHtml = (value: string) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

function createPlainFuriganaLines(rawLyrics: string): FuriganaLine[] {
  return rawLyrics.split('\n').map((line) => ({
    segments: line.trim()
      ? splitLyricScriptRuns(line).map((text) => ({ text, reading: '' }))
      : [],
  }));
}

interface SongData {
  id: string;
  title: string;
  artist: string;
  lyrics_raw: string;
  lyrics_furigana: string;
  reading_scheme: ReadingScheme;
  reading_scheme_confirmed: number;
  lyrics_synced: string;
  lyrics_translation: string;
  lyrics_translation_reasoning?: string | null;
  cover_url?: string | null;
  cover_palette?: CoverPaletteJson | null;
  spotify_track_id?: string | null;
  spotify_uri?: string | null;
  spotify_album?: string | null;
  spotify_duration_ms?: number | null;
  spotify_canonical_title?: string | null;
  spotify_canonical_artist?: string | null;
  lyrics_source: string;
  lyrics_confidence: number;
  lyrics_fetched_at: string | null;
  permissions?: { can_edit: boolean };
  is_public: number;
  public_requested: number;
  created_at: string;
  updated_at: string;
}

interface ToastState {
  type: 'success' | 'error' | 'info';
  msg: string;
  actionLabel?: string;
  onAction?: () => void;
}

export interface ImportAlertState {
  message: string;
  manualCreateUrl?: string;
}

export interface UseSongDataReturn {
  song: SongData | null;
  loading: boolean;
  refreshSong: () => Promise<void>;
  syncLines: ReturnType<typeof parseLrc>;
  furiganaLines: FuriganaLine[];
  translations: string[];
  showTranslation: boolean;
  setShowTranslation: React.Dispatch<React.SetStateAction<boolean>>;
  translating: boolean;
  translationError: string | null;
  translationProgress: TranslationProgress | null;
  translationReasoning: string;
  showTranslationReasoning: boolean;
  setShowTranslationReasoning: (show: boolean) => void;
  toggleTranslationReasoning: () => void;
  hasSavedReasoning: boolean;
  openSavedReasoning: () => void;
  copyReasoning: () => Promise<void>;
  dismissTranslationError: () => void;
  clearFurigana: () => Promise<void>;
  clearTranslation: () => Promise<void>;
  handleTranslate: () => Promise<void>;
  furiganaLoading: boolean;
  furiganaError: string;
  lineTimestamps: (number | null)[];
  syncing: boolean;
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
  fontSize: number;
  setFontSize: React.Dispatch<React.SetStateAction<number>>;
  toast: ToastState | null;
  allSongs: { id: string; title: string; artist: string; spotify_track_id?: string | null; created_by: string; is_public: number }[];
  handleSync: () => Promise<void>;
  lowConfidenceSync: { source: string; confidence: number; lines: number; lrc: string } | null;
  confirmLowConfidenceSync: () => void;
  cancelLowConfidenceSync: () => void;
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
  showToast: (type: 'success' | 'error', msg: string) => void;
}

export function useSongData(id: string): UseSongDataReturn {
  const router = useRouter();
  const { t } = useI18n();

  const [song, setSong] = useState<SongData | null>(null);
  const [loading, setLoading] = useState(true);
  const [readingMode, setReadingMode] = useState<ReadingMode>(() => {
    if (typeof window === 'undefined') return 'furigana';
    const saved = localStorage.getItem('jplrc-reading-mode');
    return saved === 'original' ? 'original' : 'furigana';
  });
  const [romanizeFurigana, setRomanizeFurigana] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('jplrc-romanize-furigana') === 'true'
      || localStorage.getItem('jplrc-reading-mode') === 'romaji';
  });
  const [debug, setDebug] = useState(false);
  const [showTranslation, setShowTranslation] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('jplrc-show-translation') === 'true';
  });
  const [translating, setTranslating] = useState(false);
  const [translationError, setTranslationError] = useState<string | null>(null);
  const [translationProgress, setTranslationProgress] = useState<TranslationProgress | null>(null);
  const [translationReasoning, setTranslationReasoning] = useState('');
  const [showTranslationReasoning, setShowTranslationReasoning] = useState(false);
  // Track whether any reasoning was persisted server-side for this song. When
  // set, the 「查看翻译过程」 menu row re-opens the stored reasoning on demand
  // (even after a reload / after the stream finished).
  const [hasSavedReasoning, setHasSavedReasoning] = useState(false);
  // Auto-open the reasoning panel when the model starts emitting reasoning,
  // but never fight an explicit user collapse during the same session.
  const reasoningUserHiddenRef = useRef(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [importAlert, setImportAlert] = useState<ImportAlertState | null>(null);
  const [syncLines, setSyncLines] = useState<ReturnType<typeof parseLrc>>([]);
  const [syncing, setSyncing] = useState(false);
  const [importing, setImporting] = useState(false);
  // Pending fuzzy-search sync result waiting for explicit user confirmation
  // (server refuses to overwrite lyrics below the confidence threshold).
  const [lowConfidenceSync, setLowConfidenceSync] = useState<{
    source: string;
    confidence: number;
    lines: number;
    lrc: string;
  } | null>(null);
  const [allSongs, setAllSongs] = useState<{ id: string; title: string; artist: string; spotify_track_id?: string | null; created_by: string; is_public: number }[]>([]);
  const [copied, setCopied] = useState(false);
  const [fontSize, setFontSize] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('jplrc-font-size');
      if (saved) { const n = parseInt(saved); if (n >= 14 && n <= 32) return n; }
    }
    return 20;
  });


  // Persist font size
  useEffect(() => { localStorage.setItem('jplrc-font-size', String(fontSize)); }, [fontSize]);
  useEffect(() => { localStorage.setItem('jplrc-reading-mode', readingMode); }, [readingMode]);
  useEffect(() => { localStorage.setItem('jplrc-romanize-furigana', String(romanizeFurigana)); }, [romanizeFurigana]);
  useEffect(() => { localStorage.setItem('jplrc-show-translation', String(showTranslation)); }, [showTranslation]);

  // Derived
  const serverFurigana = useMemo<FuriganaLine[]>(() => {
    if (!song?.lyrics_furigana) return [];
    try { return JSON.parse(song.lyrics_furigana); } catch { return []; }
  }, [song]);

  const translations = useMemo<string[]>(() => {
    if (!song?.lyrics_translation) return [];
    try {
      const parsed = JSON.parse(song.lyrics_translation);
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
    } catch { return []; }
  }, [song]);

  // Client-side furigana (lazy-loaded from kuromoji-es CDN when needed)
  const requestedLyricsRef = useRef('');
  const [clientFuriganaState, setClientFuriganaState] = useState<{
    source: string;
    lines: FuriganaLine[];
    loading: boolean;
    error: string;
  }>({ source: '', lines: [], loading: false, error: '' });
  const lyricsRaw = song?.lyrics_raw ?? '';
  const readingScheme = normalizeReadingScheme(song?.reading_scheme);
  const hasHanCharacters = /[\u3400-\u4DBF\u4E00-\u9FFF]/.test(lyricsRaw);
  const detectedCantonese = useMemo(() => detectCantoneseLyrics(lyricsRaw), [lyricsRaw]);
  const cantoneseSuggestion = song?.permissions?.can_edit
    && readingScheme === 'ja-kana'
    && song.reading_scheme_confirmed !== 1
    && detectedCantonese.confidence === 'high'
    ? detectedCantonese
    : null;
  const readingSourceKey = `${readingScheme}\u0000${lyricsRaw}`;
  const plainFuriganaLines = useMemo(() => createPlainFuriganaLines(lyricsRaw), [lyricsRaw]);
  const isCurrentClientResult = clientFuriganaState.source === readingSourceKey;
  const furiganaLoading = isCurrentClientResult && clientFuriganaState.loading;
  const furiganaError = isCurrentClientResult ? clientFuriganaState.error : '';

  const furiganaLines = useMemo<FuriganaLine[]>(() => {
    // Prefer server-side pre-computed data (existing songs)
    if (serverFurigana.length > 0) return serverFurigana;
    // Fall back to client-side computed data for this exact lyrics value.
    if (clientFuriganaState.source === readingSourceKey && clientFuriganaState.lines.length > 0) {
      return clientFuriganaState.lines;
    }
    // Korean and kana can be romanized immediately without loading the Japanese tokenizer.
    return plainFuriganaLines;
  }, [serverFurigana, clientFuriganaState, readingSourceKey, plainFuriganaLines]);

  // Client-side furigana conversion: only once per lyrics value when server data is absent.
  useEffect(() => {
    if (!lyricsRaw.trim() || serverFurigana.length > 0 || !hasHanCharacters || cantoneseSuggestion) return;
    const requestKey = `${id}\u0000${readingSourceKey}`;
    if (requestedLyricsRef.current === requestKey) return;
    requestedLyricsRef.current = requestKey;
    let cancelled = false;
    let settled = false;

    const convert = async () => {
      // Cross an async boundary so this state transition belongs to the conversion request.
      await Promise.resolve();
      if (cancelled) return;
      setClientFuriganaState({ source: readingSourceKey, lines: [], loading: true, error: '' });
      try {
        const lines = await convertLyricsReading(lyricsRaw, readingScheme);
        if (cancelled) return;
        settled = true;
        setClientFuriganaState({ source: readingSourceKey, lines, loading: false, error: '' });
        // Persist to server so next load skips kuromoji entirely
        if (lines.length > 0 && id && song?.permissions?.can_edit) {
          fetch(`/api/songs/${id}/furigana`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              lyrics_furigana: lines,
              reading_scheme: readingScheme,
              source_lyrics: lyricsRaw,
            }),
          }).catch(() => {}); // fire-and-forget
        }
      } catch (error) {
        if (cancelled) return;
        settled = true;
        console.error('Client furigana conversion failed:', error);
        setClientFuriganaState({ source: readingSourceKey, lines: [], loading: false, error: t('song.furiganaLoadFailed') });
      }
    };

    void convert();
    return () => {
      cancelled = true;
      if (!settled && requestedLyricsRef.current === requestKey) requestedLyricsRef.current = '';
    };
  }, [lyricsRaw, serverFurigana.length, hasHanCharacters, cantoneseSuggestion, id, readingScheme, readingSourceKey, song?.permissions?.can_edit, t]);

  const lineTimestamps = useMemo(() => {
    if (!song || !furiganaLines.length) return [] as (number | null)[];
    const renderedRows = furiganaLines.map((line) => line.segments.map((segment) => segment.text).join(''));
    return mapTimelineTimestamps(renderedRows, song.lyrics_raw || '', song.lyrics_synced || '');
  }, [song, furiganaLines]);

  const showToast = useCallback((type: 'success' | 'error' | 'info', msg: string, actionLabel?: string, onAction?: () => void) => {
    setToast({ type, msg, actionLabel, onAction });
    // Action toasts stay longer so the user has time to react.
    setTimeout(() => setToast(null), actionLabel ? 8000 : 3000);
  }, []);

  const updateReadingPreference = useCallback(async (payload: {
    reading_scheme?: ReadingScheme;
    reading_scheme_confirmed: boolean;
  }) => {
    const response = await fetch(`/api/songs/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error('reading_scheme_update_failed');
    const updated = await response.json() as SongData;
    requestedLyricsRef.current = '';
    setClientFuriganaState({ source: '', lines: [], loading: false, error: '' });
    setSong(updated);
  }, [id]);

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

  // Refresh song data (e.g. after request-public)
  const refreshSong = useCallback(async () => {
    try {
      const res = await fetch(`/api/songs/${id}`);
      if (res.ok) {
        const data = await res.json();
        setSong(data);
        if (data.lyrics_synced) setSyncLines(parseLrc(data.lyrics_synced));
      }
    } catch {}
  }, [id]);

  // Fetch song + all songs on mount
  useEffect(() => {
    if (!id) return;
    fetch(`/api/songs/${id}`)
      .then((r) => { if (!r.ok) throw new Error('Not found'); return r.json(); })
      .then((data) => {
        setSong(data);
        setLoading(false);
        if (data.lyrics_translation_reasoning) {
          setTranslationReasoning(data.lyrics_translation_reasoning);
          setHasSavedReasoning(true);
          // Persisted reasoning is reviewed on demand via the menu row — never
          // auto-open it on page load (it would cover the lyrics).
          reasoningUserHiddenRef.current = true;
        }
        if (data.lyrics_synced) setSyncLines(parseLrc(data.lyrics_synced));
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
      })
      .catch(() => setLoading(false));

    fetch('/api/songs')
      .then((r) => r.json())
      .then((data) => setAllSongs(data.map((s: { id: string; title: string; artist: string; spotify_track_id?: string | null; created_by?: string; is_public?: number }) => ({ id: s.id, title: s.title, artist: s.artist, spotify_track_id: s.spotify_track_id, created_by: s.created_by || '', is_public: s.is_public || 0 }))))
      .catch(() => {});
  }, [id]);

  // Handlers
  const applySyncResult = useCallback(async (data: {
    source: string;
    lines: number;
    lrc: string;
  }) => {
    const songRes = await fetch(`/api/songs/${id}`);
    if (songRes.ok) {
      const updated = await songRes.json();
      setSong(updated);
      setSyncLines(parseLrc(data.lrc));
    }
    const sourceKey = LYRICS_SOURCE_KEYS[data.source];
    showToast('success', t('song.synced', {
      source: sourceKey ? t(sourceKey) : data.source,
      lines: String(data.lines),
    }));
  }, [id, t, showToast]);

  const runSync = useCallback(async (force: boolean) => {
    setSyncing(true);
    try {
      const res = await fetch(`/api/songs/${id}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
      });
      const data = await res.json();
      // Fuzzy search below the confidence threshold: the server keeps the
      // current lyrics untouched — ask before overriding (furigana and
      // translation would be reset too).
      if (data.lowConfidence) {
        setLowConfidenceSync({
          source: data.source,
          confidence: data.confidence,
          lines: data.lines,
          lrc: data.lrc,
        });
        return;
      }
      if (data.synced) {
        await applySyncResult(data);
      } else {
        const errorKey: Record<string, string> = {
          lyrics_not_found: 'apiErrors.lyricsNotFound',
          forbidden: 'apiErrors.forbidden',
          login_required: 'apiErrors.loginRequired',
        };
        const message = data.error && errorKey[data.error]
          ? t(errorKey[data.error])
          : t('song.syncNotFound');
        setImportAlert({ message });
      }
    } catch {
      setImportAlert({ message: t('song.networkErrorAlert') });
    } finally {
      setSyncing(false);
    }
  }, [id, t, showToast, applySyncResult]);

  const handleSync = useCallback(() => runSync(false), [runSync]);

  const confirmLowConfidenceSync = useCallback(() => {
    setLowConfidenceSync(null);
    void runSync(true);
  }, [runSync]);

  const cancelLowConfidenceSync = useCallback(() => setLowConfidenceSync(null), []);


  const handleTranslate = useCallback(async () => {
    if (translating) return;
    const total = furiganaLines.length;
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
    try {
      // Whole song in ONE request, streamed via SSE: the model sees the full
      // lyrics (coherent context) and its live reasoning/translation deltas
      // are shown in the expandable panel. The server skips already-translated
      // lines (cache/dedup), so this same call also serves as resume/retry.
      const res = await fetch(`/api/songs/${id}/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stream: true }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? 'translation_failed');
      }

      // Live per-line progress while the model streams its translation array.
      // The server reports { done, total } over the DISTINCT lines it still
      // needs to translate (repeats reuse one translation), so show those
      // numbers as-is — "done/total" reaches completion when the stream ends.
      const onProgress = (progress: TranslationProgress) => {
        setTranslationProgress(progress);
      };
      // Local accumulator mirrors the streamed reasoning so the error path
      // below can check whether any reasoning was produced (state is async).
      let streamedReasoning = '';
      const { translations, error: streamError, progress: errorProgress } = await readTranslationStream(
        res.body,
        (delta) => {
          streamedReasoning += delta;
          setTranslationReasoning((prev) => prev + delta);
        },
        onProgress,
      );
      const reasoningStreamed = streamedReasoning.length > 0;

      if (translations) {
        setTranslationProgress(null);
        // Only advertise the persisted-reasoning menu row when the model
        // actually produced reasoning (cached hits stream none). The panel
        // stays open on its own — don't fight an explicit collapse.
        if (reasoningStreamed) setHasSavedReasoning(true);
        const seed: (string | null)[] = Array(total).fill(null);
        try {
          const parsed = JSON.parse(song?.lyrics_translation ?? '[]');
          if (Array.isArray(parsed)) {
            parsed.forEach((item, i) => { if (i < total && typeof item === 'string') seed[i] = item; });
          }
        } catch { /* keep empty seed */ }
        translations.forEach((tr: string, i: number) => { if (i < total) seed[i] = tr; });
        setSong((prev) => prev ? { ...prev, lyrics_translation: JSON.stringify(seed) } : prev);
        setShowTranslation(true);
        showToast('success', t('song.translationReady'));
        return;
      }

      const errorKey = TRANSLATION_ERROR_KEYS;
      const message = streamError && errorKey[streamError]
        ? t(errorKey[streamError])
        : t('song.translationFailed');
      // On failure the server persists whatever lines streamed in before the
      // error; report progress so the error pill shows the "continue" button
      // and a real done/total count (断点续译入口). Refresh the song from the
      // server so partial translations already persisted become visible.
      if (errorProgress) {
        setTranslationProgress(errorProgress);
        if (errorProgress.done > 0) await refreshSong();
      } else {
        setTranslationProgress(null);
      }
      // The server persists whatever reasoning streamed before the failure;
      // keep the flag on so the menu can re-open it even after an error.
      if (reasoningStreamed) setHasSavedReasoning(true);
      setTranslationError(message);
      showToast('error', message);
    } catch {
      const message = t('song.networkErrorAlert');
      setTranslationError(message);
      showToast('error', message);
    } finally {
      setTranslating(false);
    }
  }, [id, song, furiganaLines, t, showToast, translating, refreshSong]);

  // When the translation display is on but the song has no translation yet,
  // offer to translate it (once per page visit).
  const translationPromptedRef = useRef(false);
  useEffect(() => {
    if (
      showTranslation &&
      song?.lyrics_raw?.trim() &&
      translations.length === 0 &&
      !translating &&
      !translationPromptedRef.current
    ) {
      translationPromptedRef.current = true;
      // The business callback owns toast dismissal: tapping 「翻译」 hides the
      // prompt toast (the generic Toast component stays action-agnostic).
      showToast('info', t('song.translationPrompt'), t('song.translate'), () => {
        setToast(null);
        void handleTranslate();
      });
    }
  }, [showTranslation, song?.lyrics_raw, translations.length, translating, t, showToast, handleTranslate]);


  // Auto-open the reasoning panel as soon as the model starts streaming
  // reasoning — unless the user has explicitly collapsed it this session.
  useEffect(() => {
    if (!translationReasoning.trim() || reasoningUserHiddenRef.current) return;
    setShowTranslationReasoning(true);
  }, [translationReasoning, setShowTranslationReasoning]);

  const toggleTranslationReasoning = useCallback(() => {
    setShowTranslationReasoning((prev) => {
      const next = !prev;
      // Collapsing stops the auto-reopen; re-showing re-enables it.
      reasoningUserHiddenRef.current = !next;
      return next;
    });
  }, []);

  // The menu row 「查看翻译过程」: open the persisted reasoning overlay. If a
  // translate is currently running, show the live stream; otherwise show the
  // stored reasoning from the last run.
  const openSavedReasoning = useCallback(() => {
    reasoningUserHiddenRef.current = false;
    setShowTranslationReasoning(true);
  }, []);

  const dismissTranslationError = useCallback(() => {
    setTranslationError(null);
    setTranslationProgress(null);
  }, []);

  /** Debug tooling: wipe the furigana cache so annotations regenerate. */
  const clearFurigana = useCallback(async () => {
    if (!song) return;
    try {
      const res = await fetch(`/api/songs/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clear_furigana: true }),
      });
      const updated = await res.json();
      if (!res.ok || !updated?.lyrics_furigana) {
        showToast('error', t('song.clearFailed'));
        return;
      }
      requestedLyricsRef.current = '';
      setSong(updated);
      showToast('success', t('song.furiganaCleared'));
    } catch {
      showToast('error', t('song.clearFailed'));
    }
  }, [id, song, t, showToast]);

  /** Debug tooling: wipe the translation cache so it can be regenerated. */
  const clearTranslation = useCallback(async () => {
    if (!song) return;
    try {
      const res = await fetch(`/api/songs/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clear_translation: true }),
      });
      const updated = await res.json();
      if (!res.ok || !updated?.lyrics_translation) {
        showToast('error', t('song.clearFailed'));
        return;
      }
      setSong(updated);
      setTranslationReasoning('');
      setHasSavedReasoning(false);
      setShowTranslationReasoning(false);
      showToast('success', t('song.translationCleared'));
    } catch {
      showToast('error', t('song.clearFailed'));
    }
  }, [id, song, t, showToast]);

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
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      showToast('success', t('share.copied'));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast('error', t('song.copyFailed'));
    }
  }, [song, furiganaLines, translations, t, showToast]);

  /** Copy the translation reasoning (live or persisted) to the clipboard. */
  const copyReasoning = useCallback(async () => {
    const text = translationReasoning.trim();
    if (!text) {
      showToast('error', t('song.copyReasoningEmpty'));
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      showToast('success', t('share.copied'));
    } catch {
      showToast('error', t('song.copyFailed'));
    }
  }, [translationReasoning, t, showToast]);

  const handleImportPlaying = useCallback(async (spotify: SpotifyState | null) => {
    if (!spotify?.track) return;
    setImporting(true);
    try {
      const res = await fetch('/api/songs/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: spotify.track.name, artist: spotify.track.artist, spotify_track_id: spotify.track.id }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        const errorKey: Record<string, string> = {
          title_required: 'home.importTitleRequired',
          lyrics_not_found: 'home.importLyricsNotFound',
          login_required: 'home.importLoginRequired',
        };
        setImportAlert({
          message: data.error && errorKey[data.error]
            ? t(errorKey[data.error])
            : t('song.importFailed'),
          manualCreateUrl: buildManualCreateUrl(data),
        });
        return;
      }
      router.push(`/songs/${data.id}`);
    } catch {
      showToast('error', t('song.importFailed'));
    } finally {
      setImporting(false);
    }
  }, [router, t, showToast]);

  // PiP is complex and needs external refs, so it's a callback the page calls with context
  const openPiP = useCallback(async (
    furiganaLinesArg: FuriganaLine[],
    songArg: SongData | null,
    highlightLine: number,
    pipWindowRef: React.MutableRefObject<Window | null>,
    timestamps?: (number | null)[],
  ) => {
    if (pipWindowRef.current && !pipWindowRef.current.closed) {
      pipWindowRef.current.close();
      pipWindowRef.current = null;
      return;
    }

    if (!('documentPictureInPicture' in window)) {
      showToast('error', t('song.pipUnsupported'));
      return;
    }

    if (furiganaLinesArg.length === 0) {
      showToast('error', t('song.noLyrics'));
      return;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pipWindow = await (window as any).documentPictureInPicture.requestWindow({
        width: 380,
        height: 520,
      });

      pipWindowRef.current = pipWindow;

      const title = escapeHtml(songArg?.title || '');
      const artist = escapeHtml(songArg?.artist || '');

      pipWindow.document.documentElement.innerHTML = `
        <head>
          <meta name="color-scheme" content="dark">
          <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500&display=swap" rel="stylesheet">
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            html, body { background: #0a0a0a; color: #a3a3a3; font-family: 'Noto Sans JP', sans-serif; height: 100%; overflow: hidden; }
            #pip-header { padding: 8px 12px; border-bottom: 1px solid #262626; font-size: 11px; color: #737373; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            #pip-header .title { color: #e5e5e5; font-weight: 500; }
            #pip-lyrics { height: calc(100% - 36px); overflow-y: auto; padding: 12px; scroll-behavior: smooth; }
            .line { line-height: 2.2; padding: 2px 4px; border-radius: 4px; transition: color 0.3s, transform 0.3s, opacity 0.3s; transform-origin: left; opacity: 0.6; font-size: ${fontSize}px; }
            .line.has-ts { cursor: pointer; }
            .line.has-ts:hover { color: #e5e5e5; opacity: 0.9; }
            @keyframes lyricActivate { 0% { transform: scale(1); filter: brightness(1); } 40% { transform: scale(1.06); filter: brightness(1.25); } 100% { transform: scale(1.03); filter: brightness(1); } }
            .line.active { color: #ffffff; transform: scale(1.03); opacity: 1; font-weight: 700; animation: lyricActivate 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) forwards; }
            .line.empty { height: 1.5em; }
            ruby rt { font-size: 0.5em; color: #a3a3a3; }
            ruby.korean-word rt { padding-inline: 0.16em; }
            ruby.cantonese-reading { ruby-overhang: none; white-space: nowrap; }
            ruby.cantonese-reading rt { padding-inline: 0.08em; }
            ruby.katakana-chunk { ruby-overhang: none; white-space: nowrap; }
            .line.active ruby rt { color: #d4d4d4; }
          </style>
        </head>
        <body>
          <div id="pip-header"><span class="title">${title}</span>${artist ? ` — ${artist}` : ''}</div>
          <div id="pip-lyrics">
            ${furiganaLinesArg.map((line, i) => {
              if (line.segments.length === 0) return `<div class="line empty" data-line="${i}"></div>`;
              const html = normalizeFuriganaSegments(line.segments).map(seg => {
                if (readingMode === 'original') return escapeHtml(seg.text);
                const scheme = normalizeReadingScheme(songArg?.reading_scheme);
                const reading = resolveFuriganaReading(seg.text, seg.reading, romanizeFurigana, scheme);
                if (!reading) return escapeHtml(seg.text);
                const rubyClass = scheme === 'yue-jyutping'
                  ? 'cantonese-reading'
                  : romanizeFurigana && isKoreanReadingSegment(seg.text)
                    ? 'korean-word'
                    : romanizeFurigana && isKatakanaReadingSegment(seg.text) ? 'katakana-chunk' : '';
                const className = rubyClass ? ` class="${rubyClass}"` : '';
                const language = scheme === 'yue-jyutping' ? ' lang="yue-Latn"' : '';
                return `<ruby${className}>${escapeHtml(seg.text)}<rp>(</rp><rt${language}>${escapeHtml(reading)}</rt><rp>)</rp></ruby>`;
              }).join('');
              const ts = timestamps?.[i];
              const tsAttr = ts != null ? ` data-ts="${ts}"` : '';
              const tsClass = ts != null ? ' has-ts' : '';
              return `<div class="line${tsClass}" data-line="${i}"${tsAttr}>${html}</div>`;
            }).join('')}
          </div>
        </body>
      `;

      // Add click-to-seek handler in PiP
      if (timestamps?.some(t => t != null)) {
        const script = pipWindow.document.createElement('script');
        script.textContent = `
          document.getElementById('pip-lyrics').addEventListener('click', function(e) {
            var line = e.target.closest('.line.has-ts');
            if (!line) return;
            var ts = line.getAttribute('data-ts');
            if (ts && window.opener && !window.opener.closed) {
              window.opener.postMessage({ type: 'pip-seek', position_ms: parseInt(ts) }, '*');
            }
          });
        `;
        pipWindow.document.body.appendChild(script);

        // Listen for seek messages from PiP in main window
        const onPipMessage = (e: MessageEvent) => {
          if (e.data?.type === 'pip-seek' && typeof e.data.position_ms === 'number') {
            fetch('/api/spotify/seek', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ position_ms: e.data.position_ms }),
            }).catch(() => {});
          }
        };
        window.addEventListener('message', onPipMessage);
        pipWindow.addEventListener('pagehide', () => {
          window.removeEventListener('message', onPipMessage);
          pipWindowRef.current = null;
        });
      } else {
        pipWindow.addEventListener('pagehide', () => {
          pipWindowRef.current = null;
        });
      }

      // Sync current active line immediately
      if (highlightLine >= 0) {
        const pipLines = pipWindow.document.querySelectorAll('.line');
        pipLines.forEach((el: Element, i: number) => {
          if (i === highlightLine) {
            (el as HTMLElement).classList.add('active');
            el.scrollIntoView({ block: 'center' });
          }
        });
      }
    } catch (e) {
      console.error('PiP failed:', e);
      showToast('error', t('song.pipFailed'));
    }
  }, [fontSize, readingMode, romanizeFurigana, t, showToast]);

  // Re-center when debug mode toggled off
  useEffect(() => {
    // This effect needs activeLine from the sync hook — the page will handle it
  }, [debug]);

  return {
    song,
    loading,
    refreshSong,
    syncLines,
    furiganaLines,
    translations,
    showTranslation,
    setShowTranslation,
    translating,
    translationError,
    translationProgress,
    translationReasoning,
    showTranslationReasoning,
    setShowTranslationReasoning,
    toggleTranslationReasoning,
    hasSavedReasoning,
    openSavedReasoning,
    copyReasoning,
    dismissTranslationError,
    clearFurigana,
    clearTranslation,
    handleTranslate,
    furiganaLoading,
    furiganaError,
    lineTimestamps,
    syncing,
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
    fontSize,
    setFontSize,
    toast,
    allSongs,
    handleSync,
    lowConfidenceSync,
    confirmLowConfidenceSync,
    cancelLowConfidenceSync,
    handleDelete,
    confirmDelete,
    handleCopy,
    handleImportPlaying,
    openPiP,
    showToast,
  };
}
