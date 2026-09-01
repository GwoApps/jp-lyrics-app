'use client';

import { useEffect, useState } from 'react';
import type { ReadingMode } from '@/lib/types';

/**
 * User reading preferences persisted to localStorage. Self-contained: no
 * dependency on the loaded song, so it can be used by any component that needs
 * the same reading controls (detail page, PiP, etc.).
 */
export function useReadingPreferences() {
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
  const [showTranslation, setShowTranslation] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('jplrc-show-translation') === 'true';
  });
  const [debug, setDebug] = useState(false);
  const [fontSize, setFontSize] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('jplrc-font-size');
      if (saved) { const n = parseInt(saved); if (n >= 14 && n <= 32) return n; }
    }
    return 20;
  });

  useEffect(() => { localStorage.setItem('jplrc-font-size', String(fontSize)); }, [fontSize]);
  useEffect(() => { localStorage.setItem('jplrc-reading-mode', readingMode); }, [readingMode]);
  useEffect(() => { localStorage.setItem('jplrc-romanize-furigana', String(romanizeFurigana)); }, [romanizeFurigana]);
  useEffect(() => { localStorage.setItem('jplrc-show-translation', String(showTranslation)); }, [showTranslation]);

  return {
    readingMode,
    setReadingMode,
    romanizeFurigana,
    setRomanizeFurigana,
    showTranslation,
    setShowTranslation,
    debug,
    setDebug,
    fontSize,
    setFontSize,
  };
}
