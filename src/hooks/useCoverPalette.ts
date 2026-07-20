'use client';

import { useEffect, useState } from 'react';
import { extractMaterialCoverPalette, type CoverPalette } from '@/lib/cover-color';

/**
 * Extracts the Material-ranked palette from a cover and applies the same
 * restrained page tint used by the song detail view.
 */
export function useCoverPalette(coverUrl: string | null | undefined): CoverPalette | null {
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

  useEffect(() => {
    if (!palette) return;

    const accent = `rgb(${palette.primary.r} ${palette.primary.g} ${palette.primary.b})`;
    document.body.style.setProperty('--song-page-accent', accent);
    document.body.classList.add('song-page-themed');

    return () => {
      document.body.classList.remove('song-page-themed');
      document.body.style.removeProperty('--song-page-accent');
    };
  }, [palette]);

  return palette;
}
