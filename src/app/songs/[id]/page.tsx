'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { RefreshCw, Bug, FileText, BookOpen, Pencil, Trash2, ArrowLeft, Minus, Plus, Music, Download, Loader2, ExternalLink, ClipboardPaste, PictureInPicture, Repeat, Copy, Check, MoreVertical, Languages, ChevronDown, Share2 } from 'lucide-react';
import ConfirmDialog from '@/components/ConfirmDialog';
import CoverImage from '@/components/CoverImage';
import FuriganaLineView from '@/components/FuriganaLine';
import { useI18n } from '@/lib/i18n';
import { fmtMs, fmtTime, findActiveLine } from '@/lib/lrc';
import { isTitleMatch, findBestMatch } from '@/lib/match';
import { useSongData } from '@/hooks/useSongData';
import { useSpotifySync } from '@/hooks/useSpotifySync';
import type { SyncRefs } from '@/hooks/useSpotifySync';

/** Reusable button class builder */
function btnCls(active?: boolean, variant?: 'danger') {
  const base = 'inline-flex items-center justify-center rounded-xl transition-colors disabled:opacity-50';
  const size = 'h-11 w-11 sm:h-8 sm:w-8 sm:rounded-md';
  const colors = variant === 'danger'
    ? 'text-[var(--destructive)] bg-[var(--destructive)]/10 hover:bg-[var(--destructive)]/20'
    : active
      ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
      : 'text-[var(--muted-foreground)] bg-[var(--accent)] hover:text-[var(--foreground)]';
  return `${base} ${size} ${colors}`;
}

function btnTextCls(active?: boolean, variant?: 'danger') {
  const base = 'inline-flex items-center justify-center gap-1.5 rounded-xl sm:rounded-md transition-colors disabled:opacity-50 text-xs font-medium px-3 py-2';
  const colors = variant === 'danger'
    ? 'text-[var(--destructive)] bg-[var(--destructive)]/10 hover:bg-[var(--destructive)]/20'
    : active
      ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
      : 'text-[var(--muted-foreground)] bg-[var(--accent)] hover:text-[var(--foreground)] hover:bg-[var(--muted)]';
  return `${base} ${colors}`;
}

