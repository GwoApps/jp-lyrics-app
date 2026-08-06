/**
 * Canvas drawing for the share card (pure functions, no React).
 * Renders the lyric card background, cover art, caption and QR code.
 */

import { extractMaterialCoverPalette, type CoverColor, type CoverPalette } from '@/lib/cover-color';

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
}

/** A lyric line with its optional translation (aligned by source line index). */
export interface LyricLine {
  /** Lyric text with LRC tags stripped. */
  text: string;
  /** Aligned translation for this line, or null when absent. */
  translation: string | null;
  /** Original index in the source lyrics (`lyrics_raw`/`lyrics_synced`), used to align with detail-page `?line=` links. */
  index: number;
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
  return line.replace(/\[\d{2}:\d{2}(\.\d+)?\]/g, '').trim();
}

function parseTranslations(song: ShareSong): string[] {
  if (!song.lyrics_translation) return [];
  try {
    const parsed = JSON.parse(song.lyrics_translation);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
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
  const lines: LyricLine[] = [];
  raw.split('\n').forEach((rawLine, index) => {
    const text = stripLrcTags(rawLine);
    if (!text) return;
    const translation = translations[index]?.trim();
    lines.push({ text, translation: translation || null, index });
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
    ctx.font = `${Math.floor(size * 0.4)}px sans-serif`;
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
) {
  ctx.textAlign = 'center';
  let textY = startY;
  if (showQrCode) {
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '22px sans-serif';
    ctx.fillText(scanText, centerX, textY);
    textY += 32;
  }
  if (showSourceText) {
    ctx.fillStyle = '#94a3b8';
    ctx.font = '18px sans-serif';
    ctx.fillText(siteText, centerX, textY);
  }
}

/**
 * Render lyric blocks (source line + optional translation below) inside a
 * bounded area. Translation lines use a smaller, dimmer font so the pair stays
 * visually aligned. Returns the number of blocks rendered (blocks that do not
 * fit are dropped).
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
  },
): number {
  const { x, y, maxWidth, maxHeight, align, includeTranslation } = opts;
  const textH = 44;
  const transH = 26;
  const textFont = '28px sans-serif';
  const transFont = '20px sans-serif';
  const textColor = '#e2e8f0';
  const transColor = '#94a3b8';

  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  let cursorY = y;
  let rendered = 0;
  for (const block of blocks) {
    // Wrap the source line on its own (1 line when a translation follows, 2 otherwise).
    const textLines = wrapText(ctx, block.text, maxWidth, includeTranslation ? 1 : 2);
    const translation = includeTranslation ? block.translation : null;
    const blockH = textLines.length * textH + (translation ? transH : 0);
    if (cursorY + blockH > y + maxHeight) break;

    ctx.fillStyle = textColor;
    ctx.font = textFont;
    for (const line of textLines) {
      ctx.fillText(line, x, cursorY);
      cursorY += textH;
    }
    if (translation) {
      ctx.fillStyle = transColor;
      ctx.font = transFont;
      for (const line of wrapText(ctx, translation, maxWidth, 1)) {
        ctx.fillText(line, x, cursorY);
        cursorY += transH;
      }
    }
    rendered += 1;
  }
  return rendered;
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
) {
  drawCardBackground(ctx, LANDSCAPE_W, LANDSCAPE_H, palette);

  drawCover(ctx, song, coverImg, 60, 60, 240);

  // Title + artist
  const textX = 330;
  let textY = 115;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 52px sans-serif';
  const titleLines = wrapText(ctx, song.title, 560, 2);
  for (const line of titleLines) {
    ctx.fillText(line, textX, textY);
    textY += 66;
  }
  textY += 2;
  ctx.fillStyle = '#94a3b8';
  ctx.font = '30px sans-serif';
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
  renderLyricBlocks(ctx, selectedLyrics, {
    x: lyricsX,
    y: lyricsY,
    maxWidth: lyricsW,
    maxHeight: LANDSCAPE_H - lyricsY - 10,
    align: 'left',
    includeTranslation,
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
  drawCaption(ctx, scanText, siteText, qrX + qrSize / 2, qrY + qrSize + 52, showQrCode, showSourceText);
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
) {
  drawCardBackground(ctx, PORTRAIT_W, PORTRAIT_H, palette);

  const pad = 60;
  const contentW = PORTRAIT_W - pad * 2;
  const centerX = PORTRAIT_W / 2;

  const coverSize = 300;
  const coverX = (PORTRAIT_W - coverSize) / 2;
  const coverY = 80;

  drawCover(ctx, song, coverImg, coverX, coverY, coverSize);

  // Title + artist (centered)
  let textY = coverY + coverSize + 48;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 44px sans-serif';
  for (const line of wrapText(ctx, song.title, contentW, 2)) {
    ctx.fillText(line, centerX, textY);
    textY += 58;
  }
  textY += 4;
  ctx.fillStyle = '#94a3b8';
  ctx.font = '26px sans-serif';
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
  renderLyricBlocks(ctx, selectedLyrics, {
    x: centerX,
    y: lyricsY,
    maxWidth: contentW,
    maxHeight: qrY - lyricsY - 10,
    align: 'center',
    includeTranslation,
  });

  const qrImg = showQrCode ? await loadImage(qrDataUrl) : null;
  if (showQrCode && qrImg) {
    ctx.save();
    roundRect(ctx, qrX, qrY, qrSize, qrSize, 16);
    ctx.clip();
    ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);
    ctx.restore();
  }
  drawCaption(ctx, scanText, siteText, centerX, qrY + qrSize + 52, showQrCode, showSourceText);
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
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  if (typeof document !== 'undefined' && 'fonts' in document) {
    await document.fonts.ready;
  }

  const coverImg = await loadImage(song.cover_url);
  const palette = coverImg ? extractMaterialCoverPalette(coverImg) : null;

  if (orientation === 'portrait') {
    canvas.width = PORTRAIT_W;
    canvas.height = PORTRAIT_H;
    await drawPortrait(ctx, song, qrDataUrl, scanText, siteText, selectedLyrics, coverImg, palette, showQrCode, showSourceText, includeTranslation);
  } else {
    canvas.width = LANDSCAPE_W;
    canvas.height = LANDSCAPE_H;
    await drawLandscape(ctx, song, qrDataUrl, scanText, siteText, selectedLyrics, coverImg, palette, showQrCode, showSourceText, includeTranslation);
  }
}
