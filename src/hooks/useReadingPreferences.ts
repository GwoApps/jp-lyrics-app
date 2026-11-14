'use client';

import { useEffect, useState } from 'react';
import type { ReadingMode } from '@/lib/types';
import { useStoredPreference } from '@/lib/browser-storage';

/**
 * User reading preferences persisted to localStorage. Self-contained: no
 * dependency on the loaded song, so it can be used by any component that needs
 * the same reading controls (detail page, PiP, etc.).
 *
 * Every preference goes through `useStoredPreference`, so the server render and
 * the hydration render both use the defaults and the stored value is adopted
 * on the first post-hydration render (issue #419).
 */
export function useReadingPreferences() {
  const [readingMode, setReadingMode] = useStoredPreference<ReadingMode>(
    'jplrc-reading-mode',
    (raw) => (raw === 'original' ? 'original' : 'furigana'),
  );
  // Furigana romanization used to be a `jplrc-reading-mode=romaji` value; keep
  // honouring it so an old profile still reads the way it did.
  const [romanizeFurigana, setRomanizeFurigana] = useStoredPreference(
    'jplrc-romanize-furigana',
    (raw) => raw === 'true',
  );
  const [legacyRomaji] = useStoredPreference('jplrc-reading-mode', (raw) => raw === 'romaji');
  const [showTranslation, setShowTranslation] = useStoredPreference('jplrc-show-translation', (raw) => raw === 'true');
  const [disableVideoPiP, setDisableVideoPiP] = useStoredPreference('jplrc-disable-video-pip', (raw) => raw === 'true');
  const [debug, setDebug] = useState(false);
  const [fontSize, setFontSize] = useStoredPreference('jplrc-font-size', (raw) => {
    const size = raw ? parseInt(raw, 10) : NaN;
    return size >= 14 && size <= 32 ? size : 20;
  }, String);

  // A `romaji` reading mode is the pre-existing way to ask for romanization.
  const romanized = romanizeFurigana || legacyRomaji;
  useEffect(() => {
    if (legacyRomaji) setRomanizeFurigana(true);
  }, [legacyRomaji, setRomanizeFurigana]);

  useEffect(() => {
    const onSyncedSetting = (event: Event) => {
      const value = (event as CustomEvent<boolean>).detail;
      if (typeof value === 'boolean') setDisableVideoPiP(value);
    };
    window.addEventListener('jplrc-disable-video-pip-change', onSyncedSetting);
    return () => window.removeEventListener('jplrc-disable-video-pip-change', onSyncedSetting);
  }, [setDisableVideoPiP]);

  return {
    readingMode,
    setReadingMode,
    romanizeFurigana: romanized,
    setRomanizeFurigana,
    showTranslation,
    setShowTranslation,
    disableVideoPiP,
    setDisableVideoPiP,
    debug,
    setDebug,
    fontSize,
    setFontSize,
  };
}
