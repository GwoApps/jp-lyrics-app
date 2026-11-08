/**
 * Canvas drawing for the share card (pure functions, no React).
 * Renders the lyric card background, cover art, caption and QR code.
 */

import { extractMaterialCoverPalette, type CoverColor, type CoverPalette } from '@/lib/cover-color';
import { parseTranslationCache } from '@/lib/translation/parse';
import { canvasFont } from '@/lib/font-family';
import { sourceLyricsLang } from '@/lib/lyrics-reading';
import type { ReadingScheme } from '@/lib/types';
import { resolveTranslationLang } from '@/lib/target-lang';

export type Orientation = 'landscape' | 'portrait';

export interface ShareSong {
  id: string;
  title: string;
  artist: string;
  cover_url: string | null;
  lyrics_raw: string | null;
  lyrics_synced: string | null;
  /** JSON-array string aligned to `lyrics_raw` lines; each item is that line's translation (may be ''). */
  lyrics_translation?: string | null;
  /** BCP-47 tag of the translated language (`songs.lyrics_translation_lang`), used for the `lang` attribute. */
  lyrics_translation_lang?: string | null;
  /** Reading scheme of the source lyrics, which decides the source language (`ja` / `yue-Hant`). */
  reading_scheme?: ReadingScheme | null;
}

/** A lyric line with its optional translation (aligned by source line index). */
export interface LyricLine {
  /** Lyric text with LRC tags stripped. */
  text: string;
  /** Aligned translation for this line, or null when absent. */
  translation: string | null;
  /** Original index in the source lyrics (`lyrics_raw`/`lyrics_synced`), used to align with detail-page `?line=` links. */
  index: number;
  /** BCP-47 tag of {@link text} (from `reading_scheme`), so its glyphs match its language. */
  lang: string;
  /** BCP-47 tag of {@link translation} (from `lyrics_translation_lang`), or null when there is none. */
  translationLang: string | null;
}

export const LANDSCAPE_W = 1200;
export const LANDSCAPE_H = 630;
export const PORTRAIT_W = 630;
export const PORTRAIT_H = 1200;

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number) {
  const lines: string[] = [];
  let line = '';
  for (const char of text) {
    const test = line + char;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = char;
      if (lines.length === maxLines) break;
    } else {
      line = test;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines && text.length > lines.join('').length) {
    const last = lines[lines.length - 1];
    if (last.length > 1) {
      lines[lines.length - 1] = last.slice(0, -1) + '…';
    }
  }
  return lines;
}

async function loadImage(src: string | null): Promise<HTMLImageElement | null> {
  if (!src) return null;
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function colorString({ r, g, b }: CoverColor, alpha = 1) {
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function shade({ r, g, b }: CoverColor, amount: number): CoverColor {
  return { r: Math.round(r * amount), g: Math.round(g * amount), b: Math.round(b * amount) };
}

/** Cover-derived, layered card background: dark base, soft light pools, sheen and deterministic film grain. */
function drawCardBackground(ctx: CanvasRenderingContext2D, width: number, height: number, palette: CoverPalette | null) {
  const primary = palette?.primary ?? { r: 51, g: 65, b: 85 };
  const secondary = palette?.secondary ?? { r: 71, g: 85, b: 105 };

  const base = ctx.createLinearGradient(0, 0, width, height);
  base.addColorStop(0, colorString(shade(primary, 0.19)));
  base.addColorStop(0.48, '#101827');
  base.addColorStop(1, colorString(shade(secondary, 0.24)));
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, width, height);

  const primaryGlow = ctx.createRadialGradient(width * 0.13, height * 0.08, 0, width * 0.13, height * 0.08, Math.max(width, height) * 0.72);
  primaryGlow.addColorStop(0, colorString(primary, 0.42));
  primaryGlow.addColorStop(0.42, colorString(primary, 0.16));
  primaryGlow.addColorStop(1, colorString(primary, 0));
  ctx.fillStyle = primaryGlow;
  ctx.fillRect(0, 0, width, height);

  const secondaryGlow = ctx.createRadialGradient(width * 0.9, height * 0.9, 0, width * 0.9, height * 0.9, Math.max(width, height) * 0.62);
  secondaryGlow.addColorStop(0, colorString(secondary, 0.3));
  secondaryGlow.addColorStop(0.48, colorString(secondary, 0.1));
  secondaryGlow.addColorStop(1, colorString(secondary, 0));
  ctx.fillStyle = secondaryGlow;
  ctx.fillRect(0, 0, width, height);

  const sheen = ctx.createLinearGradient(0, 0, width, height);
  sheen.addColorStop(0, 'rgba(255,255,255,0.09)');
  sheen.addColorStop(0.26, 'rgba(255,255,255,0.018)');
  sheen.addColorStop(0.62, 'rgba(255,255,255,0)');
  sheen.addColorStop(1, 'rgba(0,0,0,0.22)');
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, width, height);

  // Stable, subtle grain gives exported PNGs material depth without flicker between redraws.
  let seed = width * 92821 + height * 68917;
  ctx.fillStyle = 'rgba(255,255,255,0.025)';
  for (let i = 0; i < 1500; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const x = seed % width;
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const y = seed % height;
    ctx.fillRect(x, y, 1, 1);
  }
}

