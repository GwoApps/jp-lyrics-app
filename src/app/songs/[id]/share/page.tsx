'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { ArrowLeft, Download, Link2, Loader2 } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

interface Song {
  id: string;
  title: string;
  artist: string;
  cover_url: string | null;
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

async function drawCard(
  canvas: HTMLCanvasElement,
  song: Song,
  qrDataUrl: string,
  pageUrl: string,
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
  ctx.fillRect(80, 40, CARD_W - 160, 2);

  // Cover
  const coverX = 80;
  const coverY = 75;
  const coverSize = 480;
  const coverImg = await loadImage(song.cover_url);
  ctx.save();
  roundRect(ctx, coverX, coverY, coverSize, coverSize, 32);
  ctx.clip();
  if (coverImg) {
    ctx.drawImage(coverImg, coverX, coverY, coverSize, coverSize);
  } else {
    ctx.fillStyle = '#334155';
    ctx.fillRect(coverX, coverY, coverSize, coverSize);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '120px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🎵', coverX + coverSize / 2, coverY + coverSize / 2);
  }
  ctx.restore();

  // Title
  const textX = 620;
  let textY = 150;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 64px sans-serif';
  const titleLines = wrapText(ctx, song.title, 520, 3);
  for (const line of titleLines) {
    ctx.fillText(line, textX, textY);
    textY += 78;
  }

  // Artist
  textY += 10;
  ctx.fillStyle = '#94a3b8';
  ctx.font = '42px sans-serif';
  const artistLines = wrapText(ctx, song.artist || '', 520, 2);
  for (const line of artistLines) {
    ctx.fillText(line, textX, textY);
    textY += 56;
  }

  // QR code
  const qrSize = 200;
  const qrX = 920;
  const qrY = 360;
  const qrImg = await loadImage(qrDataUrl);
  if (qrImg) {
    ctx.save();
    roundRect(ctx, qrX, qrY, qrSize, qrSize, 16);
    ctx.clip();
    ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);
    ctx.restore();
  }

  // URL below QR
  ctx.fillStyle = '#cbd5e1';
  ctx.font = '20px monospace';
  ctx.textAlign = 'center';
  const urlText = pageUrl.replace(/^https?:\/\//, '');
  ctx.fillText(urlText, qrX + qrSize / 2, qrY + qrSize + 34);
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

  const pageUrl = typeof window !== 'undefined' ? `${window.location.origin}/songs/${id}` : '';

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
    drawCard(canvasRef.current, song, qrDataUrl, pageUrl).then(() => {
      if (!cancelled) setReady(true);
    });
    return () => { cancelled = true; };
  }, [song, qrDataUrl, pageUrl]);

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
      // Fallback: open image in new tab
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
      </div>
    </div>
  );
}
