'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { extractMaterialCoverPalette, type CoverColor, type CoverPalette } from '@/lib/cover-color';
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
 */
export function useCoverPalette(
  coverUrl: string | null | undefined,
  refreshKey = 0,
  serverPalette: CoverPalette | null = null,
  cacheKey: string | null = null,
  onExtracted?: (palette: CoverPalette | null) => void,
): CoverPalette | null {
  const [paletteState, setPaletteState] = useState<{
    url: string | null | undefined;
    palette: CoverPalette | null;
  }>(() => ({ url: coverUrl, palette: serverPalette }));
  const palette = paletteState.url === coverUrl ? paletteState.palette : null;
  // Mirror for effect logic without re-render loops.
  const paletteRef = useRef<CoverPalette | null>(serverPalette);
  if (paletteState.url === coverUrl && paletteState.palette !== paletteRef.current) {
    paletteRef.current = paletteState.palette;
  }
  const onExtractedRef = useRef(onExtracted);
  onExtractedRef.current = onExtracted;

  // 1/2. Seed from server palette (initial state) and localStorage cache.
  useEffect(() => {
    if (!coverUrl) return;
    const local = cacheKey ? getCachedSongPalette(cacheKey, coverUrl) : null;
    const seed = local ?? serverPalette;
    if (seed) {
      paletteRef.current = seed;
      setPaletteState({ url: coverUrl, palette: seed });
    }
  }, [coverUrl, cacheKey, serverPalette]);

  // 3. Live extraction: only when nothing usable is known, or forced (refreshKey > 0).
  useEffect(() => {
    if (!coverUrl) return;
    if (paletteRef.current && refreshKey === 0) return;

    let cancelled = false;
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      const nextPalette = extractMaterialCoverPalette(image);
      if (cancelled) return;
      paletteRef.current = nextPalette;
      setPaletteState({ url: coverUrl, palette: nextPalette });
      if (cacheKey) cacheSongPalette(cacheKey, coverUrl, nextPalette);
      onExtractedRef.current?.(nextPalette);
    };
    image.onerror = () => {
      if (cancelled) return;
      paletteRef.current = null;
      setPaletteState({ url: coverUrl, palette: null });
    };
    image.src = coverUrl;

    return () => {
      cancelled = true;
    };
  }, [coverUrl, refreshKey, cacheKey]);

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
): CoverTheme {
  const palette = useCoverPalette(coverUrl, refreshKey, serverPalette, cacheKey, onExtracted);
  const style = useMemo<React.CSSProperties | undefined>(() => {
    if (!palette) return undefined;
    return {
      '--song-accent': rgb(palette.primary),
      '--song-accent-primary': rgb(palette.primary),
      '--song-accent-secondary': rgb(palette.secondary),
      '--song-accent-tertiary': rgb(palette.tertiary),
    } as React.CSSProperties;
  }, [palette]);

  useEffect(() => {
    if (!palette) return;

    document.body.style.setProperty('--song-page-accent', rgb(palette.primary));
    document.body.classList.add('song-page-themed');

    return () => {
      document.body.classList.remove('song-page-themed');
      document.body.style.removeProperty('--song-page-accent');
    };
  }, [palette]);

  return { palette, isThemed: palette !== null, style };
}
