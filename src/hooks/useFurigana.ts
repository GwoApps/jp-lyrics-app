'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FuriganaLine, SongData } from '@/lib/types';
import {
  convertLyricsReading,
  detectCantoneseLyrics,
  normalizeReadingScheme,
} from '@/lib/lyrics-reading';
import { createPlainFuriganaLines } from '@/lib/furigana-plain';

interface UseFuriganaDeps {
  id: string;
  song: SongData | null;
  t: (key: string, params?: Record<string, string>) => string;
}

export function useFurigana(deps: UseFuriganaDeps) {
  const { id, song, t } = deps;

  const serverFurigana = useMemo<FuriganaLine[]>(() => {
    if (!song?.lyrics_furigana) return [];
    try { return JSON.parse(song.lyrics_furigana); } catch { return []; }
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

  // Reset client furigana state after a reading-scheme change invalidates it.
  const resetFurigana = useCallback(() => {
    requestedLyricsRef.current = '';
    setClientFuriganaState({ source: '', lines: [], loading: false, error: '' });
  }, []);

  return {
    furiganaLines,
    furiganaLoading,
    furiganaError,
    retryFurigana,
    cantoneseSuggestion,
    resetFurigana,
  };
}
