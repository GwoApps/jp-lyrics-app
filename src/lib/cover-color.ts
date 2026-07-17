'use client';

import { QuantizerCelebi, Score, argbFromRgb, blueFromArgb, greenFromArgb, redFromArgb } from '@material/material-color-utilities';

export type CoverColor = { r: number; g: number; b: number };
export type CoverPalette = { primary: CoverColor; secondary: CoverColor; tertiary: CoverColor };

function fromArgb(argb: number): CoverColor {
  return { r: redFromArgb(argb), g: greenFromArgb(argb), b: blueFromArgb(argb) };
}

function colorDistance(a: CoverColor, b: CoverColor): number {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

/**
 * Derive a theme-worthy source color using Material Design's image pipeline:
 * Celebi quantization followed by Material's chroma/population scorer.
 */
export function extractMaterialCoverPalette(image: HTMLImageElement): CoverPalette | null {
  try {
    const edge = 96;
    const canvas = document.createElement('canvas');
    canvas.width = edge;
    canvas.height = edge;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;

    context.drawImage(image, 0, 0, edge, edge);
    const pixels = context.getImageData(0, 0, edge, edge).data;
    const opaquePixels: number[] = [];

    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] < 200) continue;
      opaquePixels.push(argbFromRgb(pixels[i], pixels[i + 1], pixels[i + 2]));
    }
    if (opaquePixels.length === 0) return null;

    const ranked = Score.score(QuantizerCelebi.quantize(opaquePixels, 24), {
      desired: 4,
      filter: true,
    });
    const source = ranked[0];
    if (source == null) return null;

    const primary = fromArgb(source);
    const secondary = ranked
      .slice(1)
      .map(fromArgb)
      .find((color) => colorDistance(primary, color) >= 72) ?? primary;
    const tertiary = ranked
      .slice(1)
      .map(fromArgb)
      .find((color) => colorDistance(primary, color) >= 72 && colorDistance(secondary, color) >= 72) ?? secondary;
    return { primary, secondary, tertiary };
  } catch {
    // Remote images without usable CORS headers taint Canvas. Keep the neutral fallback.
    return null;
  }
}

/** Compatibility helper for surfaces that only need the main cover color. */
export function extractMaterialCoverColor(image: HTMLImageElement): CoverColor | null {
  return extractMaterialCoverPalette(image)?.primary ?? null;
}