function stripLrcTags(line: string): string {
  const trimmed = line.trim();
  // Skip standard metadata tags ([ar:], [ti:], [al:], [by:], [offset:], …) so
  // they never appear as lyric lines on the share card.
  if (/^\[[a-z]+:[^\]]*\]$/i.test(trimmed)) return '';
  return trimmed.replace(/\[\d{2}:\d{2}(\.\d+)?\]/g, '').trim();
}

function parseTranslations(song: ShareSong): string[] {
  // Index-aligned: non-string entries become '' at their original index
  // (never filtered) so later lines keep their source line number.
  return parseTranslationCache(song.lyrics_translation);
}

/**
 * Source lyric lines paired with their translation.
 *
 * Translations are stored as a JSON-array string aligned to `lyrics_raw` line
 * indexes, so each non-empty source line keeps its original index while looking
 * up its translation. Empty source lines and missing/blank translations are
 * skipped (translation becomes `null`).
 */
export function getLyricLines(song: ShareSong): LyricLine[] {
  const raw = song.lyrics_raw || song.lyrics_synced;
  if (!raw) return [];
  const translations = parseTranslations(song);
  // Issue #336: each block carries the language of both its source text (from
  // `reading_scheme`) and its translation (from `lyrics_translation_lang`), so
  // the canvas can pick the matching family per line instead of one generic
  // `sans-serif` for the whole card.
  const lang = sourceLyricsLang(song.reading_scheme);
  const translationLang = resolveTranslationLang(song.lyrics_translation_lang);
  const lines: LyricLine[] = [];
  raw.split('\n').forEach((rawLine, index) => {
    const text = stripLrcTags(rawLine);
    if (!text) return;
    const translation = translations[index]?.trim();
    lines.push({
      text,
      translation: translation || null,
      index,
      lang,
      translationLang: translation ? translationLang : null,
    });
  });
  return lines;
}

/** Backwards-compatible helper returning just the original lyric text lines. */
export function getLyricsLines(song: ShareSong): string[] {
  return getLyricLines(song).map((line) => line.text);
}

export function drawCover(
  ctx: CanvasRenderingContext2D,
  song: ShareSong,
  coverImg: HTMLImageElement | null,
  x: number,
  y: number,
  size: number,
) {
  ctx.save();
  roundRect(ctx, x, y, size, size, Math.min(24, size / 10));
  ctx.clip();
  if (coverImg) {
    ctx.drawImage(coverImg, x, y, size, size);
  } else {
    ctx.fillStyle = '#334155';
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = '#94a3b8';
    ctx.font = canvasFont(song.reading_scheme, Math.floor(size * 0.4));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🎵', x + size / 2, y + size / 2);
  }
  ctx.restore();
}

function drawCaption(
  ctx: CanvasRenderingContext2D,
  scanText: string,
  siteText: string,
  centerX: number,
  startY: number,
  showQrCode: boolean,
  showSourceText: boolean,
  /** BCP-47 tag of the UI strings (`scanText` / `siteText`), so they font like the UI. */
  uiTag: string | null | undefined,
) {
  ctx.textAlign = 'center';
  let textY = startY;
  if (showQrCode) {
    ctx.fillStyle = '#cbd5e1';
    ctx.font = canvasFont(uiTag, 22);
    ctx.fillText(scanText, centerX, textY);
    textY += 32;
  }
  if (showSourceText) {
    ctx.fillStyle = '#94a3b8';
    ctx.font = canvasFont(uiTag, 18);
    ctx.fillText(siteText, centerX, textY);
  }
}

