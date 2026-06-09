'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import type { FuriganaLine } from '@/lib/types';
import { parseLrc } from '@/lib/lrc';
import type { SpotifyState } from './useSpotifySync';
import { findBestMatch, lineFuzzyMatch } from '@/lib/match';
import { useI18n } from '@/lib/i18n';
import { convertToFuriganaClient } from '@/lib/kuroshiro-client';

interface SongData {
  id: string;
  title: string;
  artist: string;
  lyrics_raw: string;
  lyrics_furigana: string;
  lyrics_synced: string;
  created_at: string;
  updated_at: string;
}

interface ToastState {
  type: 'success' | 'error';
  msg: string;
}

export interface UseSongDataReturn {
  song: SongData | null;
  loading: boolean;
  syncLines: ReturnType<typeof parseLrc>;
  furiganaLines: FuriganaLine[];
  furiganaLoading: boolean;
  lineTimestamps: (number | null)[];
  syncing: boolean;
  syncError: string;
  importing: boolean;
  copied: boolean;
  showRaw: boolean;
  setShowRaw: React.Dispatch<React.SetStateAction<boolean>>;
  debug: boolean;
  setDebug: React.Dispatch<React.SetStateAction<boolean>>;
  showPasteLrc: boolean;
  setShowPasteLrc: React.Dispatch<React.SetStateAction<boolean>>;
  pasteLrcText: string;
  setPasteLrcText: React.Dispatch<React.SetStateAction<string>>;
  showExport: boolean;
  setShowExport: React.Dispatch<React.SetStateAction<boolean>>;
  deleteConfirm: boolean;
  setDeleteConfirm: React.Dispatch<React.SetStateAction<boolean>>;
  importAlert: string | null;
  setImportAlert: React.Dispatch<React.SetStateAction<string | null>>;
  fontSize: number;
  setFontSize: React.Dispatch<React.SetStateAction<number>>;
  toast: ToastState | null;
  allSongs: { id: string; title: string; artist: string }[];
  lyricsRef: React.RefObject<HTMLDivElement | null>;
  lineRefs: React.RefObject<(HTMLDivElement | null)[]>;
  handleSync: () => Promise<void>;
  handlePasteLrc: () => Promise<void>;
  handleDelete: () => void;
  confirmDelete: () => Promise<void>;
  handleCopy: () => Promise<void>;
  handleImportPlaying: (spotify: SpotifyState | null) => Promise<void>;
  openPiP: (
    furiganaLines: FuriganaLine[],
    song: SongData | null,
    highlightLine: number,
    pipWindowRef: React.MutableRefObject<Window | null>,
  ) => Promise<void>;
  showToast: (type: 'success' | 'error', msg: string) => void;
}

