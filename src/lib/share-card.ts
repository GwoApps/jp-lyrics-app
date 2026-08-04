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

export function getLyricsLines(song: ShareSong): string[] {
  const raw = song.lyrics_raw || song.lyrics_synced;
  if (!raw) return [];
  return raw
    .split('\n')
    .map(stripLrcTags)
    .filter((line) => line.length > 0);
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

async function drawLandscape(
  ctx: CanvasRenderingContext2D,
  song: ShareSong,
  qrDataUrl: string,
  scanText: string,
  siteText: string,
  selectedLyrics: string[],
  coverImg: HTMLImageElement | null,
  palette: CoverPalette | null,
  showQrCode: boolean,
  showSourceText: boolean,
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
  const lyricsLineH = 44;
  const lyricsMaxLines = 6;
  ctx.fillStyle = '#e2e8f0';
  ctx.font = '28px sans-serif';
  ctx.textAlign = 'left';
  const lyricsLines: string[] = [];
  for (const line of selectedLyrics) {
    const wrapped = wrapText(ctx, line, lyricsW, lyricsMaxLines - lyricsLines.length);
    lyricsLines.push(...wrapped);
    if (lyricsLines.length >= lyricsMaxLines) break;
  }
  for (let i = 0; i < lyricsLines.length; i++) {
    ctx.fillText(lyricsLines[i], lyricsX, lyricsY + i * lyricsLineH);
  }

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
  selectedLyrics: string[],
  coverImg: HTMLImageElement | null,
  palette: CoverPalette | null,
  showQrCode: boolean,
  showSourceText: boolean,
) {
  drawCardBackground(ctx, PORTRAIT_W, PORTRAIT_H, palette);

  const pad = 60;
  const contentW = PORTRAIT_W - pad * 2;
  const centerX = PORTRAIT_W / 2;

  const coverSize = 380;
  const coverX = (PORTRAIT_W - coverSize) / 2;
  const coverY = 80;

  drawCover(ctx, song, coverImg, coverX, coverY, coverSize);

  // Title + artist (centered)
  let textY = coverY + coverSize + 64;
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

  // Lyrics
  const lyricsY = textY + 84;
  const lyricsLineH = 44;
  const lyricsMaxLines = 4;
  ctx.fillStyle = '#e2e8f0';
  ctx.font = '28px sans-serif';
  const lyricsLines: string[] = [];
  for (const line of selectedLyrics) {
    const wrapped = wrapText(ctx, line, contentW, lyricsMaxLines - lyricsLines.length);
    lyricsLines.push(...wrapped);
    if (lyricsLines.length >= lyricsMaxLines) break;
  }
  for (let i = 0; i < lyricsLines.length; i++) {
    ctx.fillText(lyricsLines[i], centerX, lyricsY + i * lyricsLineH);
  }

  // QR
  const qrSize = 180;
  const qrX = (PORTRAIT_W - qrSize) / 2;
  const qrY = PORTRAIT_H - qrSize - 120;
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
  selectedLyrics: string[],
  orientation: Orientation,
  showQrCode: boolean,
  showSourceText: boolean,
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
    await drawPortrait(ctx, song, qrDataUrl, scanText, siteText, selectedLyrics, coverImg, palette, showQrCode, showSourceText);
  } else {
    canvas.width = LANDSCAPE_W;
    canvas.height = LANDSCAPE_H;
    await drawLandscape(ctx, song, qrDataUrl, scanText, siteText, selectedLyrics, coverImg, palette, showQrCode, showSourceText);
  }
}
