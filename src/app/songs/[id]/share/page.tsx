/* eslint-disable react-hooks/set-state-in-effect */
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import QRCode from 'qrcode';
import { ArrowLeft, Download, Link2, Loader2, Check, Smartphone, Monitor, RefreshCw } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { useCoverTheme } from '@/hooks/useCoverPalette';
import { drawCard, getLyricLines, LANDSCAPE_H, LANDSCAPE_W, type Orientation, type ShareSong } from '@/lib/share-card';
import { copyToClipboard } from '@/lib/clipboard';

export default function SharePage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useI18n();
  const id = (params?.id as string) || '';
  const defaultLine = searchParams?.get('line');

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [song, setSong] = useState<ShareSong | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // True when the fetch failed for a retryable reason (network/5xx/429) rather
  // than a genuine 404 — the error screen then offers a retry button.
  const [isLoadError, setIsLoadError] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [orientation, setOrientation] = useState<Orientation>('landscape');
  const [showQrCode, setShowQrCode] = useState(true);
  const [showSourceText, setShowSourceText] = useState(true);
  const [includeTranslation, setIncludeTranslation] = useState(true);

  const pageUrl = typeof window !== 'undefined' ? `${window.location.origin}/songs/${id}` : '';
  const coverTheme = useCoverTheme(song?.cover_url);

  const lyricLines = useMemo(() => (song ? getLyricLines(song) : []), [song]);

  useEffect(() => {
    if (!id) {
      setError(t('share.error'));
      setLoading(false);
      return;
    }
    fetch(`/api/songs/${id}`)
      .then((res) => {
        if (res.status === 404) {
          setIsLoadError(false);
          throw new Error('not found');
        }
        if (!res.ok) {
          setIsLoadError(true);
          throw new Error('load failed');
        }
        return res.json();
      })
      .then((data: ShareSong) => {
        setIsLoadError(false);
        setSong(data);
      })
      .catch(() => setError(t('share.error')))
      .finally(() => setLoading(false));
  }, [id, t]);

  const retryLoad = () => {
    setError('');
    setLoading(true);
    // Re-trigger the fetch effect by re-running the same request inline.
    fetch(`/api/songs/${id}`)
      .then((res) => {
        if (res.status === 404) {
          setIsLoadError(false);
          throw new Error('not found');
        }
        if (!res.ok) {
          setIsLoadError(true);
          throw new Error('load failed');
        }
        return res.json();
      })
      .then((data: ShareSong) => {
        setIsLoadError(false);
        setSong(data);
      })
      .catch(() => setError(t('share.error')))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (defaultLine !== null && lyricLines.length > 0) {
      const idx = parseInt(defaultLine, 10);
      // `line` refers to the source-line index on the detail page; match it via
      // each lyric block's original index (skips empty source lines correctly).
      if (!Number.isNaN(idx) && idx >= 0) {
        const match = lyricLines.find((line) => line.index === idx);
        if (match) setSelected(new Set([lyricLines.indexOf(match)]));
      }
    }
  }, [defaultLine, lyricLines]);

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
    const selectedLines = lyricLines.filter((_, i) => selected.has(i));
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
      includeTranslation,
    ).then(() => {
      if (!cancelled) setReady(true);
    });
    return () => { cancelled = true; };
  }, [song, qrDataUrl, pageUrl, t, selected, lyricLines, orientation, showQrCode, showSourceText, includeTranslation]);

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
    const ok = await copyToClipboard(pageUrl);
    if (!ok) return; // ignore silent failure
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
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
        <p className="text-[var(--muted-foreground)]">{isLoadError ? t('share.loadError') : (error || t('share.notFound'))}</p>
        <div className="flex items-center gap-3">
          {isLoadError && (
            <button
              onClick={retryLoad}
              className="song-editor-primary-button inline-flex items-center gap-2 rounded-lg px-4 py-2"
            >
              <RefreshCw className="h-4 w-4" />
              {t('share.retry')}
            </button>
          )}
          <button
            onClick={() => router.push('/')}
            className="song-editor-primary-button inline-flex items-center gap-2 rounded-lg px-4 py-2"
          >
            <ArrowLeft className="h-4 w-4" />
            {t('share.back')}
          </button>
        </div>
      </div>
    );
  }

  const hasLyrics = lyricLines.length > 0;
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
          {hasLyrics && (
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-xs text-[var(--foreground)] transition-colors hover:bg-[var(--accent)]">
              <input
                type="checkbox"
                checked={includeTranslation}
                onChange={(event) => setIncludeTranslation(event.target.checked)}
                className="h-4 w-4 accent-[var(--song-accent)]"
              />
              {t('share.includeTranslation')}
            </label>
          )}
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
              {lyricLines.map((line, idx) => (
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
                  <span className="min-w-0">
                    <span className="line-clamp-2 block text-sm">{line.text}</span>
                    {includeTranslation && line.translation && (
                      <span className="line-clamp-2 mt-0.5 block text-xs text-[var(--muted-foreground)]">{line.translation}</span>
                    )}
                  </span>
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
