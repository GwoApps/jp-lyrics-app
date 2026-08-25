'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import type { CoverPaletteJson, FuriganaLine, ReadingMode, ReadingScheme } from '@/lib/types';
import type { SyncStage } from '@/lib/lyrics-fetcher';
import type { ProviderStage } from '@/lib/lyrics-provider/types';
import { mapTimelineTimestamps, parseLrc } from '@/lib/lrc';
import type { SpotifyState } from './useSpotifySync';
import { readTranslationStream, type TranslationProgress } from '@/lib/translation-stream';
import { readSseFrames } from '@/lib/sse-reader';
import { TRANSLATION_ERROR_KEYS } from '@/lib/translation-errors';
import { useI18n } from '@/lib/i18n';
import { buildManualCreateUrl } from '@/lib/song-prefill';
import {
  convertLyricsReading,
  detectCantoneseLyrics,
  normalizeReadingScheme,
  type CantoneseDetectionResult,
} from '@/lib/lyrics-reading';
import { parseTranslationCache } from '@/lib/translation/parse';
import {
  isKatakanaReadingSegment,
  isKoreanReadingSegment,
  normalizeFuriganaSegments,
  resolveFuriganaReading,
  splitLyricScriptRuns,
} from '@/lib/romaji';
import { LYRICS_SOURCE_KEYS } from '@/lib/lyrics-source';
import { copyToClipboard } from '@/lib/clipboard';
import { isKnownTargetLang } from '@/lib/target-lang';

// The sync response is an untyped union of outcomes (not-found, plain-hit
// preview, low-confidence preview, direct write, rate-limit…). Its shape is
// intentionally loose (mirrors the previous `res.json()` behaviour), so the
// result body is typed `any`; the exact fields are read in flag-checked
// branches in `runSync`.
/* eslint-disable @typescript-eslint/no-explicit-any -- SSE payload is intentionally untyped. */
/**
 * Read the Server-Sent Events response produced by the sync route. Emits each
 * `stage` event to `onStage` (so the UI can show "正在查询 LRCLIB…" live) and
 * resolves with the payload of the terminal `result` / `error` event — the same
 * object the previous plain-JSON response carried, plus its HTTP status.
 */
