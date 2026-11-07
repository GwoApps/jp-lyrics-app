/**
 * Palette for the Document Picture-in-Picture window (issue #374).
 *
 * The PiP document is built from a template string in `usePiP`, so every colour
 * it needs comes from one of these bundles and is injected as a `--pip-*`
 * variable. Adding a theme (or tuning an existing one) is a data change here,
 * not a copy edit inside the template.
 */
import type { PipTheme } from './settings-utils';

export interface PipPalette {
  /** `color-scheme` for the PiP document — drives UA widgets (scrollbars). */
  colorScheme: PipTheme;
  bg: string;
  fg: string;
  /** Header title / hovered line — one step brighter than `fg`. */
  strong: string;
  muted: string;
  /** Even quieter than `muted`: header chrome, untranslated placeholder. */
  faint: string;
  border: string;
  active: string;
  /** Furigana / romaji above the active line. */
  activeReading: string;
  translation: string;
  activeTranslation: string;
}

export const PIP_PALETTES: Record<PipTheme, PipPalette> = {
  // Unchanged from the pre-#374 hard-coded values.
  dark: {
    colorScheme: 'dark',
    bg: '#0a0a0a',
    fg: '#a3a3a3',
    strong: '#e5e5e5',
    muted: '#737373',
    faint: '#5c5c5c',
    border: '#262626',
    active: '#ffffff',
    activeReading: '#d4d4d4',
    translation: '#8a8a8a',
    activeTranslation: '#a3a3a3',
  },
  // Mirrors the light `globals.css` variables (--background/--foreground/...).
  light: {
    colorScheme: 'light',
    bg: '#ffffff',
    fg: '#525252',
    strong: '#171717',
    muted: '#6b6b6b',
    faint: '#a3a3a3',
    border: '#e0e0e0',
    active: '#171717',
    activeReading: '#404040',
    translation: '#6b6b6b',
    activeTranslation: '#525252',
  },
};

/**
 * Window event the /settings page fires after the PiP theme changes, so an
 * already-open PiP window repaints without a reload. `detail` is the raw stored
 * value ('system' | 'dark' | 'light'); omitted → re-read from localStorage.
 */
export const PIP_THEME_EVENT = 'jplrc:pip-theme';

/** The palette as a flat `--pip-*` → value record, for inline style injection. */
export function pipPaletteVars(theme: PipTheme): Record<string, string> {
  const p = PIP_PALETTES[theme];
  return {
    '--pip-bg': p.bg,
    '--pip-fg': p.fg,
    '--pip-strong': p.strong,
    '--pip-muted': p.muted,
    '--pip-faint': p.faint,
    '--pip-border': p.border,
    '--pip-active': p.active,
    '--pip-active-reading': p.activeReading,
    '--pip-translation': p.translation,
    '--pip-active-translation': p.activeTranslation,
  };
}

/** Read the PiP theme stored in localStorage (`system` when unset). */
export function readStoredPipTheme(): string {
  if (typeof window === 'undefined') return 'system';
  return localStorage.getItem('jplrc-pip-theme') ?? 'system';
}
