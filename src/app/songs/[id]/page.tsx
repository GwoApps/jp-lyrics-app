'use client';

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import type { FuriganaLine } from '@/lib/types';
import { RefreshCw, Bug, FileText, BookOpen, Pencil, Trash2, ArrowLeft, Minus, Plus, Music, Download, Loader2 } from 'lucide-react';

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
  if (na.includes(nb) || nb.includes(na)) return true;
  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length > nb.length ? na : nb;
  let hits = 0;
  for (const ch of shorter) { if (longer.includes(ch)) hits++; }
  return hits / shorter.length >= 0.6;
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
      <div className={`leading-[2.4] sm:leading-[2.8] transition-all duration-300 ${isActive ? 'text-white scale-[1.02] origin-left' : 'text-[var(--muted-foreground)] opacity-60'}`}>
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
  const [fontSize, setFontSize] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('jplrc-font-size');
      if (saved) { const n = parseInt(saved); if (n >= 12 && n <= 28) return n; }
    }
    return 18;
  });
  const lyricsRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);

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
  }, [id]);

  const pollSpotify = useCallback(async () => {
    try {
      const res = await fetch('/api/spotify/now-playing');
      const data = await res.json();
      setSpotify(data);
    } catch { /* */ }
  }, []);

  useEffect(() => {
    pollSpotify();
    const interval = setInterval(pollSpotify, 1000);
    return () => clearInterval(interval);
  }, [pollSpotify]);

  useEffect(() => {
    if (!spotify?.is_playing || !spotify.track || !song) {
      setActiveLine(-1);
      return;
    }
    if (!fuzzyMatch(spotify.track.name, song.title)) {
      setActiveLine(-1);
      return;
    }
    if (lineTimestamps.length > 0) {
      let best = -1;
      for (let i = lineTimestamps.length - 1; i >= 0; i--) {
        const ts = lineTimestamps[i];
        if (ts != null && spotify.progress_ms >= ts) {
          best = i;
          break;
        }
      }
      setActiveLine(best);
    } else {
      const nonEmpty = furiganaLines.filter(l => l.segments.length > 0);
      if (!nonEmpty.length || !spotify.duration_ms) return;
      const progress = spotify.progress_ms / spotify.duration_ms;
      setActiveLine(Math.min(Math.floor(progress * nonEmpty.length), nonEmpty.length - 1));
    }
  }, [spotify, song, lineTimestamps, furiganaLines]);

  useEffect(() => {
    if (debug || activeLine < 0 || !lineRefs.current[activeLine]) return;
    lineRefs.current[activeLine]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [activeLine, debug]);

  const handleSync = async () => {
    setSyncing(true);
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
        showToast('error', data.error || '同期歌詞が見つかりません');
      }
    } catch {
      showToast('error', '取得に失敗しました');
    } finally {
      setSyncing(false);
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
      router.push(`/songs/${data.id}`);
    } catch {
      showToast('error', '取込に失敗しました');
    } finally {
      setImporting(false);
    }
  };

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

  return (
    <div className="fade-in">
      {/* Breadcrumb */}
      <div className="mb-6 sm:mb-8 flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
        <a href="/" className="hover:text-[var(--foreground)] transition-colors inline-flex items-center gap-1">
          <ArrowLeft className="h-3 w-3" /> 一覧
        </a>
        <span className="opacity-40">/</span>
        <span className="text-[var(--foreground)] truncate max-w-[180px] sm:max-w-[320px]">{song.title}</span>
      </div>

      {/* Header */}
      <div className="mb-6 sm:mb-8">
        <div className="flex flex-col sm:flex-row items-start justify-between gap-4">
          <div className="space-y-1 min-w-0">
            <h1 className="text-lg sm:text-xl font-semibold tracking-tight">{song.title}</h1>
            {song.artist && <p className="text-sm text-[var(--muted-foreground)]">{song.artist}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 shrink-0">
            {/* Font size control */}
            <div className="flex items-center gap-0.5 rounded-md bg-[var(--accent)] px-1 py-0.5">
              <button onClick={() => setFontSize(s => Math.max(12, s - 2))} className="p-1 text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors" title="文字缩小">
                <Minus className="h-3 w-3" />
              </button>
              <span className="text-[10px] w-5 text-center text-[var(--muted-foreground)] tabular-nums">{fontSize}</span>
              <button onClick={() => setFontSize(s => Math.min(28, s + 2))} className="p-1 text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors" title="文字拡大">
                <Plus className="h-3 w-3" />
              </button>
            </div>
            <button onClick={handleSync} disabled={syncing} className="inline-flex items-center gap-1.5 rounded-md px-2.5 sm:px-3 py-1.5 text-xs text-[var(--muted-foreground)] bg-[var(--accent)] hover:text-[var(--foreground)] transition-colors disabled:opacity-50">
              <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">{syncing ? '取得中...' : hasSyncData ? '再同期' : '同期歌詞'}</span>
            </button>
            <button onClick={() => setDebug(!debug)} className={`inline-flex items-center gap-1.5 rounded-md px-2.5 sm:px-3 py-1.5 text-xs transition-colors ${debug ? 'bg-[var(--primary)] text-[var(--primary-foreground)]' : 'bg-[var(--accent)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]'}`}>
              <Bug className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Debug</span>
            </button>
            <button onClick={() => setShowRaw(!showRaw)} className="inline-flex items-center gap-1.5 rounded-md px-2.5 sm:px-3 py-1.5 text-xs text-[var(--muted-foreground)] bg-[var(--accent)] hover:text-[var(--foreground)] transition-colors">
              {showRaw ? <BookOpen className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">{showRaw ? 'ふりがな' : '原文'}</span>
            </button>
            <button onClick={() => router.push(`/songs/${id}/edit`)} className="inline-flex items-center gap-1.5 rounded-md px-2.5 sm:px-3 py-1.5 text-xs text-[var(--muted-foreground)] bg-[var(--accent)] hover:text-[var(--foreground)] transition-colors">
              <Pencil className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">編集</span>
            </button>
            <button onClick={handleDelete} className="inline-flex items-center rounded-md px-2 py-1.5 text-xs text-[var(--destructive)] bg-red-950/30 hover:bg-red-950/50 transition-colors">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Spotify sync indicator */}
        {spotify?.connected && (
          <div className="mt-3 sm:mt-4 flex items-center gap-2">
            {isSynced ? (
              <div className="flex items-center gap-2 rounded-full bg-green-950/40 border border-green-800/30 px-2.5 sm:px-3 py-1">
                <span className="inline-block h-2 w-2 rounded-full bg-green-400 animate-pulse" />
                <Music className="h-3 w-3 text-green-400" />
                <span className="text-xs text-green-400 truncate max-w-[200px] sm:max-w-none">
                  {spotify.track!.name}
                  {debug && spotify && (
                    <span className="ml-2 font-mono text-green-500/70 text-[10px]">
                      [{fmtTime(spotify.progress_ms)} / {fmtTime(spotify.duration_ms)}] line#{activeLine}
                    </span>
                  )}
                </span>
              </div>
            ) : spotify.is_playing && spotify.track ? (
              <div className="flex items-center gap-2 rounded-full bg-[var(--accent)] px-2.5 sm:px-3 py-1">
                <span className="inline-block h-2 w-2 rounded-full bg-[var(--muted-foreground)]" />
                <span className="text-xs text-[var(--muted-foreground)] truncate max-w-[150px] sm:max-w-none">
                  {spotify.track.name}
                  {debug && <span className="ml-2 font-mono text-[10px]">[{fmtTime(spotify.progress_ms)} / {fmtTime(spotify.duration_ms)}]</span>}
                </span>
                <button
                  onClick={handleImportPlaying}
                  disabled={importing}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium bg-[var(--primary)] text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:opacity-50 shrink-0"
                >
                  {importing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                  <span>{importing ? '...' : '取込'}</span>
                </button>
              </div>
            ) : null}
          </div>
        )}

        {/* Debug panel */}
        {debug && (
          <div className="mt-3 rounded-md bg-[var(--muted)] border border-[var(--border)] p-2.5 sm:p-3 text-[10px] sm:text-[11px] font-mono space-y-1 overflow-x-auto">
            <div className="text-[var(--primary)] font-medium mb-1.5">Debug Info</div>
            <div>Spotify: {spotify?.connected ? '✓ connected' : '✗ disconnected'} | playing: {String(!!spotify?.is_playing)} | match: {String(isSynced)}</div>
            <div>progress: {spotify ? `${spotify.progress_ms}ms (${fmtTime(spotify.progress_ms)})` : '—'} / {spotify ? `${spotify.duration_ms}ms (${fmtTime(spotify.duration_ms)})` : '—'}</div>
            <div>sync lines: {syncLines.length} | furigana: {furiganaLines.length} | active: #{activeLine} ({activeLine >= 0 && lineTimestamps[activeLine] != null ? fmtMs(lineTimestamps[activeLine]!) : '—'}) | sync: #{debugSyncActive}</div>
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
      </div>

      {/* Lyrics */}
      <div className="rounded-lg bg-[var(--card)] border border-[var(--border)] overflow-hidden">
        {showRaw ? (
          <pre className="p-4 sm:p-6 whitespace-pre-wrap font-sans leading-relaxed max-h-[70vh] overflow-y-auto" style={{ fontSize: `${fontSize}px` }}>{song.lyrics_raw || '（歌詞なし）'}</pre>
        ) : (
          <div ref={lyricsRef} className="p-4 sm:p-6 max-h-[70vh] overflow-y-auto scroll-smooth" style={{ fontSize: `${fontSize}px` }}>
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
      <div className="mt-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-4 sm:gap-x-6 gap-y-1 text-[10px] sm:text-[11px] text-[var(--muted-foreground)]">
          <span>作成: {new Date(song.created_at).toLocaleString('ja-JP')}</span>
          <span>更新: {new Date(song.updated_at).toLocaleString('ja-JP')}</span>
          {hasSyncData && <span className="text-green-500/60">{syncLines.length} 行同期済み</span>}
        </div>
        {!spotify?.connected && (
          <a href="/api/auth/login" className="text-[11px] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors">Spotify連携</a>
        )}
      </div>

      {toast && <div className={`toast toast-${toast.type}`}>{toast.msg}</div>}
    </div>
  );
}