export function useSongData(id: string): UseSongDataReturn {
  const router = useRouter();
  const { t } = useI18n();

  const [song, setSong] = useState<SongData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showRaw, setShowRaw] = useState(false);
  const [debug, setDebug] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [importAlert, setImportAlert] = useState<string | null>(null);
  const [syncLines, setSyncLines] = useState<ReturnType<typeof parseLrc>>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState('');
  const [importing, setImporting] = useState(false);
  const [allSongs, setAllSongs] = useState<{ id: string; title: string; artist: string }[]>([]);
  const [showPasteLrc, setShowPasteLrc] = useState(false);
  const [pasteLrcText, setPasteLrcText] = useState('');
  const [copied, setCopied] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [fontSize, setFontSize] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('jplrc-font-size');
      if (saved) { const n = parseInt(saved); if (n >= 14 && n <= 32) return n; }
    }
    return 20;
  });

  const lyricsRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Persist font size
  useEffect(() => { localStorage.setItem('jplrc-font-size', String(fontSize)); }, [fontSize]);

  // Derived
  const serverFurigana = useMemo<FuriganaLine[]>(() => {
    if (!song?.lyrics_furigana) return [];
    try { return JSON.parse(song.lyrics_furigana); } catch { return []; }
  }, [song?.lyrics_furigana]);

  // Client-side furigana (lazy-loaded from kuromoji-es CDN when needed)
  const [clientFurigana, setClientFurigana] = useState<FuriganaLine[]>([]);
  const [furiganaLoading, setFuriganaLoading] = useState(false);

  const furiganaLines = useMemo<FuriganaLine[]>(() => {
    // Prefer server-side pre-computed data (existing songs)
    if (serverFurigana.length > 0) return serverFurigana;
    // Fall back to client-side computed data
    if (clientFurigana.length > 0) return clientFurigana;
    return [];
  }, [serverFurigana, clientFurigana]);

  // Client-side furigana conversion: only when server has no furigana but raw lyrics exist
  useEffect(() => {
    if (!song?.lyrics_raw?.trim()) return;
    if (serverFurigana.length > 0) return; // server already has it
    if (clientFurigana.length > 0) return; // already computed
    if (furiganaLoading) return;

    setFuriganaLoading(true);
    convertToFuriganaClient(song.lyrics_raw)
      .then((lines) => setClientFurigana(lines))
      .catch((e) => console.error('Client furigana conversion failed:', e))
      .finally(() => setFuriganaLoading(false));
  }, [song?.lyrics_raw, serverFurigana.length, clientFurigana.length, furiganaLoading]);

  const lineTimestamps = useMemo(() => {
    if (!syncLines.length || !furiganaLines.length) return [] as (number | null)[];
    const ts: (number | null)[] = [];
    let si = 0;
    for (let fi = 0; fi < furiganaLines.length; fi++) {
      const fl = furiganaLines[fi];
      if (fl.segments.length === 0) { ts.push(null); continue; }
      const flText = fl.segments.map((s: { text: string }) => s.text).join('').replace(/\s+/g, '');
      let bestJ = -1;
      for (let j = si; j < Math.min(syncLines.length, si + 10); j++) {
        if (lineFuzzyMatch(flText, syncLines[j].text.replace(/\s+/g, ''))) {
          bestJ = j; break;
        }
      }
      if (bestJ >= 0) {
        ts.push(syncLines[bestJ].timeMs);
        si = bestJ + 1;
      } else if (si < syncLines.length) {
        ts.push(syncLines[si].timeMs);
        si++;
      } else {
        ts.push(null);
      }
    }
    return ts;
  }, [syncLines, furiganaLines]);

  const showToast = useCallback((type: 'success' | 'error', msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3000);
  }, []);

  // Fetch song + all songs on mount
  useEffect(() => {
    if (!id) return;
    fetch(`/api/songs/${id}`)
      .then((r) => { if (!r.ok) throw new Error('Not found'); return r.json(); })
      .then((data) => {
        setSong(data);
        setLoading(false);
        if (data.lyrics_synced) setSyncLines(parseLrc(data.lyrics_synced));
      })
      .catch(() => setLoading(false));

    fetch('/api/songs')
      .then((r) => r.json())
      .then((data) => setAllSongs(data.map((s: { id: string; title: string; artist: string }) => ({ id: s.id, title: s.title, artist: s.artist }))))
      .catch(() => {});
  }, [id]);

  // Handlers
  const handleSync = useCallback(async () => {
    setSyncing(true);
    setSyncError('');
    try {
      const res = await fetch(`/api/songs/${id}/sync`, { method: 'POST' });
      const data = await res.json();
      if (data.synced) {
        const songRes = await fetch(`/api/songs/${id}`);
        if (songRes.ok) {
          const updated = await songRes.json();
          setSong(updated);
          setSyncLines(parseLrc(data.lrc));
        }
        showToast('success', t('song.synced', { source: data.source, lines: String(data.lines) }));
      } else {
        setSyncError(data.error || t('song.syncNotFound'));
        setImportAlert(data.error || t('song.syncNotFoundManual'));
      }
    } catch {
      setSyncError(t('song.networkError'));
      setImportAlert(t('song.networkErrorAlert'));
    } finally {
      setSyncing(false);
    }
  }, [id, t, showToast]);

  const handlePasteLrc = useCallback(async () => {
    if (!pasteLrcText.trim()) return;
    try {
      const res = await fetch(`/api/songs/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lyrics_synced: pasteLrcText.trim() }),
      });
      if (res.ok) {
        const songRes = await fetch(`/api/songs/${id}`);
        if (songRes.ok) {
          const updated = await songRes.json();
          setSong(updated);
          setSyncLines(parseLrc(pasteLrcText.trim()));
        }
        setShowPasteLrc(false);
        setPasteLrcText('');
        setSyncError('');
        showToast('success', t('song.lyricsSaved'));
      }
    } catch {
      showToast('error', t('song.saveFailed'));
    }
  }, [id, pasteLrcText, t, showToast]);

  const handleDelete = useCallback(() => {
    if (!song) return;
    setDeleteConfirm(true);
  }, [song]);

  const confirmDelete = useCallback(async () => {
    if (!song) return;
    const res = await fetch(`/api/songs/${id}`, { method: 'DELETE' });
    if (res.ok) { showToast('success', t('home.deleted')); setTimeout(() => router.push('/'), 800); }
    setDeleteConfirm(false);
  }, [id, song, router, t, showToast]);

  const handleCopy = useCallback(async () => {
    if (!song) return;
    const text = song.lyrics_raw || furiganaLines.map(l => l.segments.map(s => s.text).join('')).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast('error', t('song.copyFailed'));
    }
  }, [song, furiganaLines, t, showToast]);

  const handleImportPlaying = useCallback(async (spotify: SpotifyState | null) => {
    if (!spotify?.track) return;
    setImporting(true);
    try {
      const res = await fetch('/api/songs/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: spotify.track.name, artist: spotify.track.artist }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setImportAlert(data.error || t('song.importFailed'));
        return;
      }
      router.push(`/songs/${data.id}`);
    } catch {
      showToast('error', t('song.importFailed'));
    } finally {
      setImporting(false);
    }
  }, [router, t, showToast]);

  // PiP is complex and needs external refs, so it's a callback the page calls with context
  const openPiP = useCallback(async (
    furiganaLinesArg: FuriganaLine[],
    songArg: SongData | null,
    highlightLine: number,
    pipWindowRef: React.MutableRefObject<Window | null>,
  ) => {
    if (pipWindowRef.current && !pipWindowRef.current.closed) {
      pipWindowRef.current.close();
      pipWindowRef.current = null;
      return;
    }

    if (!('documentPictureInPicture' in window)) {
      showToast('error', t('song.pipUnsupported'));
      return;
    }

    if (furiganaLinesArg.length === 0) {
      showToast('error', t('song.noLyrics'));
      return;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pipWindow = await (window as any).documentPictureInPicture.requestWindow({
        width: 380,
        height: 520,
      });

      pipWindowRef.current = pipWindow;

      const title = songArg?.title || '';
      const artist = songArg?.artist || '';

      pipWindow.document.documentElement.innerHTML = `
        <head>
          <meta name="color-scheme" content="dark">
          <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500&display=swap" rel="stylesheet">
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            html, body { background: #0a0a0a; color: #a3a3a3; font-family: 'Noto Sans JP', sans-serif; height: 100%; overflow: hidden; }
            #pip-header { padding: 8px 12px; border-bottom: 1px solid #262626; font-size: 11px; color: #737373; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            #pip-header .title { color: #e5e5e5; font-weight: 500; }
            #pip-lyrics { height: calc(100% - 36px); overflow-y: auto; padding: 12px; scroll-behavior: smooth; }
            .line { line-height: 2.2; padding: 2px 4px; border-radius: 4px; transition: color 0.3s, transform 0.3s, opacity 0.3s; transform-origin: left; opacity: 0.6; font-size: ${fontSize}px; }
            @keyframes lyricActivate { 0% { transform: scale(1); filter: brightness(1); } 40% { transform: scale(1.06); filter: brightness(1.25); } 100% { transform: scale(1.03); filter: brightness(1); } }
            .line.active { color: #ffffff; transform: scale(1.03); opacity: 1; font-weight: 700; animation: lyricActivate 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) forwards; }
            .line.empty { height: 1.5em; }
            ruby rt { font-size: 0.5em; color: #a3a3a3; }
            .line.active ruby rt { color: #d4d4d4; }
          </style>
        </head>
        <body>
          <div id="pip-header"><span class="title">${title}</span>${artist ? ` — ${artist}` : ''}</div>
          <div id="pip-lyrics">
            ${furiganaLinesArg.map((line, i) => {
              if (line.segments.length === 0) return `<div class="line empty" data-line="${i}"></div>`;
              const html = line.segments.map(seg => {
                if (!seg.reading) return seg.text;
                return `<ruby>${seg.text}<rp>(</rp><rt>${seg.reading}</rt><rp>)</rp></ruby>`;
              }).join('');
              return `<div class="line" data-line="${i}">${html}</div>`;
            }).join('')}
          </div>
        </body>
      `;

      // Sync current active line immediately
      if (highlightLine >= 0) {
        const pipLines = pipWindow.document.querySelectorAll('.line');
        pipLines.forEach((el: Element, i: number) => {
          if (i === highlightLine) {
            (el as HTMLElement).classList.add('active');
            el.scrollIntoView({ block: 'center' });
          }
        });
      }

      pipWindow.addEventListener('pagehide', () => {
        pipWindowRef.current = null;
      });
    } catch (e) {
      console.error('PiP failed:', e);
      showToast('error', t('song.pipFailed'));
    }
  }, [fontSize, t, showToast]);

  // Re-center when debug mode toggled off
  useEffect(() => {
    // This effect needs activeLine from the sync hook — the page will handle it
  }, [debug]);

  return {
    song,
    loading,
    syncLines,
    furiganaLines,
    furiganaLoading,
    lineTimestamps,
    syncing,
    syncError,
    importing,
    copied,
    showRaw,
    setShowRaw,
    debug,
    setDebug,
    showPasteLrc,
    setShowPasteLrc,
    pasteLrcText,
    setPasteLrcText,
    showExport,
    setShowExport,
    deleteConfirm,
    setDeleteConfirm,
    importAlert,
    setImportAlert,
    fontSize,
    setFontSize,
    toast,
    allSongs,
    lyricsRef,
    lineRefs,
    handleSync,
    handlePasteLrc,
    handleDelete,
    confirmDelete,
    handleCopy,
    handleImportPlaying,
    openPiP,
    showToast,
  };
}