/** Vertical rhythm of a lyric block, shared by the measuring and drawing passes. */
const LYRIC_TEXT_H = 44;
const LYRIC_TRANS_H = 26;
const LYRIC_TEXT_SIZE = 28;
const LYRIC_TRANS_SIZE = 20;
const LYRIC_TEXT_COLOR = '#e2e8f0';
const LYRIC_TRANS_COLOR = '#94a3b8';
// Baseline offsets (alphabetic): the translation hugs its source line
// (27px ≈ source descent 7 + 5px gap + translation ascent 15), while the
// next source line keeps a normal gap (40px ≈ translation descent 5 +
// 14px gap + source ascent 21) instead of the old cramped 26px step.
const TRANS_OFFSET = 27;
const NEXT_SOURCE_OFFSET = 40;

interface LyricBlockLayout {
  /** Wrapped source lines (1 when a translation follows, up to 2 otherwise). */
  textLines: string[];
  /** Wrapped translation lines (0 when the block has no translation to draw). */
  transLines: string[];
  /** Vertical space this block consumes, including the gap to the next block. */
  height: number;
}

/**
 * Measure one lyric block. Wrapping depends on `ctx.font`, so the language
 * specific family is set here instead of relying on whatever the previous
 * block left behind — Issue #336.
 */
function measureLyricBlock(
  ctx: CanvasRenderingContext2D,
  block: LyricLine,
  maxWidth: number,
  includeTranslation: boolean,
): LyricBlockLayout {
  const translation = includeTranslation ? block.translation : null;
  ctx.font = canvasFont(block.lang, LYRIC_TEXT_SIZE);
  const textLines = wrapText(ctx, block.text, maxWidth, translation ? 1 : 2);
  let transLines: string[] = [];
  if (translation) {
    ctx.font = canvasFont(block.translationLang, LYRIC_TRANS_SIZE);
    transLines = wrapText(ctx, translation, maxWidth, 1);
  }
  const textH = textLines.length * LYRIC_TEXT_H;
  const height = translation
    ? textH - LYRIC_TEXT_H + TRANS_OFFSET + NEXT_SOURCE_OFFSET
    : textH;
  return { textLines, transLines, height };
}

/**
 * Index of the first block worth drawing inside `maxHeight`.
 *
 * Blocks are never re-ordered: the card keeps lyric order and shows a
 * contiguous window. The window normally starts at the first selected line,
 * but when the caller pins a line (a `?line=` share link points at it) that
 * would otherwise fall outside the window, the window starts there instead, so
 * the line the user asked to share is never the one that gets dropped.
 *
 * @param heights measured height of each block, in lyric order
 * @param pinned index of the block that must stay visible, or -1
 */
export function lyricWindowStart(heights: readonly number[], maxHeight: number, pinned = -1): number {
  const limit = Math.max(maxHeight, 0);
  let cursor = 0;
  // Number of leading blocks that fit without moving the window.
  let naturalEnd = heights.length;
  for (let i = 0; i < heights.length; i += 1) {
    if (cursor + heights[i] > limit) {
      naturalEnd = i;
      break;
    }
    cursor += heights[i];
  }
  if (pinned <= 0 || pinned < naturalEnd) return 0;
  // The pinned line would be cut off: slide the window down to the last run of
  // blocks that still ends at (and therefore contains) it.
  let start = pinned;
  let tail = 0;
  for (let i = pinned; i >= 0; i -= 1) {
    if (tail + heights[i] > limit) {
      start = i + 1;
      break;
    }
    tail += heights[i];
    start = i;
  }
  return Math.min(start, pinned);
}

/** What a rendered card actually contains: Issue #285 made the silent drop visible. */
export interface ShareCardFit {
  /** Selected lyric blocks that made it into the image. */
  rendered: number;
  /** Selected lyric blocks, i.e. the size of the list handed to the card. */
  total: number;
  /** Selected blocks that were left out (a contiguous window is kept), in lyric order. */
  dropped: LyricLine[];
}

/**
 * Render lyric blocks (source line + optional translation below) inside a
 * bounded area. Translation lines use a smaller, dimmer font so the pair stays
 * visually aligned. Returns what fit, so callers can tell the user instead of
 * silently shipping a truncated image.
 */
