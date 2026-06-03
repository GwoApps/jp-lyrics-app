'use client';

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import type { FuriganaLine } from '@/lib/types';
import { RefreshCw, Bug, FileText, BookOpen, Pencil, Trash2, ArrowLeft, Minus, Plus, Music, Download, Loader2, ExternalLink, ClipboardPaste, PictureInPicture } from 'lucide-react';

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

interface SpotifyState {
  connected: boolean;
  is_playing: boolean;
  progress_ms: number;
  duration_ms: number;
  track: { name: string; artist: string; album: string } | null;
}

interface SyncLine {
  timeMs: number;
  text: string;
}

function normalize(s: string): string {
  return s.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
}

function fuzzyMatch(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;
  // Bigram (Sørensen-Dice) similarity
  const bg = (s: string) => { const set = new Set<string>(); for (let i = 0; i < s.length - 1; i++) set.add(s.substring(i, i + 2)); return set; };
  const aSet = bg(na), bSet = bg(nb);
  let common = 0; for (const g of aSet) { if (bSet.has(g)) common++; }
  return (2 * common) / (aSet.size + bSet.size) >= 0.4;
}

function parseLrc(lrc: string): SyncLine[] {
  const lines: SyncLine[] = [];
  for (const raw of lrc.split('\n')) {
    const m = raw.match(/^\[(\d{2}):(\d{2})\.(\d{2,3})\]\s*(.*)$/);
    if (m) {
      const ms = parseInt(m[1]) * 60000 + parseInt(m[2]) * 1000 + parseInt(m[3].padEnd(3, '0'));
      const text = m[4].trim();
      if (text) lines.push({ timeMs: ms, text });
    }
  }
  return lines.sort((a, b) => a.timeMs - b.timeMs);
}

function findActiveLine(syncLines: SyncLine[], progressMs: number): number {
  for (let i = syncLines.length - 1; i >= 0; i--) {
    if (progressMs >= syncLines[i].timeMs) return i;
  }
  return 0;
}