export default function SongViewPage() {
  const router = useRouter();
  const params = useParams();
  const { t } = useI18n();
  const id = params?.id as string;

  // Data + handlers hook
  const data = useSongData(id);

  // Mutable ref bag for the rAF sync loop (avoids stale closures)
  const syncRefs = useRef<SyncRefs>({
    songTitle: '',
    furiganaLines: [],
    lineTimestamps: [],
    debug: false,
    followPlaying: true,
    allSongs: [],
    currentSongId: id,
    currentUserEmail: '',
    pipWindow: null,
    lineRefs: { current: [] },
    lyricsRef: { current: null },
  });

  // Current user for match priority
  const [currentUserEmail, setCurrentUserEmail] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    fetch('/api/me').then(r => r.json()).then(d => {
      if (d.authenticated && d.email) {
        setCurrentUserEmail(d.email);
        if (d.isAdmin) setIsAdmin(true);
      }
    }).catch(() => {});
  }, []);

  // Spotify auth check — skip polling if not connected
  const [spotifyConnected, setSpotifyConnected] = useState<boolean | null>(null);
  useEffect(() => {
    fetch('/api/spotify/status')
      .then(r => r.json())
      .then(d => setSpotifyConnected(!!d.connected))
      .catch(() => setSpotifyConnected(false));
  }, []);

  // Spotify sync hook (polling + rAF + follow-playing)
  const sync = useSpotifySync(syncRefs, spotifyConnected === true);

  // Keep syncRefs in sync with state
  useEffect(() => { syncRefs.current.songTitle = data.song?.title || ''; }, [data.song?.title]);
  useEffect(() => { syncRefs.current.furiganaLines = data.furiganaLines; }, [data.furiganaLines]);
  useEffect(() => { syncRefs.current.lineTimestamps = data.lineTimestamps; }, [data.lineTimestamps]);
  useEffect(() => { syncRefs.current.debug = data.debug; }, [data.debug]);
  useEffect(() => { syncRefs.current.followPlaying = sync.followPlaying; }, [sync.followPlaying]);
  useEffect(() => { syncRefs.current.allSongs = data.allSongs; }, [data.allSongs]);
  useEffect(() => { syncRefs.current.currentSongId = id; }, [id]);
  useEffect(() => { syncRefs.current.currentUserEmail = currentUserEmail; }, [currentUserEmail]);
  useEffect(() => { syncRefs.current.pipWindow = sync.pipWindowRef.current; }, [sync.pipWindowRef]);
  useEffect(() => { syncRefs.current.lineRefs = data.lineRefs; }, [data.lineRefs]);
  useEffect(() => { syncRefs.current.lyricsRef = data.lyricsRef; }, [data.lyricsRef]);

  // Re-center on active line when debug toggled off
  useEffect(() => {
    if (!data.debug && sync.activeLine >= 0 && data.lineRefs.current?.[sync.activeLine]) {
      const lineEl = data.lineRefs.current[sync.activeLine];
      const container = data.lyricsRef.current;
      if (lineEl && container) {
        const lineTop = lineEl.offsetTop - container.offsetTop;
        container.scrollTo({ top: lineTop - container.clientHeight / 2 + lineEl.offsetHeight / 2, behavior: 'smooth' });
      }
    }
  }, [data.debug]);

  // PiP detection
  const [pipSupported, setPipSupported] = useState(false);
  useEffect(() => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const api = (window as any).documentPictureInPicture;
      setPipSupported(typeof api?.requestWindow === 'function');
    } catch { setPipSupported(false); }
  }, []);

  // Album cover
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  useEffect(() => {
    if (data.song?.cover_url) setCoverUrl(data.song.cover_url);
  }, [data.song?.cover_url]);
  useEffect(() => {
    if (!id || !currentUserEmail || !spotifyConnected || coverUrl) return;
    fetch(`/api/songs/${id}/cover`)
      .then(async (r) => {
        if (!r.ok) return null;
        const d = await r.json();
        return d.cover_url as string | null;
      })
      .then((url) => { if (url) setCoverUrl(url); })
      .catch(() => {});
  }, [id, currentUserEmail, spotifyConnected, coverUrl]);

  if (data.loading) {
    return <div className="flex items-center justify-center py-32"><div className="h-5 w-5 border-2 border-[var(--muted-foreground)]/30 border-t-[var(--muted-foreground)] rounded-full animate-spin" /></div>;
  }

  if (!data.song) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-center">
        <p className="text-sm text-[var(--muted-foreground)]">{t('song.notFound')}</p>
        <button onClick={() => router.push('/')} className="mt-4 text-xs text-[var(--primary)] hover:underline inline-flex items-center gap-1">
          <ArrowLeft className="h-3 w-3" /> {t('song.backToList')}
        </button>
      </div>
    );
  }

  // Spotify seek — click lyrics line to jump to that time
  const handleSeek = (positionMs: number) => {
    fetch('/api/spotify/seek', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ position_ms: positionMs }),
    }).catch(() => {});
  };

  // Derived state
  const { song, furiganaLines, syncLines, lineTimestamps } = data;
  const { spotify, activeLine, followPlaying, setFollowPlaying, pipWindowRef, highlightRef } = sync;
  const isSameSong = !!(spotify?.is_playing && spotify.track && song && isTitleMatch(spotify.track.name, song.title));
  const isSynced = isSameSong && activeLine >= 0;
  const hasSyncData = syncLines.length > 0;
  const debugSyncActive = spotify?.is_playing && syncLines.length > 0 ? findActiveLine(syncLines, spotify.progress_ms) : -1;
  const playingMatch = spotify?.track && !isSameSong
    ? findBestMatch(data.allSongs.filter((s) => s.id !== id), spotify.track, currentUserEmail)
    : null;

  return (
    <div className="fade-in flex flex-col h-[calc(100dvh-2.75rem)] pb-24 overflow-hidden sm:block sm:h-auto sm:pb-0">
      {/* Breadcrumb */}
      <div className="shrink-0 mb-3 sm:mb-8 flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
        <a href="/" className="hover:text-[var(--foreground)] transition-colors inline-flex items-center gap-1">
          <ArrowLeft className="h-3 w-3" /> {t('common.list')}
        </a>
        <span className="opacity-40">/</span>
        <span className="text-[var(--foreground)] truncate max-w-[200px] sm:max-w-[320px]">{song.title}</span>
      </div>

      {/* Header */}
      <div className="shrink-0 mb-3 sm:mb-8">
        <div className="flex flex-col sm:flex-row items-start justify-between gap-3 sm:gap-4">
          <div className="flex items-start gap-3 sm:gap-4 min-w-0 flex-1">
            <CoverImage src={coverUrl} alt={song.title} size="md" />
            <div className="space-y-0.5 sm:space-y-1 min-w-0">
              <h1 className="text-base sm:text-xl font-semibold tracking-tight">{song.title}</h1>
              {song.artist && <p className="text-xs sm:text-sm text-[var(--muted-foreground)]">{song.artist}</p>}
              {/* Visibility badge + request public */}
              <div className="flex items-center gap-2 mt-1">
              {song.is_public === 1 ? (
                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-[var(--success)]/20 text-[var(--success)]">{t('admin.public')}</span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium bg-[var(--muted)] text-[var(--muted-foreground)]">
                  {t('admin.private')}
                  {isAdmin ? (
                    <button
                      onClick={async () => {
                        try {
                          const res = await fetch(`/api/admin/songs/${id}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ is_public: 1 }),
                          });
                          if (res.ok) {
                            data.refreshSong();
                            data.showToast('success', t('admin.approved'));
                          }
                        } catch {}
                      }}
                      className="text-[var(--primary)] hover:text-[var(--primary)]/80 underline transition-colors"
                    >
                      {t('admin.setPublic')}
                    </button>
                  ) : currentUserEmail && song.created_by === currentUserEmail && song.public_requested !== 1 ? (
                    <button
                      onClick={async () => {
                        try {
                          const res = await fetch(`/api/songs/${id}/request-public`, { method: 'POST' });
                          if (res.ok) {
                            data.refreshSong();
                            data.showToast('success', t('song.requestPublicSuccess'));
                          }
                        } catch {}
                      }}
                      className="text-[var(--primary)] hover:text-[var(--primary)]/80 underline transition-colors"
                    >
                      {t('song.requestPublic')}
                    </button>
                  ) : null}
                </span>
              )}
              {song.is_public === 0 && song.public_requested === 1 && (
                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-[var(--warning)]/20 text-[var(--warning)]">{t('song.requestPublicPending')}</span>
              )}
              {currentUserEmail && song.created_by === currentUserEmail && song.is_public === 0 && (
                song.public_requested === 1 ? (
                  <button
                    onClick={async () => {
                      try {
                        const res = await fetch(`/api/songs/${id}/request-public`, { method: 'DELETE' });
                        if (res.ok) {
                          data.refreshSong();
                          data.showToast('success', t('song.requestPublicCancelled'));
                        }
                      } catch {}
                    }}
                    className="text-[10px] text-[var(--muted-foreground)] hover:text-[var(--foreground)] underline transition-colors"
                  >
                    {t('song.requestPublicCancel')}
                  </button>
                ) : (
                  <button
                    onClick={async () => {
                      try {
                        const res = await fetch(`/api/songs/${id}/request-public`, { method: 'POST' });
                        if (res.ok) {
                          data.refreshSong();
                          data.showToast('success', t('song.requestPublicSuccess'));
                        }
                      } catch {}
                    }}
                    className="text-[10px] text-[var(--primary)] hover:text-[var(--primary)]/80 underline transition-colors"
                  >
                    {t('song.requestPublic')}
                  </button>
                )
              )}
            </div>
          </div>
          {/* Desktop toolbar */}
          <div className="hidden sm:flex items-center gap-2 shrink-0 ml-auto">
            <div className="inline-flex items-center justify-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-2" title={t('song.fontSize')}>
              <button onClick={() => data.setFontSize(s => Math.max(14, s - 2))} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"><Minus className="h-3.5 w-3.5" /></button>
              <span className="text-xs w-5 text-center text-[var(--muted-foreground)] tabular-nums">{data.fontSize}</span>
              <button onClick={() => data.setFontSize(s => Math.min(32, s + 2))} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"><Plus className="h-3.5 w-3.5" /></button>
            </div>
            <button onClick={data.handleCopy} className={btnTextCls(data.copied)}>
              {data.copied ? <Check className="h-3.5 w-3.5 text-[var(--success)]" /> : <Copy className="h-3.5 w-3.5" />}
              {t('song.copy')}
            </button>
            {furiganaLines.length > 0 && pipSupported && (
              <button
                onClick={() => data.openPiP(furiganaLines, song, highlightRef.current, pipWindowRef, lineTimestamps)}
                className={btnTextCls()}
              >
                <PictureInPicture className="h-3.5 w-3.5" /> {t('song.pipBtn')}
              </button>
            )}
            <Link
              href={isSynced && activeLine >= 0 ? `/songs/${id}/share?line=${activeLine}` : `/songs/${id}/share`}
              className={btnTextCls()}
              title={t('song.share')}
            >
              <Share2 className="h-3.5 w-3.5" /> {t('song.share')}
            </Link>

            <ToolbarMenu
              label={<span className="inline-flex items-center gap-1">{t('common.edit')} <ChevronDown className="h-3 w-3 opacity-60" /></span>}
              items={[
                {
                  icon: <Pencil className="h-3.5 w-3.5" />,
                  label: t('common.edit'),
                  onClick: () => router.push(`/songs/${id}/edit`),
                  disabled: !spotifyConnected,
                },
                {
                  icon: <Languages className="h-3.5 w-3.5" />,
                  label: t('furigana.title'),
                  onClick: () => router.push(`/songs/${id}/furigana/edit`),
                  disabled: !spotifyConnected,
                },
              ]}
            />

            <ToolbarMenu
              label={<span className="inline-flex items-center gap-1">{t('song.more')} <ChevronDown className="h-3 w-3 opacity-60" /></span>}
              items={[
                {
                  icon: data.showRaw ? <BookOpen className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />,
                  label: data.showRaw ? t('song.furigana') : t('song.raw'),
                  active: data.showRaw,
                  onClick: () => data.setShowRaw(!data.showRaw),
                },
                {
                  icon: <Bug className="h-3.5 w-3.5" />,
                  label: t('song.debug'),
                  active: data.debug,
                  onClick: () => data.setDebug(!data.debug),
                },
                {
                  icon: <RefreshCw className={`h-3.5 w-3.5 ${data.syncing ? 'animate-spin' : ''}`} />,
                  label: data.syncing ? t('song.syncing') : t('song.sync'),
                  onClick: data.handleSync,
                  disabled: data.syncing || !spotifyConnected,
                },
                ...(!hasSyncData ? [{
                  icon: <ClipboardPaste className="h-3.5 w-3.5" />,
                  label: t('song.paste'),
                  onClick: () => data.setShowPasteLrc(!data.showPasteLrc),
                  disabled: !spotifyConnected,
                } as const] : []),
                {
                  icon: <Download className="h-3.5 w-3.5" />,
                  label: '.txt',
                  href: `/api/songs/${id}/export?format=text`,
                },
                {
                  icon: <Download className="h-3.5 w-3.5" />,
                  label: '.lrc',
                  href: `/api/songs/${id}/export?format=lrc`,
                },
                {
                  icon: <Download className="h-3.5 w-3.5" />,
                  label: `.html ${t('song.exportFurigana')}`,
                  href: `/api/songs/${id}/export?format=html`,
                },
                {
                  icon: <Trash2 className="h-3.5 w-3.5" />,
                  label: t('common.delete'),
                  danger: true,
                  onClick: data.handleDelete,
                  disabled: !spotifyConnected,
                },
              ]}
            />
          </div>
        </div>
      </div>

        {/* Spotify sync indicator */}
        {spotify?.connected && (
          <div className="mt-2 sm:mt-4 flex items-center gap-2">
            {spotify.error ? (
              <div className="flex items-center gap-1.5 sm:gap-2 rounded-full bg-[var(--warning-muted)] border border-[var(--warning)]/30 px-2 sm:px-3 py-1">
                <span className="inline-block h-2 w-2 rounded-full bg-[var(--warning)]" />
                <span className="text-xs text-[var(--warning)]">{t('song.tokenExpired')}</span>
                <a href="/api/auth/login" className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium bg-[var(--warning)]/20 text-[var(--warning)] hover:bg-[var(--warning)]/30 transition-colors shrink-0">
                  <RefreshCw className="h-3 w-3" /><span>{t('song.reconnect')}</span>
                </a>
              </div>
            ) : isSynced ? (
              <div className="flex items-center gap-1.5 sm:gap-2 rounded-full bg-[var(--success-muted)] border border-[var(--success)]/30 px-2 sm:px-3 py-1">
                <span className="inline-block h-2 w-2 rounded-full bg-[var(--success)] animate-pulse" />
                <Music className="h-3 w-3 text-[var(--success)]" />
                <span className="text-xs text-[var(--success)] truncate max-w-[180px] sm:max-w-none">
                  {spotify.track!.name}
                  {data.debug && spotify && <span className="ml-1 sm:ml-2 font-mono text-[var(--success)]/70 text-[10px]">[{fmtTime(spotify.progress_ms)}/{fmtTime(spotify.duration_ms)}]#{activeLine}</span>}
                </span>
              </div>
            ) : isSameSong ? (
              <div className="flex items-center gap-1.5 sm:gap-2 rounded-full bg-[var(--success-muted)]/50 border border-[var(--success)]/20 px-2 sm:px-3 py-1">
                <span className="inline-block h-2 w-2 rounded-full bg-[var(--success)]/50 animate-pulse" />
                <Music className="h-3 w-3 text-[var(--success)]/50" />
                <span className="text-xs text-[var(--success)]/60 truncate max-w-[180px] sm:max-w-none">
                  {spotify.track!.name}
                  {data.debug && <span className="ml-1 font-mono text-[10px]">[{fmtTime(spotify.progress_ms)}/{fmtTime(spotify.duration_ms)}] #{activeLine}</span>}
                </span>
              </div>
            ) : spotify.is_playing && spotify.track ? (
              <div className="flex items-center gap-1.5 sm:gap-2 rounded-full bg-[var(--accent)] px-2 sm:px-3 py-1">
                <span className="inline-block h-2 w-2 rounded-full bg-[var(--muted-foreground)]" />
                <span className="text-xs text-[var(--muted-foreground)] truncate max-w-[140px] sm:max-w-none">
                  {spotify.track.name}
                  {data.debug && <span className="ml-1 font-mono text-[10px]">[{fmtTime(spotify.progress_ms)}/{fmtTime(spotify.duration_ms)}]</span>}
                </span>
                {playingMatch ? (
                  <button onClick={() => router.push(`/songs/${playingMatch.id}`)} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium bg-[var(--accent)] text-[var(--foreground)] hover:bg-[var(--border)] transition-colors shrink-0">
                    <ExternalLink className="h-3 w-3" /><span>{t('song.show')}</span>
                  </button>
                ) : spotifyConnected ? (
                  <button onClick={() => data.handleImportPlaying(spotify)} disabled={data.importing} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium bg-[var(--primary)] text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:opacity-50 shrink-0">
                    {data.importing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}<span>{data.importing ? t('home.importing') : t('song.importBtn')}</span>
                  </button>
                ) : null}
              </div>
            ) : null}
            <button
              onClick={() => setFollowPlaying((v) => !v)}
              className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-medium transition-colors ${followPlaying ? 'bg-[var(--primary)]/20 text-[var(--primary)]' : 'bg-[var(--accent)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]'}`}
              title={followPlaying ? t('song.followOn') : t('song.followOff')}
            >
              <Repeat className="h-3 w-3" />
              <span className="hidden sm:inline">{followPlaying ? t('song.followOn') : t('song.followOff')}</span>
            </button>
          </div>
        )}

        {/* Debug panel */}
        {data.debug && (
          <div className="mt-3 rounded-md bg-[var(--muted)] border border-[var(--border)] p-2 sm:p-3 text-[10px] sm:text-[11px] font-mono space-y-1 overflow-x-auto">
            <div className="text-[var(--primary)] font-medium mb-1.5">Debug Info</div>
            <div>Spotify: {spotify?.connected ? '✓ connected' : '✗ disconnected'} | playing: {String(!!spotify?.is_playing)} | same: {String(isSameSong)} | synced: {String(isSynced)}</div>
            <div>progress: {spotify ? `${spotify.progress_ms}ms (${fmtTime(spotify.progress_ms)})` : '—'} / {spotify ? `${spotify.duration_ms}ms (${fmtTime(spotify.duration_ms)})` : '—'}</div>
            <div>sync: {syncLines.length} | furigana: {furiganaLines.length} | active: #{activeLine} ({activeLine >= 0 && lineTimestamps[activeLine] != null ? fmtMs(lineTimestamps[activeLine]!) : '—'}) | sync: #{debugSyncActive}</div>
            <div>track: {spotify?.track?.name || '—'} | song: {song.title}</div>
            {syncLines.length > 0 && (
              <div className="pt-1.5 mt-1.5 border-t border-[var(--border)]">
                <div className="text-[var(--muted-foreground)] mb-1">Synced timestamps ({syncLines.length} lines):</div>
                <div className="max-h-40 overflow-y-auto space-y-0.5">
                  {syncLines.map((sl, i) => (
                    <div key={i} className={i === debugSyncActive ? 'text-[var(--success)] font-medium' : 'text-[var(--muted-foreground)]'}>[{fmtMs(sl.timeMs)}] {sl.text}</div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Paste LRC UI */}
        {(data.showPasteLrc || data.syncError) && !hasSyncData && (
          <div className="mt-3 rounded-md bg-[var(--muted)] border border-[var(--border)] p-3 sm:p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-[var(--foreground)]">{t('song.pasteLrcTitle')}</span>
              {data.syncError && <span className="text-[10px] text-[var(--destructive)]">{data.syncError}</span>}
            </div>
            <textarea value={data.pasteLrcText} onChange={(e) => data.setPasteLrcText(e.target.value)} placeholder={t('song.pasteLrcPlaceholder')} rows={6} className="w-full rounded-md border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-xs font-mono outline-none focus:border-[var(--primary)] transition-colors placeholder:text-[var(--muted-foreground)]/40 resize-y" />
            <div className="flex items-center gap-2 mt-2">
              <button onClick={data.handlePasteLrc} disabled={!data.pasteLrcText.trim()} className="rounded-md px-3 py-1.5 text-xs font-medium bg-[var(--primary)] text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:opacity-50">{t('common.save')}</button>
              <button onClick={() => { data.setShowPasteLrc(false); data.setPasteLrcText(''); }} className="rounded-md px-3 py-1.5 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors">{t('common.cancel')}</button>
            </div>
          </div>
        )}
      </div>

      {/* Lyrics */}
      <div className="rounded-lg bg-[var(--card)] border border-[var(--border)] overflow-hidden flex-1 min-h-0">
        {data.showRaw ? (
          <pre className="p-4 sm:p-6 whitespace-pre-wrap font-sans leading-relaxed h-full sm:h-auto sm:max-h-[70vh] overflow-y-auto overflow-x-hidden" style={{ fontSize: `${data.fontSize}px` }}>{song.lyrics_raw || t('song.noLyricsParen')}</pre>
        ) : (
          <div ref={data.lyricsRef} className="p-4 sm:p-6 h-full sm:h-auto sm:max-h-[70vh] overflow-y-auto overflow-x-hidden scroll-smooth" style={{ fontSize: `${data.fontSize}px` }}>
            {furiganaLines.length > 0 ? (
              furiganaLines.map((line, i) => (
                <div key={i} ref={(el) => { data.lineRefs.current[i] = el; }}>
                  <FuriganaLineView
                    line={line}
                    isActive={i === activeLine && !!isSynced}
                    debugTs={data.debug && lineTimestamps[i] != null ? lineTimestamps[i] : undefined}
                    timestamp={hasSyncData && lineTimestamps[i] != null ? lineTimestamps[i] : undefined}
                    onSeek={hasSyncData && spotify?.connected ? handleSeek : undefined}
                  />
                </div>
              ))
            ) : data.furiganaLoading ? (
              <div className="flex items-center gap-2 py-8 text-sm text-[var(--muted-foreground)]">
                <div className="h-4 w-4 border-2 border-[var(--muted-foreground)]/30 border-t-[var(--muted-foreground)] rounded-full animate-spin" />
                <span>{t('song.loadingFurigana')}</span>
              </div>
            ) : data.furiganaError ? (
              <div className="flex flex-col gap-3 py-8">
                <div className="flex items-center gap-2 text-sm text-[var(--warning)]">
                  <span>{data.furiganaError}</span>
                </div>
                <pre className="whitespace-pre-wrap font-sans leading-relaxed text-[var(--muted-foreground)]" style={{ fontSize: `${data.fontSize}px` }}>{song.lyrics_raw}</pre>
              </div>
            ) : (
              <p className="text-sm text-[var(--muted-foreground)]">{t('song.noLyricsSimple')}</p>
            )}
          </div>
        )}
      </div>

      {/* Meta */}
      <div className="shrink-0 mt-2 sm:mt-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-1 sm:gap-2">
        <div className="flex flex-wrap items-center gap-x-3 sm:gap-x-6 gap-y-1 text-[10px] sm:text-[11px] text-[var(--muted-foreground)]">
          <span>{t('common.created')}{new Date(song.created_at).toLocaleString('ja-JP')}</span>
          <span>{t('common.updated')}{new Date(song.updated_at).toLocaleString('ja-JP')}</span>
          {hasSyncData && <span className="text-green-500/60">{t('common.linesSynced', { count: String(syncLines.length) })}</span>}
        </div>
        {!spotify?.connected && (
          <a href="/api/auth/login" className="text-[11px] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors">{t('song.spotify')}</a>
        )}
      </div>

      {/* Mobile bottom toolbar */}
      <MobileMenu
        data={data} sync={sync} song={song} id={id} router={router}
        furiganaLines={furiganaLines} hasSyncData={hasSyncData} pipSupported={pipSupported}
        highlightRef={highlightRef} pipWindowRef={pipWindowRef} spotifyConnected={spotifyConnected === true}
        lineTimestamps={lineTimestamps}
      />

      {data.toast && <div className={`toast toast-${data.toast.type}`}>{data.toast.msg}</div>}

      <ConfirmDialog open={data.deleteConfirm} title={t('dialog.deleteConfirmTitle', { title: song?.title || '' })} body={t('dialog.deleteConfirmBody')} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')} variant="danger" onConfirm={data.confirmDelete} onCancel={() => data.setDeleteConfirm(false)} />
      <ConfirmDialog open={!!data.importAlert} title={t('dialog.importErrorTitle')} body={data.importAlert || undefined} confirmLabel={t('common.confirm')} alert onConfirm={() => data.setImportAlert(null)} />
    </div>
  );
}

type ToolbarMenuItem = {
  icon?: ReactNode;
  label: ReactNode;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  href?: string;
};

function ToolbarMenu({ label, items }: { label: ReactNode; items: ToolbarMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)} className={btnTextCls(open)}>
        {label}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 rounded-lg bg-[var(--card)] border border-[var(--border)] shadow-lg py-1 min-w-[160px]">
          {items.map((item, i) => {
            const base = "w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors disabled:opacity-50";
            const cls = item.danger
              ? `${base} text-[var(--destructive)] hover:bg-[var(--destructive)]/10`
              : item.active
                ? `${base} text-[var(--primary)] bg-[var(--primary)]/10`
                : `${base} text-[var(--foreground)] hover:bg-[var(--accent)]`;
            if (item.href) {
              return (
                <a key={i} href={item.href} onClick={() => setOpen(false)} className={cls}>
                  {item.icon}
                  <span>{item.label}</span>
                </a>
              );
            }
            return (
              <button
                key={i}
                onClick={() => { item.onClick?.(); setOpen(false); }}
                disabled={item.disabled}
                className={cls}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Mobile bottom toolbar — A-/A+, Sync, Copy visible; rest in 3-dot menu */
function MobileMenu({ data, sync, song, id, router, furiganaLines, hasSyncData, pipSupported, highlightRef, pipWindowRef, spotifyConnected, lineTimestamps }: {
  data: ReturnType<typeof useSongData>;
  sync: ReturnType<typeof useSpotifySync>;
  song: NonNullable<ReturnType<typeof useSongData>['song']>;
  id: string;
  router: ReturnType<typeof useRouter>;
  furiganaLines: ReturnType<typeof useSongData>['furiganaLines'];
  hasSyncData: boolean;
  pipSupported: boolean;
  highlightRef: React.MutableRefObject<number>;
  pipWindowRef: React.MutableRefObject<Window | null>;
  spotifyConnected: boolean;
  lineTimestamps: (number | null)[];
}) {
  const { t } = useI18n();
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside tap
  useEffect(() => {
    if (!showMenu) return;
    const handler = (e: TouchEvent | MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowMenu(false);
    };
    document.addEventListener('touchstart', handler);
    document.addEventListener('mousedown', handler);
    return () => { document.removeEventListener('touchstart', handler); document.removeEventListener('mousedown', handler); };
  }, [showMenu]);

  const menuItems = [
    { icon: <Share2 className="h-4 w-4" />, label: t('song.share'), onClick: () => router.push(sync.activeLine >= 0 ? `/songs/${id}/share?line=${sync.activeLine}` : `/songs/${id}/share`) },
    { icon: <RefreshCw className={`h-4 w-4 ${data.syncing ? 'animate-spin' : ''}`} />, label: data.syncing ? t('song.syncing') : t('song.sync'), onClick: data.handleSync, disabled: data.syncing },
    ...(pipSupported && furiganaLines.length > 0 ? [{ icon: <PictureInPicture className="h-4 w-4" />, label: t('song.pipBtn'), onClick: () => data.openPiP(furiganaLines, song, highlightRef.current, pipWindowRef, lineTimestamps) }] : []),
    { icon: <Bug className="h-4 w-4" />, label: t('song.debug'), onClick: () => data.setDebug(!data.debug), active: data.debug },
    ...(spotifyConnected ? [
      { icon: <Pencil className="h-4 w-4" />, label: t('common.edit'), onClick: () => router.push(`/songs/${id}/edit`) },
      { icon: <Languages className="h-4 w-4" />, label: t('furigana.title'), onClick: () => router.push(`/songs/${id}/furigana/edit`) },
      { icon: <Trash2 className="h-4 w-4" />, label: t('common.delete'), onClick: data.handleDelete, danger: true },
    ] : []),
  ];

  return (
    <div className="fixed bottom-0 left-0 right-0 sm:hidden z-50 bg-[var(--background)]/95 backdrop-blur-sm border-t border-[var(--border)]">
      <div className="mx-auto max-w-[860px] flex items-center justify-between px-2" style={{ paddingTop: 8, paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 12px)' }}>
        {/* A-/A+ */}
        <div className="flex items-stretch rounded-lg bg-[var(--accent)] overflow-hidden">
          <button onClick={() => data.setFontSize(s => Math.max(14, s - 2))} className="flex items-center justify-center px-2 py-1 text-sm font-medium text-[var(--muted-foreground)] active:text-[var(--foreground)] active:bg-[var(--accent)]">A-</button>
          <div className="w-px bg-[var(--border)]" />
          <button onClick={() => data.setFontSize(s => Math.min(32, s + 2))} className="flex items-center justify-center px-2 py-1 text-base font-medium text-[var(--muted-foreground)] active:text-[var(--foreground)] active:bg-[var(--accent)]">A+</button>
        </div>

        {/* Copy */}
        <button onClick={data.handleCopy} className={`flex items-center justify-center p-2 ${data.copied ? 'text-[var(--success)]' : 'text-[var(--muted-foreground)]'}`}>
          {data.copied ? <Check className="h-5 w-5" /> : <Copy className="h-5 w-5" />}
        </button>

        {/* Paste */}
        {!hasSyncData && (
          <button onClick={() => data.setShowPasteLrc(!data.showPasteLrc)} className={`flex items-center justify-center p-2 ${data.showPasteLrc ? 'text-[var(--primary)]' : 'text-[var(--muted-foreground)]'}`}>
            <ClipboardPaste className="h-5 w-5" />
          </button>
        )}

        {/* Raw / Furigana */}
        <button onClick={() => data.setShowRaw(!data.showRaw)} className="flex items-center justify-center p-2 text-[var(--muted-foreground)]">
          {data.showRaw ? <BookOpen className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
        </button>

        {/* Export */}
        <button onClick={() => data.setShowExport(!data.showExport)} className={`flex items-center justify-center p-2 ${data.showExport ? 'text-[var(--primary)]' : 'text-[var(--muted-foreground)]'}`}>
          <Download className="h-5 w-5" />
        </button>

        {/* 3-dot menu */}
        <div className="relative" ref={menuRef}>
          <button onClick={() => setShowMenu(!showMenu)} className={`flex items-center justify-center p-2 rounded-lg transition-colors ${showMenu ? 'text-[var(--foreground)] bg-[var(--accent)]' : 'text-[var(--muted-foreground)]'}`}>
            <MoreVertical className="h-5 w-5" />
          </button>
          {showMenu && (
            <div className="absolute right-0 bottom-full mb-2 z-50 rounded-xl bg-[var(--card)] border border-[var(--border)] shadow-xl py-1.5 min-w-[180px] fade-in">
              {menuItems.map((item, i) => (
                <button
                  key={i}
                  onClick={() => { item.onClick(); if (!('active' in item)) setShowMenu(false); }}
                  disabled={'disabled' in item ? item.disabled : false}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors disabled:opacity-50 ${
                    'danger' in item && item.danger
                      ? 'text-[var(--destructive)] hover:bg-[var(--destructive)]/10'
                      : 'active' in item && item.active
                        ? 'text-[var(--primary)] bg-[var(--primary)]/10'
                        : 'text-[var(--foreground)] hover:bg-[var(--accent)]'
                  }`}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