async function readSyncEventStream(
  res: Response,
  onStage: (stage: SyncStage | ProviderStage) => void,
): Promise<{ status: number; body: any }> {
  const body = res.body;
  if (!body) {
    // Not a stream (e.g. an early JSON error before streaming began) — read as JSON.
    const jsonBody = await res.json();
    return { status: res.status, body: jsonBody };
  }
  let terminal: { status: number; body: any } | null = null;
  for await (const { event, data: dataStr } of readSseFrames(body)) {
    let payload: { status?: number; stage?: SyncStage | ProviderStage; body?: any };
    try {
      payload = JSON.parse(dataStr);
    } catch {
      continue;
    }
    if (event === 'stage' && payload.stage) {
      onStage(payload.stage);
    } else if (event === 'result' || event === 'error') {
      terminal = { status: payload.status ?? res.status, body: payload.body ?? payload };
      break;
    }
  }
  // Defensive: if the stream ended without a terminal event, surface a generic error.
  if (!terminal) {
    return { status: res.status || 500, body: { synced: false, error: 'network_error' } };
  }
  return terminal;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

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
  lyrics_translation_lang?: string | null;
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
  lyrics_needs_review: number;
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

/** Pending low-confidence import candidate waiting for explicit user confirmation. */
export interface ImportReviewState {
  title: string;
  artist: string;
  spotifyTrackId?: string;
  source: string;
  confidence: number;
  lines: number;
  preview: string;
  synced: boolean;
  /** Metadata of the actually-matched song (e.g. Uta-Net) for human judgment. */
  match?: { title: string; artist: string; link: string; ambiguous?: boolean };
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

  const [song, setSong] = useState<SongData | null>(null);
  const [loading, setLoading] = useState(true);
  // True when the detail fetch failed for a retryable reason (HTTP 5xx/429 or
  // network/timeout). A 404 (genuinely absent song) keeps `song=null` and is
  // shown as "not found" — distinct from a load error.
  const [loadError, setLoadError] = useState(false);
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
  // True while re-reading the server's final persisted result after a cancel /
  // error so the UI can show "正在保存已完成部分" instead of a guessed number.
  const [translationSaving, setTranslationSaving] = useState(false);
  const [translationError, setTranslationError] = useState<string | null>(null);
  const [translationProgress, setTranslationProgress] = useState<TranslationProgress | null>(null);
  // Opaque preparation stage shown while the server warms up before streaming
  // (glossary extraction). Only a boolean-ish "preparing" notice is surfaced
  // to the user — the raw stage name never is (issue #172).
  const [translationStage, setTranslationStage] = useState<string | null>(null);
  const [translationReasoning, setTranslationReasoning] = useState('');
  // Tracks the in-flight translate request so the user can cancel a long
  // whole-song translation (or stop an accidental one) without reloading.
  const translateAbortRef = useRef<AbortController | null>(null);
  // Mirrors the latest streamed done-count so the cancellation path can
  // report the real number of saved lines (state reads are async/stale).
  const translationDoneRef = useRef(0);
  const [showTranslationReasoning, setShowTranslationReasoning] = useState(false);
  // Track whether any reasoning was persisted server-side for this song. When
  // set, the 「查看翻译过程」 menu row re-opens the stored reasoning on demand
  // (even after a reload / after the stream finished).
  const [hasSavedReasoning, setHasSavedReasoning] = useState(false);
  // Auto-open the reasoning panel when the model starts emitting reasoning,
  // but never fight an explicit user collapse during the same session.
  const reasoningUserHiddenRef = useRef(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [importAlert, setImportAlert] = useState<ImportAlertState | null>(null);
  const [importReview, setImportReview] = useState<ImportReviewState | null>(null);
  const [syncLines, setSyncLines] = useState<ReturnType<typeof parseLrc>>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncStage, setSyncStage] = useState<SyncStage | ProviderStage | null>(null);
  // Tracks the in-flight sync request so the user can cancel a long
  // multi-source fetch (or stop an accidental one) without reloading, and so
  // the request is aborted when the component unmounts.
  const syncAbortRef = useRef<AbortController | null>(null);
  const [importing, setImporting] = useState(false);
  // Pending fuzzy-search sync result waiting for explicit user confirmation
  // (server refuses to overwrite lyrics below the confidence threshold).
  const [lowConfidenceSync, setLowConfidenceSync] = useState<{
    source: string;
    confidence: number;
    lines: number;
    lrc: string;
    candidate: string;
    match?: ImportReviewState['match'];
  } | null>(null);
  // Pending plain-text sync result (no LRC timeline) waiting for explicit user
  // confirmation (server refuses to overwrite lyrics/timeline without it).
  const [plainHitSync, setPlainHitSync] = useState<{
    source: string;
    confidence: number;
    plain: string;
    candidate: string;
    match?: ImportReviewState['match'];
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [fontSize, setFontSize] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('jplrc-font-size');
      if (saved) { const n = parseInt(saved); if (n >= 14 && n <= 32) return n; }
    }
    return 20;
  });
  // Effective target language for translation (user setting → global default).
  // null until the settings are loaded.
  const [targetLang, setTargetLangState] = useState<string | null>(null);
  // The user's own translation-target override ('' = follow system default).
  const [targetLangOverride, setTargetLangOverride] = useState('');

  // Defense-in-depth: only surface a known target language to the inline
  // switch. Server-side validation already rejects dirty values; this guards
  // against legacy rows that predate the fix, so a forged override can never
  // be echoed into the UI. Admin/global custom values are resolved server-side
  // for the actual translation request regardless of this display value.
  const applyEffectiveLang = useCallback((code: string | undefined) => {
    if (typeof code !== 'string' || !code.trim()) return;
    const trimmed = code.trim();
    if (isKnownTargetLang(trimmed)) setTargetLangState(trimmed);
  }, []);

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
    const totalLines = song?.lyrics_raw ? song.lyrics_raw.split('\n').length : 0;
    if (!song?.lyrics_translation || totalLines === 0) return [];
    // Index-aligned so stale non-string slots become '' instead of shifting lines.
    return parseTranslationCache(song.lyrics_translation, totalLines);
  }, [song]);

  // Whether ANY rendered translation exists. Length is NOT a valid proxy: the
  // DB column defaults to '[]' for untranslated songs and the cache is padded
  // to the lyric line count, so `translations` is never empty for a song with
  // lyrics even when nothing is translated yet.
  const hasTranslation = useMemo(
    () => translations.some((line) => line !== ''),
    [translations],
  );

  // A song is "fully translated" when every non-empty lyric line has a
  // translation. Anything else (some lines empty, or nothing at all) counts
  // as partial — this drives the 「继续翻译」entry and the progress banner.
  // `lyrics_raw` non-empty lines are the source of truth; `translations` is
  // index-aligned to them and padded to the same length.
  const { translatedCount, untranslatedCount } = useMemo(() => {
    const rawLines = song?.lyrics_raw ? song.lyrics_raw.split('\n') : [];
    let translated = 0;
    let total = 0;
    rawLines.forEach((raw, i) => {
      if (!raw.trim()) return; // skip empty/blank lyric lines
      total += 1;
      if ((translations[i] ?? '').trim() !== '') translated += 1;
    });
    return { translatedCount: translated, untranslatedCount: total - translated };
  }, [song, translations]);

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
  const [furiganaRetryTick, setFuriganaRetryTick] = useState(0);
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
  }, [lyricsRaw, serverFurigana.length, hasHanCharacters, cantoneseSuggestion, id, readingScheme, readingSourceKey, song?.permissions?.can_edit, t, furiganaRetryTick]);

  // Retry a failed client-side furigana conversion: the effect only runs once
  // per lyrics value, so clear the guard and bump the tick to re-run it.
  const retryFurigana = useCallback(() => {
    requestedLyricsRef.current = '';
    setFuriganaRetryTick((n) => n + 1);
  }, []);

  const lineTimestamps = useMemo(() => {
    if (!song || !furiganaLines.length) return [] as (number | null)[];
    const renderedRows = furiganaLines.map((line) => line.segments.map((segment) => segment.text).join(''));
    return mapTimelineTimestamps(renderedRows, song.lyrics_raw || '', song.lyrics_synced || '');
  }, [song, furiganaLines]);

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

  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
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

  // Refresh song data (e.g. after request-public). Resolves with the fresh
  // song payload (or undefined on failure) so callers can compute derived
  // numbers synchronously without relying on async state propagation.
  const refreshSong = useCallback(async () => {
    try {
      const res = await fetch(`/api/songs/${id}`);
      if (res.ok) {
        const data = await res.json();
        setSong(data);
        if (data.lyrics_synced) setSyncLines(parseLrc(data.lyrics_synced));
        return data;
      }
    } catch (error) {
      console.error('刷新歌曲数据失败', error);
    }
    return undefined;
  }, [id]);

  // Full-song coverage over non-empty lyric lines (duplicates expanded, blank
  // lines skipped), computed from the persisted translation cache. This is the
  // reliable "how much of the song is translated" number — independent of how
  // many DISTINCT lines the model had to process (request progress).
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
  }, [id]);

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

  // Server-side "now playing" match — returns only the winning candidate's
  // summary, so the detail page never downloads the full public song list.
  // `excludeId` skips the song currently rendered on this page (used for the
  // "查看这首歌" / follow-playing "other song" match).
  const matchSong = useCallback(async (
    track: { id?: string; name: string; artist: string },
    excludeId?: string,
  ): Promise<{ id: string; title: string; artist: string; spotify_track_id?: string | null } | null> => {
    if (!track?.name) return null;
    const params = new URLSearchParams({ title: track.name, artist: track.artist || '' });
    if (track.id) params.set('track_id', track.id);
    if (excludeId) params.set('exclude', excludeId);
    try {
      const res = await fetch(`/api/spotify/match-song?${params.toString()}`, { cache: 'no-store' });
      if (!res.ok) {
        console.warn('match-song request failed', res.status);
        return null;
      }
      const data = await res.json() as { match?: { id: string; title: string; artist: string; spotify_track_id?: string | null } | null };
      const match = data.match;
      if (!match) return null;
      if (excludeId && match.id === excludeId) return null;
      return match;
    } catch (error) {
      // Never let a failed match silently break the UI; keep it observable.
      console.warn('match-song request failed', error);
      return null;
    }
  }, []);

  // Load the user's translation target language (user setting → global
  // default) so the translation entry can show and switch the target language
  // inline on the song page (issue #123). Unauthenticated users get a 401 and
  // stay at the built-in default. Returns null on failure so callers keep the
  // previous value.
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

  // Persist a new translation target language and refresh the effective value.
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

  const runSync = useCallback(async (force: boolean, confirmPlain = false) => {
    const controller = new AbortController();
    syncAbortRef.current = controller;
    setSyncing(true);
    setSyncStage(null);
    try {
      const res = await fetch(`/api/songs/${id}/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Ask the server to stream per-source progress over SSE so the UI can
          // show "正在查询 LRCLIB…" etc. instead of a frozen spinner.
          Accept: 'text/event-stream',
        },
        // The cancel button aborts this fetch; the request (and the server-side
        // fetch chain behind it) stops mid-way. No write has happened yet, so
        // cancelling has zero side effects.
        signal: controller.signal,
        body: JSON.stringify({
          force,
          confirmPlain,
          // Snapshot of the lyrics this request is based on. The server
          // refuses (409 stale_source) when they changed in another tab
          // while the fetch was in flight — a slow sync must never silently
          // clobber newer lyrics (and wipe furigana/translation with them).
          source_lyrics: song?.lyrics_raw ?? '',
        }),
      });
      const { status, body: data } = await readSyncEventStream(res, (stage) => setSyncStage(stage));
      // Fuzzy search below the confidence threshold: the server keeps the
      // current lyrics untouched — ask before overriding (furigana and
      // translation would be reset too).
      if (data.lowConfidence) {
        setLowConfidenceSync({
          source: data.source,
          confidence: data.confidence,
          lines: data.lines,
          lrc: data.lrc,
          candidate: data.candidate,
          match: data.match,
        });
        return;
      }
      // Plain-text hit (no LRC timeline): nothing was written yet — ask the
      // user whether to replace the current lyrics with this plain text.
      if (data.plainHit) {
        setPlainHitSync({
          source: data.source,
          confidence: data.confidence,
          plain: data.plain,
          candidate: data.candidate,
          match: data.match,
        });
        return;
      }
      // Confirmed plain-text overwrite succeeded (no timeline remains).
      if (data.plainUpdated) {
        const updated = await fetch(`/api/songs/${id}`, { cache: 'no-store' });
        if (updated.ok) setSong(await updated.json());
        setSyncLines([]);
        const sourceKey = LYRICS_SOURCE_KEYS[data.source];
        showToast('success', t('song.plainUpdated', {
          source: sourceKey ? t(sourceKey) : data.source,
        }));
        return;
      }
      if (data.synced) {
        await applySyncResult(data);
      } else {
        // Mid-fetch failure surfaced over SSE (or a stale/non-2xx result).
        if (data.error === 'network_error' || status >= 500) {
          setImportAlert({ message: t('song.networkErrorAlert') });
          return;
        }
        const errorKey: Record<string, string> = {
          lyrics_not_found: 'apiErrors.lyricsNotFound',
          lyrics_rate_limited: 'apiErrors.lyricsRateLimited',
          forbidden: 'apiErrors.forbidden',
          login_required: 'apiErrors.loginRequired',
          stale_source: 'song.syncStale',
        };
        const message = data.error && errorKey[data.error]
          ? t(errorKey[data.error])
          : t('song.syncNotFound');
        setImportAlert({ message });
        if (data.error === 'stale_source') {
          // Another tab saved different lyrics while this sync was in flight —
          // the server wrote nothing. Re-fetch so the user sees the current
          // lyrics instead of their stale baseline.
          void fetchSong().then(applySongResult);
        }
      }
    } catch {
      // Cancelling is expected — a clean stop, not a network failure.
      if (!controller.signal.aborted) {
        setImportAlert({ message: t('song.networkErrorAlert') });
      }
    } finally {
      setSyncing(false);
      setSyncStage(null);
      if (syncAbortRef.current === controller) syncAbortRef.current = null;
    }
  }, [id, t, showToast, applySyncResult, song, fetchSong, applySongResult]);

  const handleSync = useCallback(() => runSync(false), [runSync]);

  /** Abort the in-flight sync fetch (cancel button on the sync progress line). */
  const cancelSync = useCallback(() => {
    syncAbortRef.current?.abort();
  }, []);

  // Abort any in-flight sync when the component unmounts so a slow server-side
  // fetch chain never keeps running after the user leaves the page (issue #129).
  useEffect(() => () => { syncAbortRef.current?.abort(); }, []);

  // Confirm a low-confidence candidate by echoing back the signed token the
  // server issued during the preview. The server writes EXACTLY the reviewed
  // content — it does not re-fetch, so a changing upstream can never swap in a
  // different candidate after the user confirmed (fixes the TOCTOU).
  const confirmLowConfidenceSync = useCallback(async () => {
    if (!lowConfidenceSync?.candidate) return;
    const token = lowConfidenceSync.candidate;
    setLowConfidenceSync(null);
    setSyncing(true);
    try {
      const res = await fetch(`/api/songs/${id}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidate: token }),
      });
      const data = await res.json();
      if (res.status === 409 && (data.error === 'candidate_expired' || data.error === 'candidate_invalid' || data.error === 'stale_source')) {
        setImportAlert({ message: t('song.candidateExpired') });
        return;
      }
      if (data.synced) {
        await applySyncResult(data);
      } else {
        setImportAlert({ message: t('song.syncNotFound') });
      }
    } catch {
      setImportAlert({ message: t('song.networkErrorAlert') });
    } finally {
      setSyncing(false);
    }
  }, [id, t, lowConfidenceSync, applySyncResult]);

  const cancelLowConfidenceSync = useCallback(() => setLowConfidenceSync(null), []);

  // Confirm a plain-text candidate via its signed token (same guarantee as the
  // low-confidence flow — the server writes the reviewed content atomically).
  const confirmPlainSync = useCallback(async () => {
    if (!plainHitSync?.candidate) return;
    const token = plainHitSync.candidate;
    setPlainHitSync(null);
    setSyncing(true);
    try {
      const res = await fetch(`/api/songs/${id}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidate: token }),
      });
      const data = await res.json();
      if (res.status === 409 && (data.error === 'candidate_expired' || data.error === 'candidate_invalid' || data.error === 'stale_source')) {
        setImportAlert({ message: t('song.candidateExpired') });
        return;
      }
      // Confirmed plain-text overwrite succeeded (no timeline remains).
      if (data.plainUpdated) {
        const updated = await fetch(`/api/songs/${id}`, { cache: 'no-store' });
        if (updated.ok) setSong(await updated.json());
        setSyncLines([]);
        const sourceKey = LYRICS_SOURCE_KEYS[data.source];
        showToast('success', t('song.plainUpdated', {
          source: sourceKey ? t(sourceKey) : data.source,
        }));
        return;
      }
      if (data.synced) {
        await applySyncResult(data);
      } else {
        setImportAlert({ message: t('song.syncNotFound') });
      }
    } catch {
      setImportAlert({ message: t('song.networkErrorAlert') });
    } finally {
      setSyncing(false);
    }
  }, [id, t, plainHitSync, applySyncResult, showToast]);

  const cancelPlainSync = useCallback(() => setPlainHitSync(null), []);


  const handleTranslate = useCallback(async (force = false) => {
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
    setTranslationStage(null);
    translationDoneRef.current = 0;
    // Own the cancellation signal for this request — the user can abort a
    // long/accidental whole-song translation via the overlay's cancel button.
    const controller = new AbortController();
    translateAbortRef.current = controller;
    try {
      // Whole song in ONE request, streamed via SSE: the model sees the full
      // lyrics (coherent context) and its live reasoning/translation deltas
      // are shown in the expandable panel. The server skips already-translated
      // lines (cache/dedup) unless `force` is set, so this same call serves as
      // resume/retry AND as a forced re-translate (e.g. after the user changed
      // their target language — the server's own lang check re-translates on
      // a mismatch, and `force` covers the explicit user override).
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

      // Live progress while the model streams. The server reports BOTH the
      // per-request metric over DISTINCT lines (requestDone/requestTotal, the
      // units the model actually works in) and the reliable full-song coverage
      // (covered/coverable, duplicates expanded, blank lines skipped). Track
      // the request count for the cancellation ref; the UI shows coverage.
      const onProgress = (progress: TranslationProgress) => {
        // Real translation output has started — the preparation stage is over.
        setTranslationStage(null);
        translationDoneRef.current = progress.requestDone;
        setTranslationProgress(progress);
      };
      // Local accumulator mirrors the streamed reasoning so the error path
      // below can check whether any reasoning was produced (state is async).
      let streamedReasoning = '';
      const { translations, lang: streamLang, error: streamError, progress: errorProgress } = await readTranslationStream(
        res.body,
        (delta) => {
          streamedReasoning += delta;
          setTranslationReasoning((prev) => prev + delta);
        },
        onProgress,
        // The raw stage name stays internal — the UI only ever surfaces a
        // generic "正在准备翻译" notice (issue #172).
        () => setTranslationStage('preparing'),
      );
      const reasoningStreamed = streamedReasoning.length > 0;

      if (translations) {
        setTranslationProgress(null);
        setTranslationStage(null);
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
        setSong((prev) => prev ? {
          ...prev,
          lyrics_translation: JSON.stringify(seed),
          // Record the language the translation was generated in so the UI can
          // detect a future target-language mismatch and offer a re-translate.
          lyrics_translation_lang: streamLang,
        } : prev);
        setShowTranslation(true);
        // Count how many non-empty lyric lines now have a translation so the
        // completion toast distinguishes a full vs partial translation
        // (issue #100). `seed` is index-aligned to the lyric lines.
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
      // A server-reported cancellation/failure carries its own request
      // progress AND full-song coverage — use the persisted coverage for the
      // notice so the number is meaningful to the user ("已保存 X 行").
      const coveredNow = errorProgress?.covered ?? 0;
      const message = streamError === 'translation_cancelled'
        ? t('song.translationCancelled', { done: String(coveredNow) })
        : streamError && errorKey[streamError]
          ? t(errorKey[streamError])
          : t('song.translationFailed');
      // On failure the server persists whatever lines streamed in before the
      // error; report the consistent progress/coverage so the error pill shows
      // the "continue" button based on real remaining lines (断点续译入口).
      // Refresh the song from the server so partial translations already
      // persisted become visible.
      if (errorProgress) {
        setTranslationProgress(errorProgress);
        if (errorProgress.covered > 0) await refreshSong();
      } else {
        setTranslationProgress(null);
      }
      setTranslationStage(null);
      // The server persists whatever reasoning streamed before the failure;
      // keep the flag on so the menu can re-open it even after an error.
      if (reasoningStreamed) setHasSavedReasoning(true);
      setTranslationError(message);
      // Cancellation is informational (partial progress was saved), not an error.
      showToast(streamError === 'translation_cancelled' ? 'info' : 'error', message);
    } catch {
      // User pressed cancel (or the request was aborted). Because the abort
      // usually makes the stream read throw, the client almost never receives
      // the server's later `error` event — so we must NOT guess a denominator
      // here. Instead re-read the server's final persisted result (which the
      // cancel path merged just before) and show the reliable full-song
      // coverage. While that re-read is in flight show "正在保存已完成部分".
      if (controller.signal.aborted) {
        const requestDone = translationDoneRef.current;
        setTranslationSaving(true);
        try {
          // The server persists the completed lines asynchronously after it
          // detects the disconnect — pull once now and once more after a beat
          // so the partial translations show up even if the first fetch races.
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
  }, [id, song, furiganaLines, t, showToast, translating, refreshSong, coverageOf]);

  /** Abort the in-flight translation request (cancel button on the overlay). */
  const cancelTranslate = useCallback(() => {
    translateAbortRef.current?.abort();
  }, []);

  // When the translation display is on but the song has no translation yet,
  // offer to translate it (once per page visit).
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
      // The business callback owns toast dismissal: tapping 「翻译」 hides the
      // prompt toast (the generic Toast component stays action-agnostic).
      showToast('info', t('song.translationPrompt'), t('song.translate'), () => {
        setToast(null);
        void handleTranslate();
      });
    }
  }, [showTranslation, song?.lyrics_raw, hasTranslation, translating, t, showToast, handleTranslate]);


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

  /** Clear the persisted translation reasoning so stale thinking can be removed. */
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
    const ok = await copyToClipboard(text);
    if (!ok) {
      showToast('error', t('song.copyFailed'));
      return;
    }
    setCopied(true);
    showToast('success', t('share.copied'));
    setTimeout(() => setCopied(false), 2000);
  }, [song, furiganaLines, translations, t, showToast]);

  /** Copy the translation reasoning (live or persisted) to the clipboard. */
  const copyReasoning = useCallback(async () => {
    const text = translationReasoning.trim();
    if (!text) {
      showToast('error', t('song.copyReasoningEmpty'));
      return;
    }
    const ok = await copyToClipboard(text);
    showToast(ok ? 'success' : 'error', ok ? t('share.copied') : t('song.copyFailed'));
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
      if (data.needsReview) {
        // Low-confidence candidate — show the summary and ask before saving.
        setImportReview({
          title: spotify.track.name,
          artist: spotify.track.artist,
          spotifyTrackId: spotify.track.id,
          source: data.source,
          confidence: data.confidence,
          lines: data.lines,
          preview: data.preview,
          synced: data.synced,
          match: data.match,
        });
        return;
      }
      if (!res.ok || data.error) {
        const errorKey: Record<string, string> = {
          title_required: 'home.importTitleRequired',
          lyrics_not_found: 'home.importLyricsNotFound',
          lyrics_rate_limited: 'apiErrors.lyricsRateLimited',
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
    } catch (error) {
      console.error('导入当前播放歌曲失败', error);
      showToast('error', t('song.importFailed'));
    } finally {
      setImporting(false);
    }
  }, [router, t, showToast]);

  /** Re-run the import with `confirm_review` after the user accepted the candidate. */
  const confirmImportReview = useCallback(async () => {
    if (!importReview) return;
    setImporting(true);
    try {
      const res = await fetch('/api/songs/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: importReview.title, artist: importReview.artist, spotify_track_id: importReview.spotifyTrackId ?? '', confirm_review: true }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setImportAlert({
          message: t('song.importFailed'),
          manualCreateUrl: buildManualCreateUrl(data),
        });
        return;
      }
      router.push(`/songs/${data.id}`);
    } catch {
      showToast('error', t('song.importFailed'));
    } finally {
      setImporting(false);
      setImportReview(null);
    }
  }, [importReview, router, t, showToast]);

  // Keep a reference to the page-provided pipWindowRef so the useEffect below
  // can push live font-size / reading-mode updates into an already-open PiP
  // window (the callback receives it per call, but the effect needs it too).
  const pipWindowRefInternal = useRef<React.MutableRefObject<Window | null> | null>(null);

  /** Render the PiP lyrics list HTML for the given reading settings. */
  const renderPipLyricsHtml = useCallback((
    furiganaLinesArg: FuriganaLine[],
    songArg: SongData | null,
    rm: ReadingMode,
    roma: boolean,
    timestamps?: (number | null)[],
  ): string => {
    return furiganaLinesArg.map((line, i) => {
      if (line.segments.length === 0) return `<div class="line empty" data-line="${i}"></div>`;
      const html = normalizeFuriganaSegments(line.segments).map(seg => {
        if (rm === 'original') return escapeHtml(seg.text);
        const scheme = normalizeReadingScheme(songArg?.reading_scheme);
        const reading = resolveFuriganaReading(seg.text, seg.reading, roma, scheme);
        if (!reading) return escapeHtml(seg.text);
        const rubyClass = scheme === 'yue-jyutping'
          ? 'cantonese-reading'
          : roma && isKoreanReadingSegment(seg.text)
            ? 'korean-word'
            : roma && isKatakanaReadingSegment(seg.text) ? 'katakana-chunk' : '';
        const className = rubyClass ? ` class="${rubyClass}"` : '';
        const language = scheme === 'yue-jyutping' ? ' lang="yue-Latn"' : '';
        return `<ruby${className}>${escapeHtml(seg.text)}<rp>(</rp><rt${language}>${escapeHtml(reading)}</rt><rp>)</rp></ruby>`;
      }).join('');
      const ts = timestamps?.[i];
      const tsAttr = ts != null ? ` data-ts="${ts}"` : '';
      const tsClass = ts != null ? ' has-ts' : '';
      return `<div class="line${tsClass}" data-line="${i}"${tsAttr}>${html}</div>`;
    }).join('');
  }, []);

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
      pipWindowRefInternal.current = pipWindowRef;

      const title = escapeHtml(songArg?.title || '');
      const artist = escapeHtml(songArg?.artist || '');

      // Lyric lines read their size from this CSS variable so the open window
      // can be resized live via a `pip-font-size` message without rebuilding.
      const pipFontSize = fontSize;

      pipWindow.document.documentElement.innerHTML = `
        <head>
          <meta name="color-scheme" content="dark">
          <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500&display=swap" rel="stylesheet">
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            html { --pip-font-size: ${pipFontSize}px; }
            html, body { background: #0a0a0a; color: #a3a3a3; font-family: 'Noto Sans JP', 'system-ui', system-ui, -apple-system, sans-serif; height: 100%; overflow: hidden; }
            #pip-header { padding: 8px 12px; border-bottom: 1px solid #262626; font-size: 11px; color: #737373; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            #pip-header .title { color: #e5e5e5; font-weight: 500; }
            #pip-lyrics { height: calc(100% - 36px); overflow-y: auto; padding: 12px; scroll-behavior: smooth; }
            .line { line-height: 2.2; padding: 2px 4px; border-radius: 4px; transition: color 0.3s, transform 0.3s, opacity 0.3s; transform-origin: left; opacity: 0.6; font-size: var(--pip-font-size); }
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
            ${renderPipLyricsHtml(furiganaLinesArg, songArg, readingMode, romanizeFurigana, timestamps)}
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

        // Listen for seek messages from PiP in main window.
        // fetch() only rejects on network errors, so inspect res.ok to surface
        // HTTP failures (401 token expiry / 4xx / 5xx) via the same toast path
        // as the main lyric page instead of silently dropping them.
        const onPipMessage = (e: MessageEvent) => {
          if (e.data?.type !== 'pip-seek' || typeof e.data.position_ms !== 'number') return;
          (async () => {
            let res: Response;
            try {
              res = await fetch('/api/spotify/seek', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ position_ms: e.data.position_ms }),
              });
            } catch {
              showToast('error', t('song.seekFailed'));
              return;
            }
            if (res.ok) return;
            if (res.status === 401) {
              showToast('error', t('song.seekAuthFailed'), t('song.reconnect'), () => {
                window.location.assign('/api/auth/login');
              });
              return;
            }
            showToast('error', t('song.seekFailed'));
          })();
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

      // Live-update handler: the main window pushes font-size and reading-mode
      // changes here while the PiP stays open, so the user no longer needs to
      // close/re-open the window to see them take effect.
      const pipUpdateScript = pipWindow.document.createElement('script');
      pipUpdateScript.textContent = `
        window.addEventListener('message', function(e) {
          var msg = e.data;
          if (!msg || typeof msg !== 'object') return;
          if (msg.type === 'pip-font-size' && typeof msg.fontSize === 'number') {
            document.documentElement.style.setProperty('--pip-font-size', msg.fontSize + 'px');
          } else if (msg.type === 'pip-lyrics-render' && typeof msg.html === 'string') {
            var container = document.getElementById('pip-lyrics');
            if (!container) return;
            var activeIndex = (typeof msg.activeLine === 'number') ? msg.activeLine : -1;
            container.innerHTML = msg.html;
            var lines = container.querySelectorAll('.line');
            lines.forEach(function(el, i) {
              if (i === activeIndex) {
                el.classList.add('active');
                el.scrollIntoView({ block: 'center' });
              }
            });
          }
        });
      `;
      pipWindow.document.body.appendChild(pipUpdateScript);

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
  }, [fontSize, readingMode, romanizeFurigana, t, showToast, renderPipLyricsHtml]);

  // Keep an already-open PiP window in sync with the main page.
  // Font size is applied live via the CSS variable (no rebuild needed).
  useEffect(() => {
    const pipWin = pipWindowRefInternal.current?.current;
    if (!pipWin || pipWin.closed) return;
    pipWin.postMessage({ type: 'pip-font-size', fontSize }, '*');
  }, [fontSize]);

  // Reading mode / romanize toggle (and lyric data changes) regenerate the
  // PiP lyrics list in place instead of forcing a close/re-open.
  useEffect(() => {
    const pipWin = pipWindowRefInternal.current?.current;
    if (!pipWin || pipWin.closed) return;
    let activeLine = -1;
    try {
      const lines = Array.from(pipWin.document.querySelectorAll('#pip-lyrics .line'));
      const activeEl = pipWin.document.querySelector('#pip-lyrics .line.active');
      activeLine = activeEl ? lines.indexOf(activeEl) : -1;
    } catch { /* window gone */ }
    pipWin.postMessage({
      type: 'pip-lyrics-render',
      html: renderPipLyricsHtml(furiganaLines, song, readingMode, romanizeFurigana, lineTimestamps),
      activeLine,
    }, '*');
  }, [readingMode, romanizeFurigana, song, furiganaLines, lineTimestamps, renderPipLyricsHtml]);

  // Re-center when debug mode toggled off
  useEffect(() => {
    // This effect needs activeLine from the sync hook — the page will handle it
  }, [debug]);

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