function renderLyricBlocks(
  ctx: CanvasRenderingContext2D,
  blocks: LyricLine[],
  opts: {
    x: number;
    y: number;
    maxWidth: number;
    maxHeight: number;
    align: 'left' | 'center';
    includeTranslation: boolean;
    /** Block index that must stay visible even when the window has to slide (or -1). */
    pinned?: number;
  },
): ShareCardFit {
  const { x, y, maxWidth, maxHeight, align, includeTranslation, pinned = -1 } = opts;
  // Measuring sets `ctx.font` per language, so it runs before the drawing pass.
  const layouts = blocks.map((block) => measureLyricBlock(ctx, block, maxWidth, includeTranslation));
  const start = lyricWindowStart(layouts.map((layout) => layout.height), maxHeight, pinned);

  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  let cursorY = y;
  let visibleEnd = start;
  for (let i = start; i < blocks.length; i += 1) {
    const block = blocks[i];
    const layout = layouts[i];
    if (cursorY + layout.height > y + maxHeight) break;

    ctx.fillStyle = LYRIC_TEXT_COLOR;
    ctx.font = canvasFont(block.lang, LYRIC_TEXT_SIZE);
    for (const line of layout.textLines) {
      ctx.fillText(line, x, cursorY);
      cursorY += LYRIC_TEXT_H;
    }
    if (layout.transLines.length > 0) {
      // Translation baseline sits just below the LAST source baseline.
      ctx.fillStyle = LYRIC_TRANS_COLOR;
      ctx.font = canvasFont(block.translationLang, LYRIC_TRANS_SIZE);
      let baseline = cursorY - LYRIC_TEXT_H + TRANS_OFFSET;
      for (const line of layout.transLines) {
        ctx.fillText(line, x, baseline);
        baseline += LYRIC_TRANS_H;
      }
      // Next block's first source baseline keeps a normal gap after the translation.
      cursorY = baseline - LYRIC_TRANS_H + NEXT_SOURCE_OFFSET;
    }
    visibleEnd = i + 1;
  }

  return {
    rendered: visibleEnd - start,
    total: blocks.length,
    dropped: blocks.filter((_, i) => i < start || i >= visibleEnd),
  };
}

async function drawLandscape(
  ctx: CanvasRenderingContext2D,
  song: ShareSong,
  qrDataUrl: string,
  scanText: string,
  siteText: string,
  selectedLyrics: LyricLine[],
  coverImg: HTMLImageElement | null,
  palette: CoverPalette | null,
  showQrCode: boolean,
  showSourceText: boolean,
  includeTranslation: boolean,
  uiTag: string | null | undefined,
  /** Selected block that must stay visible (a `?line=` share target), or -1. */
  pinned: number,
): Promise<ShareCardFit> {
  drawCardBackground(ctx, LANDSCAPE_W, LANDSCAPE_H, palette);

  drawCover(ctx, song, coverImg, 60, 60, 240);

  // Title + artist
  const textX = 330;
  let textY = 115;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#ffffff';
  // Song metadata is not lyric text: like the DOM header it follows the UI language.
  ctx.font = canvasFont(uiTag, 52, 'bold');
  const titleLines = wrapText(ctx, song.title, 560, 2);
  for (const line of titleLines) {
    ctx.fillText(line, textX, textY);
    textY += 66;
  }
  textY += 2;
  ctx.fillStyle = '#94a3b8';
  ctx.font = canvasFont(uiTag, 30);
  const artistLines = wrapText(ctx, song.artist || '', 560, 1);
  for (const line of artistLines) {
    ctx.fillText(line, textX, textY);
    textY += 42;
  }

  // These rows share the header's measured flow: a two-line title now pushes both down.
  const dividerY = artistLines.length > 0 ? textY + 5 : 230;
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(textX, dividerY, 560, 1);

  // Lyrics
  const lyricsX = textX;
  const lyricsY = dividerY + 40;
  const lyricsW = 560;
  const fit = renderLyricBlocks(ctx, selectedLyrics, {
    x: lyricsX,
    y: lyricsY,
    maxWidth: lyricsW,
    maxHeight: LANDSCAPE_H - lyricsY - 10,
    align: 'left',
    includeTranslation,
    pinned,
  });

  // QR
  const qrSize = 180;
  const qrX = 940;
  const qrY = 270;
  const qrImg = showQrCode ? await loadImage(qrDataUrl) : null;
  if (showQrCode && qrImg) {
    ctx.save();
    roundRect(ctx, qrX, qrY, qrSize, qrSize, 16);
    ctx.clip();
    ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);
    ctx.restore();
  }
  drawCaption(ctx, scanText, siteText, qrX + qrSize / 2, qrY + qrSize + 52, showQrCode, showSourceText, uiTag);
  return fit;
}

