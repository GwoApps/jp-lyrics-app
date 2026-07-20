'use client';

import { useEffect, useMemo, useState } from 'react';
import { extractMaterialCoverPalette, type CoverColor, type CoverPalette } from '@/lib/cover-color';

export interface CoverTheme {
  palette: CoverPalette | null;
  isThemed: boolean;
  style: React.CSSProperties | undefined;
}

function rgb(color: CoverColor) {
  return `rgb(${color.r} ${color.g} ${color.b})`;
}

/**
 * Shared cover-theme pipeline for detail and editor pages.
 *
 * It owns image loading, palette extraction, page tinting, and the complete
 * palette CSS-variable contract. Consumers only need to spread `style` on
 * their page root and add `song-view--accented` when `isThemed` is true.
 */
export function useCoverTheme(coverUrl: string | null | undefined): CoverTheme {
  const [paletteState, setPaletteState] = useState<{
    url: string | null | undefined;
    palette: CoverPalette | null;
  }>({ url: null, palette: null });
  const palette = paletteState.url === coverUrl ? paletteState.palette : null;

  useEffect(() => {
    if (!coverUrl) return;

    let cancelled = false;
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      const nextPalette = extractMaterialCoverPalette(image);
      if (!cancelled) setPaletteState({ url: coverUrl, palette: nextPalette });
    };
    image.onerror = () => {
      if (!cancelled) setPaletteState({ url: coverUrl, palette: null });
    };
    image.src = coverUrl;

    return () => {
      cancelled = true;
    };
  }, [coverUrl]);

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

/** Backward-compatible palette-only adapter for non-themed consumers. */
export function useCoverPalette(coverUrl: string | null | undefined): CoverPalette | null {
  return useCoverTheme(coverUrl).palette;
}