function fmtMs(ms: number): string {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const ss = ms % 1000;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ss).padStart(3, '0')}`;
}

function fmtTime(ms: number): string {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function FuriganaLineView({ line, isActive, debugTs }: {
  line: FuriganaLine;
  isActive: boolean;
  debugTs?: number | null;
}) {
  if (line.segments.length === 0) return <div className="h-5 sm:h-6" />;
  return (
    <div className="flex items-baseline gap-2 sm:gap-3">
      {debugTs != null && (
        <span className="shrink-0 w-[60px] sm:w-[72px] text-right font-mono text-[10px] text-[var(--primary)] opacity-70 tabular-nums">
          {fmtMs(debugTs)}
        </span>
      )}
      <div className={`leading-[2.2] sm:leading-[2.8] transition-all duration-300 ${isActive ? 'text-white scale-[1.02] origin-left' : 'text-[var(--muted-foreground)] opacity-60'}`}>
        {line.segments.map((seg, i) => {
          if (!seg.reading) return <span key={i}>{seg.text}</span>;
          return (
            <ruby key={i}>{seg.text}<rp>(</rp><rt>{seg.reading}</rt><rp>)</rp></ruby>
          );
        })}
      </div>
    </div>
  );
}

/** Reusable button class builder */
function btnCls(active?: boolean, variant?: 'danger') {
  const base = 'inline-flex items-center justify-center rounded-xl transition-colors disabled:opacity-50';
  const size = 'h-11 w-11 sm:h-8 sm:w-8 sm:rounded-md'; // 44px touch target on mobile
  const colors = variant === 'danger'
    ? 'text-[var(--destructive)] bg-red-950/30 hover:bg-red-950/50'
    : active
      ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
      : 'text-[var(--muted-foreground)] bg-[var(--accent)] hover:text-[var(--foreground)]';
  return `${base} ${size} ${colors}`;
}

export default function SongViewPage() {
  const router = useRouter();
  const params = useParams();
  const id = params?.id as string;
  const [song, setSong] = useState<SongData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showRaw, setShowRaw] = useState(false);
  const [debug, setDebug] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [spotify, setSpotify] = useState<SpotifyState | null>(null);
  const [activeLine, setActiveLine] = useState(-1);
  const [syncLines, setSyncLines] = useState<SyncLine[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [allSongs, setAllSongs] = useState<{ id: string; title: string }[]>([]);
  const [showPasteLrc, setShowPasteLrc] = useState(false);
  const [pasteLrcText, setPasteLrcText] = useState('');
  const [syncError, setSyncError] = useState('');
  const [fontSize, setFontSize] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('jplrc-font-size');
      if (saved) { const n = parseInt(saved); if (n >= 14 && n <= 32) return n; }
    }
    return 20;
  });
  const lyricsRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);
  // Interpolation state for smooth progress between Spotify polls
  const interpRef = useRef({ progressMs: 0, pollTime: 0, isPlaying: false, trackName: '', durationMs: 0 });
  const rafRef = useRef<number>(0);
  const highlightRef = useRef(-1);
  const lineTimestampsRef = useRef<(number | null)[]>([]);
  const furiganaLinesRef = useRef<FuriganaLine[]>([]);
  const songRef = useRef<SongData | null>(null);
  const debugRef = useRef(false);
  const pipWindowRef = useRef<Window | null>(null);
  const [pipSupported, setPipSupported] = useState(false);

  useEffect(() => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const api = (window as any).documentPictureInPicture;
      setPipSupported(typeof api?.requestWindow === 'function');
    } catch { setPipSupported(false); }
  }, []);
  useEffect(() => { localStorage.setItem('jplrc-font-size', String(fontSize)); }, [fontSize]);

  const furiganaLines = useMemo<FuriganaLine[]>(() => {
    if (!song?.lyrics_furigana) return [];
    try { return JSON.parse(song.lyrics_furigana); } catch { return []; }
  }, [song?.lyrics_furigana]);

  const lineTimestamps = useMemo(() => {
    if (!syncLines.length || !furiganaLines.length) return [] as (number | null)[];
    const ts: (number | null)[] = [];
    let si = 0;
    for (let fi = 0; fi < furiganaLines.length; fi++) {
      const fl = furiganaLines[fi];
      if (fl.segments.length === 0) { ts.push(null); continue; }
      const flText = fl.segments.map(s => s.text).join('').replace(/\s+/g, '');
      let bestJ = -1;
      for (let j = si; j < Math.min(syncLines.length, si + 10); j++) {
        if (fuzzyMatch(flText, syncLines[j].text.replace(/\s+/g, ''))) {
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

  // Keep refs in sync with state for rAF loop (avoids stale closures)
  useEffect(() => { lineTimestampsRef.current = lineTimestamps; }, [lineTimestamps]);
  useEffect(() => { furiganaLinesRef.current = furiganaLines; }, [furiganaLines]);
  useEffect(() => { songRef.current = song; }, [song]);
  useEffect(() => { debugRef.current = debug; }, [debug]);

  // Close PiP window on unmount
  useEffect(() => {
    return () => {
      try { pipWindowRef.current?.close(); } catch { /* */ }
    };
  }, []);

  const showToast = (type: 'success' | 'error', msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3000);
  };

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

    // Fetch all songs for matching
    fetch('/api/songs')
      .then((r) => r.json())
      .then((data) => setAllSongs(data.map((s: { id: string; title: string }) => ({ id: s.id, title: s.title }))))
      .catch(() => {});
  }, [id]);

  const pollSpotify = useCallback(async () => {
    try {
      const res = await fetch('/api/spotify/now-playing');
      const data = await res.json();
      setSpotify(data);
      // Record interpolation anchor for smooth progress between polls
      if (data.is_playing && data.track) {
        interpRef.current = {
          progressMs: data.progress_ms,
          pollTime: performance.now(),
          isPlaying: true,
          trackName: data.track.name,
          durationMs: data.duration_ms || 0,
        };
      } else {
        interpRef.current.isPlaying = false;
      }
    } catch { /* */ }
  }, []);

  useEffect(() => {
    pollSpotify();
    const interval = setInterval(pollSpotify, 1000);
    return () => clearInterval(interval);
  }, [pollSpotify]);

  // Smooth interpolation loop — runs at display refresh rate between Spotify polls
  // Directly updates activeLine and scrolls via refs, no React re-render per frame
  useEffect(() => {
    const tick = () => {
      const { progressMs, pollTime, isPlaying, trackName, durationMs } = interpRef.current;
      const currentSong = songRef.current;

      // Not playing or song mismatch → clear highlight
      if (!isPlaying || !currentSong || !fuzzyMatch(trackName, currentSong.title)) {
        if (highlightRef.current !== -1) {
          highlightRef.current = -1;
          setActiveLine(-1);
        }
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      // Interpolate progress since last Spotify poll
      const elapsed = performance.now() - pollTime;
      const currentMs = progressMs + Math.max(0, elapsed);

      // Find active line
      const lts = lineTimestampsRef.current;
      const fls = furiganaLinesRef.current;
      let newActive = -1;

      if (lts.length > 0) {
        // Timestamp-based: binary-ish scan from end
        for (let i = lts.length - 1; i >= 0; i--) {
          if (lts[i] != null && currentMs >= lts[i]!) {
            newActive = i;
            break;
          }
        }
      } else {
        // Fallback: proportional scroll
        const nonEmpty = fls.filter(l => l.segments.length > 0);
        if (nonEmpty.length && durationMs) {
          const progress = Math.min(currentMs / durationMs, 1);
          newActive = Math.min(Math.floor(progress * nonEmpty.length), nonEmpty.length - 1);
        }
      }

      // Update highlight + scroll only when line actually changes
      if (newActive !== highlightRef.current) {
        highlightRef.current = newActive;
        setActiveLine(newActive);
        if (!debugRef.current && lineRefs.current[newActive]) {
          lineRefs.current[newActive]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        // Update PiP window if open
        try {
          const pipWin = pipWindowRef.current;
          if (pipWin && !pipWin.closed) {
            const pipLines = pipWin.document.querySelectorAll('.line');
            pipLines.forEach((el: Element, i: number) => {
              if (i === newActive) {
                (el as HTMLElement).classList.add('active');
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
              } else {
                (el as HTMLElement).classList.remove('active');
              }
            });
          }
        } catch { /* PiP window closed */ }
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []); // Run once — reads from refs that stay in sync via separate effects

  // Re-center when debug mode is toggled off
  useEffect(() => {
    if (!debug && activeLine >= 0 && lineRefs.current[activeLine]) {
      lineRefs.current[activeLine]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [debug]);

  const handleSync = async () => {
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
        showToast('success', `歌詞同期完了 (${data.source}, ${data.lines}行)`);
      } else {
        setSyncError(data.error || '歌詞が見つかりません');
        showToast('error', '歌詞が見つかりません — 手動貼付をご利用ください');
      }
    } catch {
      setSyncError('通信エラー');
      showToast('error', '取得に失敗しました');
    } finally {
      setSyncing(false);
    }
  };

  const handlePasteLrc = async () => {
    if (!pasteLrcText.trim()) return;
    // Save raw lyrics + synced lyrics
    try {
      const res = await fetch(`/api/songs/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lyrics_synced: pasteLrcText.trim(),
        }),
      });
      if (res.ok) {
        // Re-fetch song data
        const songRes = await fetch(`/api/songs/${id}`);
        if (songRes.ok) {
          const updated = await songRes.json();
          setSong(updated);
          setSyncLines(parseLrc(pasteLrcText.trim()));
        }
        setShowPasteLrc(false);
        setPasteLrcText('');
        setSyncError('');
        showToast('success', '歌詞を保存しました');
      }
    } catch {
      showToast('error', '保存に失敗しました');
    }
  };

  const handleDelete = async () => {
    if (!song || !confirm(`「${song.title}」を削除しますか？`)) return;
    const res = await fetch(`/api/songs/${id}`, { method: 'DELETE' });
    if (res.ok) { showToast('success', '削除しました'); setTimeout(() => router.push('/'), 800); }
  };

  const handleImportPlaying = async () => {
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
        showToast('error', data.error || '歌詞の取得に失敗しました');
        return;
      }
      router.push(`/songs/${data.id}`);
    } catch {
      showToast('error', '取込に失敗しました');
    } finally {
      setImporting(false);
    }
  };

  const openPiP = useCallback(async () => {
    // Toggle: close if already open
    if (pipWindowRef.current && !pipWindowRef.current.closed) {
      pipWindowRef.current.close();
      pipWindowRef.current = null;
      return;
    }

    if (!('documentPictureInPicture' in window)) {
      showToast('error', 'PiP非対応 — デスクトップChrome 116+が必要です');
      return;
    }

    if (furiganaLines.length === 0) {
      showToast('error', '歌詞がありません');
      return;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pipWindow = await (window as any).documentPictureInPicture.requestWindow({
        width: 380,
        height: 520,
      });

      pipWindowRef.current = pipWindow;

      const title = song?.title || '';
      const artist = song?.artist || '';

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
            .line.active { color: #ffffff; transform: scale(1.02); opacity: 1; }
            .line.empty { height: 1.5em; }
            ruby rt { font-size: 0.5em; color: #a3a3a3; }
            .line.active ruby rt { color: #d4d4d4; }
          </style>
        </head>
        <body>
          <div id="pip-header"><span class="title">${title}</span>${artist ? ` — ${artist}` : ''}</div>
          <div id="pip-lyrics">
            ${furiganaLines.map((line, i) => {
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
      if (highlightRef.current >= 0) {
        const pipLines = pipWindow.document.querySelectorAll('.line');
        pipLines.forEach((el: Element, i: number) => {
          if (i === highlightRef.current) {
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
      showToast('error', 'PiPの開始に失敗しました');
    }
  }, [furiganaLines, song, fontSize, showToast]);

  if (loading) {
    return <div className="flex items-center justify-center py-32"><div className="h-5 w-5 border-2 border-[var(--muted-foreground)]/30 border-t-[var(--muted-foreground)] rounded-full animate-spin" /></div>;
  }

  if (!song) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-center">
        <p className="text-sm text-[var(--muted-foreground)]">曲が見つかりません</p>
        <button onClick={() => router.push('/')} className="mt-4 text-xs text-[var(--primary)] hover:underline inline-flex items-center gap-1">
          <ArrowLeft className="h-3 w-3" /> 一覧に戻る
        </button>
      </div>
    );
  }

  const isSynced = spotify?.is_playing && spotify.track && activeLine >= 0;
  const hasSyncData = syncLines.length > 0;
  const debugSyncActive = spotify?.is_playing && syncLines.length > 0 ? findActiveLine(syncLines, spotify.progress_ms) : -1;

  // Check if currently playing song exists in DB
  const playingMatch = spotify?.track
    ? allSongs.find((s) => fuzzyMatch(s.title, spotify.track!.name) && s.id !== id)
    : null;

  return (
    <div className="fade-in flex flex-col h-[calc(100dvh-2.75rem)] pb-24 overflow-hidden sm:block sm:h-auto sm:pb-0">
      {/* Breadcrumb */}
      <div className="shrink-0 mb-3 sm:mb-8 flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
        <a href="/" className="hover:text-[var(--foreground)] transition-colors inline-flex items-center gap-1">
          <ArrowLeft className="h-3 w-3" /> 一覧
        </a>
        <span className="opacity-40">/</span>
        <span className="text-[var(--foreground)] truncate max-w-[200px] sm:max-w-[320px]">{song.title}</span>
      </div>

      {/* Header — compact on mobile */}
      <div className="shrink-0 mb-3 sm:mb-8">
        <div className="flex flex-col sm:flex-row items-start justify-between gap-3 sm:gap-4">
          <div className="space-y-0.5 sm:space-y-1 min-w-0">
            <h1 className="text-base sm:text-xl font-semibold tracking-tight">{song.title}</h1>
            {song.artist && <p className="text-xs sm:text-sm text-[var(--muted-foreground)]">{song.artist}</p>}
          </div>
          {/* Desktop-only buttons */}
          <div className="hidden sm:flex items-center gap-2 shrink-0">
            <div className="flex items-center gap-0.5 rounded-md bg-[var(--accent)] px-1 py-0.5">
              <button onClick={() => setFontSize(s => Math.max(14, s - 2))} className="p-1 text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"><Minus className="h-3 w-3" /></button>
              <span className="text-[10px] w-5 text-center text-[var(--muted-foreground)] tabular-nums">{fontSize}</span>
              <button onClick={() => setFontSize(s => Math.min(32, s + 2))} className="p-1 text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"><Plus className="h-3 w-3" /></button>
            </div>
            <button onClick={handleSync} disabled={syncing} className={btnCls()}>
              <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
            </button>
            {furiganaLines.length > 0 && pipSupported && (
              <button onClick={openPiP} className={btnCls()} title="Picture-in-Picture">
                <PictureInPicture className="h-3.5 w-3.5" />
              </button>
            )}
            {!hasSyncData && (
              <button onClick={() => setShowPasteLrc(!showPasteLrc)} className={btnCls(showPasteLrc)}>
                <ClipboardPaste className="h-3.5 w-3.5" />
              </button>
            )}
            <button onClick={() => setDebug(!debug)} className={btnCls(debug)}>
              <Bug className="h-3.5 w-3.5" />
            </button>
            <button onClick={() => setShowRaw(!showRaw)} className={btnCls()}>
              {showRaw ? <BookOpen className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
            </button>
            <button onClick={() => router.push(`/songs/${id}/edit`)} className={btnCls()}>
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button onClick={handleDelete} className={btnCls(false, 'danger')}>
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Spotify sync indicator */}
        {spotify?.connected && (
          <div className="mt-2 sm:mt-4 flex items-center gap-2">
            {isSynced ? (
              <div className="flex items-center gap-1.5 sm:gap-2 rounded-full bg-green-950/40 border border-green-800/30 px-2 sm:px-3 py-1">
                <span className="inline-block h-2 w-2 rounded-full bg-green-400 animate-pulse" />
                <Music className="h-3 w-3 text-green-400" />
                <span className="text-xs text-green-400 truncate max-w-[180px] sm:max-w-none">
                  {spotify.track!.name}
                  {debug && spotify && (
                    <span className="ml-1 sm:ml-2 font-mono text-green-500/70 text-[10px]">
                      [{fmtTime(spotify.progress_ms)}/{fmtTime(spotify.duration_ms)}]#{activeLine}
                    </span>
                  )}
                </span>
              </div>
            ) : spotify.is_playing && spotify.track ? (
              <div className="flex items-center gap-1.5 sm:gap-2 rounded-full bg-[var(--accent)] px-2 sm:px-3 py-1">
                <span className="inline-block h-2 w-2 rounded-full bg-[var(--muted-foreground)]" />
                <span className="text-xs text-[var(--muted-foreground)] truncate max-w-[140px] sm:max-w-none">
                  {spotify.track.name}
                  {debug && <span className="ml-1 font-mono text-[10px]">[{fmtTime(spotify.progress_ms)}/{fmtTime(spotify.duration_ms)}]</span>}
                </span>
                {playingMatch ? (
                  <button
                    onClick={() => router.push(`/songs/${playingMatch.id}`)}
                    className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium bg-[var(--accent)] text-[var(--foreground)] hover:bg-[var(--border)] transition-colors shrink-0"
                  >
                    <ExternalLink className="h-3 w-3" />
                    <span>表示</span>
                  </button>
                ) : (
                  <button
                    onClick={handleImportPlaying}
                    disabled={importing}
                    className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium bg-[var(--primary)] text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:opacity-50 shrink-0"
                  >
                    {importing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                    <span>{importing ? '...' : '取込'}</span>
                  </button>
                )}
              </div>
            ) : null}
          </div>
        )}

        {/* Debug panel */}
        {debug && (
          <div className="mt-3 rounded-md bg-[var(--muted)] border border-[var(--border)] p-2 sm:p-3 text-[10px] sm:text-[11px] font-mono space-y-1 overflow-x-auto">
            <div className="text-[var(--primary)] font-medium mb-1.5">Debug Info</div>
            <div>Spotify: {spotify?.connected ? '✓ connected' : '✗ disconnected'} | playing: {String(!!spotify?.is_playing)} | match: {String(isSynced)}</div>
            <div>progress: {spotify ? `${spotify.progress_ms}ms (${fmtTime(spotify.progress_ms)})` : '—'} / {spotify ? `${spotify.duration_ms}ms (${fmtTime(spotify.duration_ms)})` : '—'}</div>
            <div>sync: {syncLines.length} | furigana: {furiganaLines.length} | active: #{activeLine} ({activeLine >= 0 && lineTimestamps[activeLine] != null ? fmtMs(lineTimestamps[activeLine]!) : '—'}) | sync: #{debugSyncActive}</div>
            <div>track: {spotify?.track?.name || '—'} | song: {song.title}</div>
            {syncLines.length > 0 && (
              <div className="pt-1.5 mt-1.5 border-t border-[var(--border)]">
                <div className="text-[var(--muted-foreground)] mb-1">Synced timestamps ({syncLines.length} lines):</div>
                <div className="max-h-40 overflow-y-auto space-y-0.5">
                  {syncLines.map((sl, i) => (
                    <div key={i} className={i === debugSyncActive ? 'text-green-400 font-medium' : 'text-[var(--muted-foreground)]'}>
                      [{fmtMs(sl.timeMs)}] {sl.text}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Paste LRC UI */}
        {(showPasteLrc || syncError) && !hasSyncData && (
          <div className="mt-3 rounded-md bg-[var(--muted)] border border-[var(--border)] p-3 sm:p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-[var(--foreground)]">LRC 歌詞を手動貼付</span>
              {syncError && <span className="text-[10px] text-[var(--destructive)]">{syncError}</span>}
            </div>
            <textarea
              value={pasteLrcText}
              onChange={(e) => setPasteLrcText(e.target.value)}
              placeholder={`[00:05.58] 歌詞の一行目\n[00:10.23] 歌詞の二行目\n[00:15.00] ...`}
              rows={6}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-xs font-mono outline-none focus:border-[var(--primary)] transition-colors placeholder:text-[var(--muted-foreground)]/40 resize-y"
            />
            <div className="flex items-center gap-2 mt-2">
              <button
                onClick={handlePasteLrc}
                disabled={!pasteLrcText.trim()}
                className="rounded-md px-3 py-1.5 text-xs font-medium bg-[var(--primary)] text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                保存
              </button>
              <button
                onClick={() => { setShowPasteLrc(false); setPasteLrcText(''); setSyncError(''); }}
                className="rounded-md px-3 py-1.5 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
              >
                キャンセル
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Lyrics */}
      <div className="rounded-lg bg-[var(--card)] border border-[var(--border)] overflow-hidden flex-1 min-h-0">
        {showRaw ? (
          <pre className="p-4 sm:p-6 whitespace-pre-wrap font-sans leading-relaxed h-full sm:h-auto sm:max-h-[70vh] overflow-y-auto" style={{ fontSize: `${fontSize}px` }}>{song.lyrics_raw || '（歌詞なし）'}</pre>
        ) : (
          <div ref={lyricsRef} className="p-4 sm:p-6 h-full sm:h-auto sm:max-h-[70vh] overflow-y-auto scroll-smooth" style={{ fontSize: `${fontSize}px` }}>
            {furiganaLines.length > 0 ? (
              furiganaLines.map((line, i) => (
                <div key={i} ref={(el) => { lineRefs.current[i] = el; }}>
                  <FuriganaLineView
                    line={line}
                    isActive={i === activeLine && !!isSynced}
                    debugTs={debug && lineTimestamps[i] != null ? lineTimestamps[i] : undefined}
                  />
                </div>
              ))
            ) : (
              <p className="text-sm text-[var(--muted-foreground)]">歌詞がありません</p>
            )}
          </div>
        )}
      </div>

      {/* Meta */}
      <div className="shrink-0 mt-2 sm:mt-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-1 sm:gap-2">
        <div className="flex flex-wrap items-center gap-x-3 sm:gap-x-6 gap-y-1 text-[10px] sm:text-[11px] text-[var(--muted-foreground)]">
          <span>作成: {new Date(song.created_at).toLocaleString('ja-JP')}</span>
          <span>更新: {new Date(song.updated_at).toLocaleString('ja-JP')}</span>
          {hasSyncData && <span className="text-green-500/60">{syncLines.length} 行同期済み</span>}
        </div>
        {!spotify?.connected && (
          <a href="/api/auth/login" className="text-[11px] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors">Spotify連携</a>
        )}
      </div>

      {/* Mobile bottom toolbar */}
      <div className="fixed bottom-0 left-0 right-0 sm:hidden z-50 bg-[var(--background)]/95 backdrop-blur-sm border-t border-[var(--border)]">
        <div className="mx-auto max-w-[860px] flex items-center justify-around px-2 py-2 safe-area-pb">
          {/* Font size */}
          <button onClick={() => setFontSize(s => Math.max(14, s - 2))} className="flex flex-col items-center gap-0.5 p-1 text-[var(--muted-foreground)]">
            <span className="text-lg font-medium leading-none">A-</span>
          </button>
          <button onClick={() => setFontSize(s => Math.min(32, s + 2))} className="flex flex-col items-center gap-0.5 p-1 text-[var(--muted-foreground)]">
            <span className="text-lg font-medium leading-none">A+</span>
          </button>
          {/* Divider */}
          <div className="w-px h-6 bg-[var(--border)]" />
          {/* Sync */}
          <button onClick={handleSync} disabled={syncing} className="flex flex-col items-center gap-0.5 p-2 text-[var(--muted-foreground)] disabled:opacity-50">
            <RefreshCw className={`h-5 w-5 ${syncing ? 'animate-spin' : ''}`} />
            <span className="text-[10px]">{syncing ? '...' : '同期'}</span>
          </button>
          {/* PiP */}
          {furiganaLines.length > 0 && pipSupported && (
            <button onClick={openPiP} className="flex flex-col items-center gap-0.5 p-2 text-[var(--muted-foreground)]">
              <PictureInPicture className="h-5 w-5" />
              <span className="text-[10px]">PiP</span>
            </button>
          )}
          {/* Paste LRC */}
          {!hasSyncData && (
            <button onClick={() => setShowPasteLrc(!showPasteLrc)} className={`flex flex-col items-center gap-0.5 p-2 ${showPasteLrc ? 'text-[var(--primary)]' : 'text-[var(--muted-foreground)]'}`}>
              <ClipboardPaste className="h-5 w-5" />
              <span className="text-[10px]">貼付</span>
            </button>
          )}
          {/* Raw/Furigana */}
          <button onClick={() => setShowRaw(!showRaw)} className="flex flex-col items-center gap-0.5 p-2 text-[var(--muted-foreground)]">
            {showRaw ? <BookOpen className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
            <span className="text-[10px]">{showRaw ? 'ふりがな' : '原文'}</span>
          </button>
          {/* Debug */}
          <button onClick={() => setDebug(!debug)} className={`flex flex-col items-center gap-0.5 p-2 ${debug ? 'text-[var(--primary)]' : 'text-[var(--muted-foreground)]'}`}>
            <Bug className="h-5 w-5" />
            <span className="text-[10px]">Debug</span>
          </button>
          {/* Edit */}
          <button onClick={() => router.push(`/songs/${id}/edit`)} className="flex flex-col items-center gap-0.5 p-2 text-[var(--muted-foreground)]">
            <Pencil className="h-5 w-5" />
            <span className="text-[10px]">編集</span>
          </button>
          {/* Delete */}
          <button onClick={handleDelete} className="flex flex-col items-center gap-0.5 p-2 text-[var(--destructive)]">
            <Trash2 className="h-5 w-5" />
          </button>
        </div>
      </div>

      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}
    </div>
  );
}