async function drawPortrait(
  ctx: CanvasRenderingContext2D,
  song: ShareSong,
  qrDataUrl: string,
  scanText: string,
  siteText: string,
  selectedLyrics: LyricLine[],
  coverImg: HTMLImageElement | null,
  palette: CoverPalette | null,
  showQrCode: boolean,
  showSourceText: boolean,
  includeTranslation: boolean,
  uiTag: string | null | undefined,
  /** Selected block that must stay visible (a `?line=` share target), or -1. */
  pinned: number,
): Promise<ShareCardFit> {
  drawCardBackground(ctx, PORTRAIT_W, PORTRAIT_H, palette);

  const pad = 60;
  const contentW = PORTRAIT_W - pad * 2;
  const centerX = PORTRAIT_W / 2;

  const coverSize = 300;
  const coverX = (PORTRAIT_W - coverSize) / 2;
  const coverY = 80;

  drawCover(ctx, song, coverImg, coverX, coverY, coverSize);

  // Title + artist (centered)
  // 64px from cover bottom to title baseline (~31px visual gap with the 44px
  // bold font); artist baseline sits 49px after the LAST title baseline
  // (~18px visual gap) instead of the old 62px (~31px, too far).
  let textY = coverY + coverSize + 64;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#ffffff';
  ctx.font = canvasFont(uiTag, 44, 'bold');
  for (const line of wrapText(ctx, song.title, contentW, 2)) {
    ctx.fillText(line, centerX, textY);
    textY += 58;
  }
  textY -= 9;
  ctx.fillStyle = '#94a3b8';
  ctx.font = canvasFont(uiTag, 26);
  for (const line of wrapText(ctx, song.artist || '', contentW, 1)) {
    ctx.fillText(line, centerX, textY);
    textY += 38;
  }

  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(pad, textY + 36, contentW, 1);

  // QR (positioned before the lyrics so the lyrics area can size around it)
  const qrSize = 180;
  const qrX = (PORTRAIT_W - qrSize) / 2;
  const qrY = PORTRAIT_H - qrSize - 120;

  // Lyrics — translations (when enabled) add a compact line under each source
  // line, so the block area stops just above the QR code.
  const lyricsY = textY + 76;
  const fit = renderLyricBlocks(ctx, selectedLyrics, {
    x: centerX,
    y: lyricsY,
    maxWidth: contentW,
    maxHeight: qrY - lyricsY - 10,
    align: 'center',
    includeTranslation,
    pinned,
  });

  const qrImg = showQrCode ? await loadImage(qrDataUrl) : null;
  if (showQrCode && qrImg) {
    ctx.save();
    roundRect(ctx, qrX, qrY, qrSize, qrSize, 16);
    ctx.clip();
    ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);
    ctx.restore();
  }

  drawCaption(ctx, scanText, siteText, centerX, qrY + qrSize + 52, showQrCode, showSourceText, uiTag);
  return fit;
}

export async function drawCard(
  canvas: HTMLCanvasElement,
  song: ShareSong,
  qrDataUrl: string,
  scanText: string,
  siteText: string,
  selectedLyrics: LyricLine[],
  orientation: Orientation,
  showQrCode: boolean,
  showSourceText: boolean,
  includeTranslation = true,
  /**
   * BCP-47 tag of the UI language. Only the UI-owned strings on the card
   * (title, artist, scan hint, site name) use it — Issue #336: lyrics and
   * translations font by their own language instead (`getLyricLines`).
   * Optional so existing callers keep their historical `sans-serif`-equivalent
   * default (the untagged fallback stack).
   */
  uiTag?: string | null,
  /**
   * Issue #285: the card keeps a contiguous lyric window, and a `?line=` share
   * link must stay inside it, so the caller can pin that line (`pinned` is its
   * index in `selectedLyrics`).
   */
  opts?: { pinned?: number },
): Promise<ShareCardFit | null> {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  if (typeof document !== 'undefined' && 'fonts' in document) {
    await document.fonts.ready;
  }

  const coverImg = await loadImage(song.cover_url);
  const palette = coverImg ? extractMaterialCoverPalette(coverImg) : null;

  const pinned = opts?.pinned ?? -1;
  if (orientation === 'portrait') {
    canvas.width = PORTRAIT_W;
    canvas.height = PORTRAIT_H;
    return drawPortrait(ctx, song, qrDataUrl, scanText, siteText, selectedLyrics, coverImg, palette, showQrCode, showSourceText, includeTranslation, uiTag, pinned);
  }
  canvas.width = LANDSCAPE_W;
  canvas.height = LANDSCAPE_H;
  return drawLandscape(ctx, song, qrDataUrl, scanText, siteText, selectedLyrics, coverImg, palette, showQrCode, showSourceText, includeTranslation, uiTag, pinned);
}
