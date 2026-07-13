/* eslint-disable react-hooks/set-state-in-effect */
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { ArrowLeft, Download, Link2, Loader2, Check } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

interface Song {
  id: string;
  title: string;
  artist: string;
  cover_url: string | null;
  lyrics_raw: string | null;
  lyrics_synced: string | null;
}

const CARD_W = 1200;
const CARD_H = 630;

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

async function drawCard(
  canvas: HTMLCanvasElement,
  song: Song,
  qrDataUrl: string,
  scanText: string,
  siteText: string,
  selectedLyrics: string[],
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Wait for system fonts to settle
  if (typeof document !== 'undefined' && 'fonts' in document) {
    await document.fonts.ready;
  }

  // Background gradient
  const grad = ctx.createLinearGradient(0, 0, CARD_W, CARD_H);
  grad.addColorStop(0, '#0f172a');
  grad.addColorStop(1, '#1e293b');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // Subtle top accent line
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(60, 40, CARD_W - 120, 2);

  // Cover
  const coverSize = 240;
  const coverX = 60;
  const coverY = 60;
  const coverImg = await loadImage(song.cover_url);
  ctx.save();
  roundRect(ctx, coverX, coverY, coverSize, coverSize, 24);
  ctx.clip();
  if (coverImg) {
    ctx.drawImage(coverImg, coverX, coverY, coverSize, coverSize);
  } else {
    ctx.fillStyle = '#334155';
    ctx.fillRect(coverX, coverY, coverSize, coverSize);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '96px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🎵', coverX + coverSize / 2, coverY + coverSize / 2);
  }
  ctx.restore();

  // Title
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

  // Artist
  textY += 6;
  ctx.fillStyle = '#94a3b8';
  ctx.font = '30px sans-serif';
  const artistLines = wrapText(ctx, song.artist || '', 560, 1);
  for (const line of artistLines) {
    ctx.fillText(line, textX, textY);
    textY += 42;
  }

  // Divider under header
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(textX, 230, 560, 1);

  // Selected lyrics
  const lyricsX = 60;
  const lyricsY = 270;
  const lyricsW = 820;
  const lyricsLineH = 44;
  const lyricsMaxLines = 6;
  ctx.fillStyle = '#e2e8f0';
  ctx.font = '28px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  const lyricsLines: string[] = [];
  for (const line of selectedLyrics) {
    const wrapped = wrapText(ctx, line, lyricsW, lyricsMaxLines - lyricsLines.length);
    lyricsLines.push(...wrapped);
    if (lyricsLines.length >= lyricsMaxLines) break;
  }
  for (let i = 0; i < lyricsLines.length; i++) {
    ctx.fillText(lyricsLines[i], lyricsX, lyricsY + i * lyricsLineH);
  }

  // QR code
  const qrSize = 180;
  const qrX = 940;
  const qrY = 270;
  const qrImg = await loadImage(qrDataUrl);
  if (qrImg) {
    ctx.save();
    roundRect(ctx, qrX, qrY, qrSize, qrSize, 16);
    ctx.clip();
    ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);
    ctx.restore();
  }

  // Caption below QR with larger margin
  const captionY = qrY + qrSize + 52;
  ctx.fillStyle = '#cbd5e1';
  ctx.font = '22px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(scanText, qrX + qrSize / 2, captionY);
  ctx.fillStyle = '#94a3b8';
  ctx.font = '18px sans-serif';
  ctx.fillText(siteText, qrX + qrSize / 2, captionY + 32);
}

export default function SharePage() {
  const params = useParams();
  const router = useRouter();
  const { t } = useI18n();
  const id = (params?.id as string) || '';

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [song, setSong] = useState<Song | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const pageUrl = typeof window !== 'undefined' ? `${window.location.origin}/songs/${id}` : '';

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
    if (lyricsLines.length > 0 && selected.size === 0) {
      // Default: select first 4 lines
      const initial = new Set<number>();
      for (let i = 0; i < Math.min(4, lyricsLines.length); i++) {
        initial.add(i);
      }
      setSelected(initial);
    }
  }, [lyricsLines, selected.size]);

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
    if (!song || !qrDataUrl || !canvasRef.current) return;
    setReady(false);
    let cancelled = false;
    const selectedLines = lyricsLines.filter((_, i) => selected.has(i));
    drawCard(
      canvasRef.current,
      song,
      qrDataUrl,
      t('share.scan'),
      t('share.site', { site: window.location.host }),
      selectedLines,
    ).then(() => {
      if (!cancelled) setReady(true);
    });
    return () => { cancelled = true; };
  }, [song, qrDataUrl, pageUrl, t, selected, lyricsLines]);

  const toggleLine = (idx: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const handleDownload = () => {
    const canvas = canvasRef.current;
    if (!canvas || !song) return;
    try {
      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `share-${song.title || id}.png`;
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
          className="inline-flex items-center gap-2 rounded-lg bg-[var(--primary)] px-4 py-2 text-[var(--primary-foreground)]"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('share.back')}
        </button>
      </div>
    );
  }

  const hasLyrics = lyricsLines.length > 0;

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <div className="mx-auto max-w-3xl px-4 py-6">
        <div className="mb-6 flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--accent)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            aria-label={t('common.close')}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-xl font-semibold">{t('share.title')}</h1>
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm">
          <canvas
            ref={canvasRef}
            width={CARD_W}
            height={CARD_H}
            className="h-auto w-full"
          />
          {!ready && (
            <div className="absolute inset-0 flex items-center justify-center bg-[var(--card)]/80 backdrop-blur-sm">
              <Loader2 className="h-8 w-8 animate-spin text-[var(--muted-foreground)]" />
            </div>
          )}
        </div>

        <p className="mt-4 text-center text-sm text-[var(--muted-foreground)]">
          {t('share.hint')}
        </p>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <button
            onClick={handleDownload}
            disabled={!ready}
            className="inline-flex items-center gap-2 rounded-xl bg-[var(--primary)] px-5 py-2.5 font-medium text-[var(--primary-foreground)] disabled:opacity-50"
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
          <div className="mt-8 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
            <h2 className="mb-3 text-sm font-medium text-[var(--muted-foreground)]">
              {t('share.selectLyrics')}
            </h2>
            <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
              {lyricsLines.map((line, idx) => (
                <button
                  key={idx}
                  onClick={() => toggleLine(idx)}
                  className={`flex w-full items-start gap-3 rounded-xl px-3 py-2 text-left transition-colors ${
                    selected.has(idx)
                      ? 'bg-[var(--primary)]/10 text-[var(--foreground)]'
                      : 'bg-[var(--accent)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                  }`}
                >
                  <span
                    className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                      selected.has(idx)
                        ? 'border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]'
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
          <p className="mt-8 text-center text-sm text-[var(--muted-foreground)]">
            {t('share.noLyrics')}
          </p>
        )}
      </div>
    </div>
  );
}
