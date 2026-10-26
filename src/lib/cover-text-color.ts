import type { CoverColor, CoverPalette } from './cover-color';

// Keep these in sync with --background and body.song-page-themed in globals.css.
const DARK_BACKGROUND: CoverColor = { r: 10, g: 10, b: 10 };
const LIGHT_BACKGROUND: CoverColor = { r: 255, g: 255, b: 255 };
const MIN_TEXT_CONTRAST = 4.5; // WCAG AA for the time axis's 12px labels.

function mix(a: CoverColor, b: CoverColor, amount: number): CoverColor {
  return {
    r: Math.round(a.r * (1 - amount) + b.r * amount),
    g: Math.round(a.g * (1 - amount) + b.g * amount),
    b: Math.round(a.b * (1 - amount) + b.b * amount),
  };
}

function luminance(color: CoverColor): number {
  const channel = (value: number) => {
    const srgb = value / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

export function coverTextContrast(foreground: CoverColor, background: CoverColor): number {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * Pick a cover colour that can actually be read as 12px text in the page gutter.
 * The stored palette stays unchanged: ambient lighting still uses the raw cover.
 */
export function readableCoverTextColor(palette: CoverPalette, theme: 'dark' | 'light'): CoverColor {
  const base = theme === 'dark' ? DARK_BACKGROUND : LIGHT_BACKGROUND;
  // The gutter shows the body tint (96% theme background + 4% cover primary).
  const background = mix(base, palette.primary, 0.04);
  const candidates = [palette.primary, palette.secondary, palette.tertiary];
  const matching = candidates.find((color) => coverTextContrast(color, background) >= MIN_TEXT_CONTRAST);
  if (matching) return matching;

  // No existing palette colour passes: retain the closest candidate's hue and
  // move it just far enough towards the theme foreground to clear the threshold.
  const best = candidates.reduce((a, b) =>
    coverTextContrast(a, background) >= coverTextContrast(b, background) ? a : b,
  );
  const target = theme === 'dark' ? LIGHT_BACKGROUND : DARK_BACKGROUND;
  for (let step = 1; step <= 100; step++) {
    const adjusted = mix(best, target, step / 100);
    if (coverTextContrast(adjusted, background) >= MIN_TEXT_CONTRAST) return adjusted;
  }
  return target;
}
