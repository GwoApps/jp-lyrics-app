/* eslint-disable react-hooks/set-state-in-effect */
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import QRCode from 'qrcode';
import { ArrowLeft, Download, Link2, Loader2, Check, Smartphone, Monitor } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { extractMaterialCoverPalette, type CoverColor, type CoverPalette } from '@/lib/cover-color';
import { useCoverTheme } from '@/hooks/useCoverPalette';

interface Song {
  id: string;
  title: string;
  artist: string;
  cover_url: string | null;
  lyrics_raw: string | null;
  lyrics_synced: string | null;
}

type Orientation = 'landscape' | 'portrait';

const LANDSCAPE_W = 1200;
const LANDSCAPE_H = 630;
const PORTRAIT_W = 630;
const PORTRAIT_H = 1200;

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

function getLyricsLines(song: Song): string[] {
  const raw = song.lyrics_raw || song.lyrics_synced;
  if (!raw) return [];
  return raw
    .split('\n')
    .map(stripLrcTags)
    .filter((line) => line.length > 0);
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  song: Song,
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
  song: Song,
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
  song: Song,
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

async function drawCard(
  canvas: HTMLCanvasElement,
  song: Song,
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

export default function SharePage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useI18n();
  const id = (params?.id as string) || '';
  const defaultLine = searchParams?.get('line');

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [song, setSong] = useState<Song | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [orientation, setOrientation] = useState<Orientation>('landscape');
  const [showQrCode, setShowQrCode] = useState(true);
  const [showSourceText, setShowSourceText] = useState(true);

  const pageUrl = typeof window !== 'undefined' ? `${window.location.origin}/songs/${id}` : '';
  const coverTheme = useCoverTheme(song?.cover_url);

  const lyricsLines = useMemo(() => (song ? getLyricsLines(song) : []), [song]);

  useEffect(() => {
    if (!id) {
      setError(t('share.error'));
      setLoading(false);
      return;
    }
    fetch(`/api/songs/${id}`)
      .then((res) => {
        if (!res.ok) throw new Error('not found');
        return res.json();
      })
      .then((data: Song) => setSong(data))
      .catch(() => setError(t('share.error')))
      .finally(() => setLoading(false));
  }, [id, t]);

  useEffect(() => {
    if (defaultLine !== null && lyricsLines.length > 0) {
      const idx = parseInt(defaultLine, 10);
      if (!Number.isNaN(idx) && idx >= 0 && idx < lyricsLines.length) {
        setSelected(new Set([idx]));
      }
    }
  }, [defaultLine, lyricsLines.length]);

  useEffect(() => {
    if (!pageUrl) return;
    let cancelled = false;
    QRCode.toDataURL(pageUrl, { width: 360, margin: 2, color: { dark: '#0f172a', light: '#ffffff' } })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => setQrDataUrl(null));
    return () => { cancelled = true; };
  }, [pageUrl]);

  useEffect(() => {
    if (!song || !canvasRef.current) return;
    if (showQrCode && !qrDataUrl) {
      setReady(false);
      return;
    }
    setReady(false);
    let cancelled = false;
    const selectedLines = lyricsLines.filter((_, i) => selected.has(i));
    drawCard(
      canvasRef.current,
      song,
      qrDataUrl || '',
      t('share.scan'),
      t('share.site', { site: window.location.host }),
      selectedLines,
      orientation,
      showQrCode,
      showSourceText,
    ).then(() => {
      if (!cancelled) setReady(true);
    });
    return () => { cancelled = true; };
  }, [song, qrDataUrl, pageUrl, t, selected, lyricsLines, orientation, showQrCode, showSourceText]);

  const toggleLine = (idx: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const clearSelection = () => setSelected(new Set());

  const handleDownload = () => {
    const canvas = canvasRef.current;
    if (!canvas || !song) return;
    try {
      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `share-${song.title || id}-${orientation}.png`;
        a.click();
        URL.revokeObjectURL(url);
      }, 'image/png');
    } catch {
      const url = canvas.toDataURL('image/png');
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(pageUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--background)] text-[var(--foreground)]">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--muted-foreground)]" />
      </div>
    );
  }

  if (error || !song) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-[var(--background)] text-[var(--foreground)] px-6">
        <p className="text-[var(--muted-foreground)]">{error || t('share.notFound')}</p>
        <button
          onClick={() => router.push('/')}
          className="song-editor-primary-button inline-flex items-center gap-2 rounded-lg px-4 py-2"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('share.back')}
        </button>
      </div>
    );
  }

  const hasLyrics = lyricsLines.length > 0;
  const cardAspectClass = orientation === 'portrait'
    ? 'max-w-md'
    : 'max-w-3xl';

  return (
    <div className={`song-view song-editor-page min-h-screen text-[var(--foreground)]${coverTheme.isThemed ? ' song-view--accented' : ''}`} style={coverTheme.style}>
      <div className={`mx-auto px-3 py-3 sm:px-4 sm:py-6 ${cardAspectClass}`}>
        {/* Align navigation and heading scale with the song-detail page. */}
        <div className="mb-3 flex items-center gap-1.5 text-xs text-[var(--muted-foreground)] sm:mb-8">
          <button onClick={() => router.push(`/songs/${id}`)} className="inline-flex items-center gap-1 transition-colors hover:text-[var(--foreground)]">
            <ArrowLeft className="h-3 w-3" />
            <span className="max-w-[200px] truncate sm:max-w-[320px]">{song.title}</span>
          </button>
          <span className="opacity-40">/</span>
          <span className="text-[var(--foreground)]">{t('share.title')}</span>
        </div>

        <div className="mb-3 flex items-center justify-between gap-2 sm:mb-6 sm:gap-3">
          <h1 className="text-base font-semibold tracking-tight sm:text-xl">{t('share.title')}</h1>

          <div className="inline-flex items-center gap-1 rounded-lg bg-[var(--accent)] p-1">
            <button
              onClick={() => setOrientation('landscape')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                orientation === 'landscape'
                  ? 'song-editor-primary-button'
                  : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
              }`}
              title={t('share.landscape')}
            >
              <Monitor className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t('share.landscape')}</span>
            </button>
            <button
              onClick={() => setOrientation('portrait')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                orientation === 'portrait'
                  ? 'song-editor-primary-button'
                  : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
              }`}
              title={t('share.portrait')}
            >
              <Smartphone className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t('share.portrait')}</span>
            </button>
          </div>
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2 sm:mb-4">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs text-[var(--foreground)] transition-colors hover:bg-[var(--accent)]">
            <input
              type="checkbox"
              checked={showQrCode}
              onChange={(event) => setShowQrCode(event.target.checked)}
              className="h-4 w-4 accent-[var(--song-accent)]"
            />
            {t('share.showQrCode')}
          </label>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs text-[var(--foreground)] transition-colors hover:bg-[var(--accent)]">
            <input
              type="checkbox"
              checked={showSourceText}
              onChange={(event) => setShowSourceText(event.target.checked)}
              className="h-4 w-4 accent-[var(--song-accent)]"
            />
            {t('share.showSourceText')}
          </label>
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm">
          <canvas
            ref={canvasRef}
            width={LANDSCAPE_W}
            height={LANDSCAPE_H}
            className="h-auto w-full"
          />
          {!ready && (
            <div className="absolute inset-0 flex items-center justify-center bg-[var(--card)]/80 backdrop-blur-sm">
              <Loader2 className="h-8 w-8 animate-spin text-[var(--muted-foreground)]" />
            </div>
          )}
        </div>

        <p className="mt-2 text-center text-sm text-[var(--muted-foreground)] sm:mt-4">
          {t('share.hint')}
        </p>

        <div className="mt-4 flex flex-wrap items-center justify-center gap-2 sm:mt-6 sm:gap-3">
          <button
            onClick={handleDownload}
            disabled={!ready}
            className="song-editor-primary-button inline-flex items-center gap-2 rounded-xl px-5 py-2.5 font-medium disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            {t('share.download')}
          </button>
          <button
            onClick={handleCopyLink}
            className="inline-flex items-center gap-2 rounded-xl bg-[var(--accent)] px-5 py-2.5 font-medium text-[var(--foreground)] hover:bg-[var(--muted)]"
          >
            <Link2 className="h-4 w-4" />
            {copied ? t('share.copied') : t('share.copyLink')}
          </button>
        </div>

        {hasLyrics && (
          <div className="mt-5 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-3 sm:mt-8 sm:p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-medium text-[var(--muted-foreground)]">
                {t('share.selectLyrics')}
              </h2>
              {selected.size > 0 && (
                <button
                  onClick={clearSelection}
                  className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
                >
                  {t('share.clear')}
                </button>
              )}
            </div>
            <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
              {lyricsLines.map((line, idx) => (
                <button
                  key={idx}
                  onClick={() => toggleLine(idx)}
                  className={`flex w-full items-start gap-3 rounded-xl px-3 py-2 text-left transition-colors ${
                    selected.has(idx)
                      ? 'song-editor-choice--active'
                      : 'bg-[var(--accent)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                  }`}
                >
                  <span
                    className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                      selected.has(idx)
                        ? 'border-[var(--song-accent)] song-editor-primary-button'
                        : 'border-[var(--border)] bg-[var(--background)]'
                    }`}
                  >
                    {selected.has(idx) && <Check className="h-3.5 w-3.5" />}
                  </span>
                  <span className="line-clamp-2 text-sm">{line}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {!hasLyrics && (
          <p className="mt-5 text-center text-sm text-[var(--muted-foreground)] sm:mt-8">
            {t('share.noLyrics')}
          </p>
        )}
      </div>
    </div>
  );
}
