'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { extractMaterialCoverPalette, type CoverColor, type CoverPalette } from '@/lib/cover-color';
import { readableCoverTextColor } from '@/lib/cover-text-color';
import { cacheSongPalette, getCachedSongPalette } from '@/lib/song-cover-cache';

export interface CoverTheme {
  palette: CoverPalette | null;
  isThemed: boolean;
  style: React.CSSProperties | undefined;
}

function rgb(color: CoverColor) {
  return `rgb(${color.r} ${color.g} ${color.b})`;
}

/**
 * Load a cover and extract its Material-ranked palette without side effects.
 *
 * Palette resolution order (fastest first):
 *  1. server-provided palette (already computed for this cover_url)
 *  2. localStorage cache for this song/cover_url
 *  3. live extraction from the image (result is persisted to both stores)
 *
 * Bumping `refreshKey` forces a re-extraction (used by the "re-extract cover
 * colors" debug action, which also clears the localStorage entry). When a
 * fresh palette is extracted, `onExtracted` fires so the caller can persist
 * it server-side.
 *
 * `enabled` defaults to `true` and keeps the eager behaviour. List callers that
 * only tint a card pass `false` until the card is near the viewport: nothing is
 * downloaded or quantized before then, and the palette simply stays `null`
 * (the same value it has while extraction is in flight).
 */
export function useCoverPalette(
  coverUrl: string | null | undefined,
  refreshKey = 0,
  serverPalette: CoverPalette | null = null,
  cacheKey: string | null = null,
  onExtracted?: (palette: CoverPalette | null) => void,
  enabled = true,
): CoverPalette | null {
  const [paletteState, setPaletteState] = useState<{
    url: string | null | undefined;
    palette: CoverPalette | null;
  }>(() => ({ url: coverUrl, palette: serverPalette }));
  const palette = paletteState.url === coverUrl ? paletteState.palette : null;
  const onExtractedRef = useRef(onExtracted);

  useEffect(() => {
    onExtractedRef.current = onExtracted;
  }, [onExtracted]);

  // Resolve the server/local cache first, then extract only when no usable
  // palette exists (or refreshKey explicitly forces a fresh extraction).
  useEffect(() => {
    let cancelled = false;
    if (!enabled) return undefined;
    if (!coverUrl) {
      queueMicrotask(() => {
        if (!cancelled) setPaletteState({ url: coverUrl, palette: null });
      });
      return () => { cancelled = true; };
    }

    const local = cacheKey ? getCachedSongPalette(cacheKey, coverUrl) : null;
    const seed = local ?? serverPalette;
    if (seed && refreshKey === 0) {
      queueMicrotask(() => {
        if (!cancelled) setPaletteState({ url: coverUrl, palette: seed });
      });
      return () => { cancelled = true; };
    }

    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      const nextPalette = extractMaterialCoverPalette(image);
      if (cancelled) return;
      setPaletteState({ url: coverUrl, palette: nextPalette });
      if (cacheKey) cacheSongPalette(cacheKey, coverUrl, nextPalette);
      onExtractedRef.current?.(nextPalette);
    };
    image.onerror = () => {
      if (cancelled) return;
      setPaletteState({ url: coverUrl, palette: null });
    };
    image.src = coverUrl;

    return () => {
      cancelled = true;
    };
  }, [enabled, coverUrl, refreshKey, cacheKey, serverPalette]);

  return palette;
}

/**
 * Shared page-level cover theme pipeline. It adds the body tint and returns
 * the complete CSS-variable contract for a song surface root.
 */
export function useCoverTheme(
  coverUrl: string | null | undefined,
  refreshKey = 0,
  serverPalette: CoverPalette | null = null,
  cacheKey: string | null = null,
  onExtracted?: (palette: CoverPalette | null) => void,
  enabled = true,
): CoverTheme {
  const palette = useCoverPalette(coverUrl, refreshKey, serverPalette, cacheKey, onExtracted, enabled);
  const readableText = useMemo(() => palette && ({
    dark: rgb(readableCoverTextColor(palette, 'dark')),
    light: rgb(readableCoverTextColor(palette, 'light')),
  }), [palette]);
  const style = useMemo<React.CSSProperties | undefined>(() => {
    if (!palette || !readableText) return undefined;
    return {
      '--song-accent': rgb(palette.primary),
      '--song-accent-primary': rgb(palette.primary),
      '--song-accent-secondary': rgb(palette.secondary),
      '--song-accent-tertiary': rgb(palette.tertiary),
      '--song-accent-text-dark': readableText.dark,
      '--song-accent-text-light': readableText.light,
    } as React.CSSProperties;
  }, [palette, readableText]);

  useEffect(() => {
    if (!palette || !readableText) return;

    // Mirror the readable colours on <body> so portalled menus (which live
    // outside .song-view) inherit the same theme-selected text colour.
    document.body.style.setProperty('--song-page-accent', rgb(palette.primary));
    document.body.style.setProperty('--song-accent-text-dark', readableText.dark);
    document.body.style.setProperty('--song-accent-text-light', readableText.light);
    document.body.classList.add('song-page-themed');

    return () => {
      document.body.classList.remove('song-page-themed');
      document.body.style.removeProperty('--song-page-accent');
      document.body.style.removeProperty('--song-accent-text-dark');
      document.body.style.removeProperty('--song-accent-text-light');
    };
  }, [palette, readableText]);

  return { palette, isThemed: palette !== null, style };
}
