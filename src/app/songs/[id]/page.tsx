'use client';

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useTransitionRouter } from 'next-view-transitions';
import Link from 'next/link';
import { RefreshCw, Bug, Clock3, Pencil, Trash2, ArrowLeft, Minus, Plus, Music, Download, Loader2, ExternalLink, ClipboardPaste, PictureInPicture, Repeat, Copy, Check, MoreVertical, Languages, ChevronDown, Share2 } from 'lucide-react';
import ConfirmDialog from '@/components/ConfirmDialog';
import CoverImage from '@/components/CoverImage';
import FuriganaLineView from '@/components/FuriganaLine';
import Toast from '@/components/Toast';
import SpotifyLoginButton from '@/components/SpotifyLoginButton';
import { useI18n } from '@/lib/i18n';
import { fmtMs, fmtTime, findActiveLine } from '@/lib/lrc';
import { isTitleMatch, findBestMatch } from '@/lib/match';
import { useSongData } from '@/hooks/useSongData';
import { useSpotifySync } from '@/hooks/useSpotifySync';
import type { CoverColor } from '@/lib/cover-color';
import { useCoverTheme } from '@/hooks/useCoverPalette';
import { getCachedSongCover, cacheSongCover } from '@/lib/song-cover-cache';
import type { FuriganaLine } from '@/lib/types';
import { useAuthSession } from '@/lib/auth-session';
import type { SyncRefs } from '@/hooks/useSpotifySync';

/** Reusable button class builder */
function btnCls(active?: boolean, variant?: 'danger') {
  const base = 'inline-flex items-center justify-center rounded-xl transition-colors disabled:opacity-50';
  const size = 'h-11 w-11 sm:h-8 sm:w-8 sm:rounded-md';
  const colors = variant === 'danger'
    ? 'text-[var(--destructive)] bg-[var(--destructive)]/10 hover:bg-[var(--destructive)]/20'
    : active
      ? 'song-accent-button song-accent-button--active'
      : 'song-accent-button';
  return `${base} ${size} ${colors}`;
}

function btnTextCls(active?: boolean, variant?: 'danger') {
  const base = 'inline-flex items-center justify-center gap-1.5 rounded-xl sm:rounded-md transition-colors disabled:opacity-50 text-xs font-medium px-3 py-2';
  const colors = variant === 'danger'
    ? 'text-[var(--destructive)] bg-[var(--destructive)]/10 hover:bg-[var(--destructive)]/20'
    : active
      ? 'song-accent-button song-accent-button--active'
      : 'song-accent-button';
  return `${base} ${colors}`;
}

const LYRICS_SOURCE_KEYS: Record<string, string> = {
  manual: 'lyricsSources.manual',
  none: 'lyricsSources.none',
  'lrclib-exact': 'lyricsSources.lrclibExact',
  'lrclib-canonical': 'lyricsSources.lrclibCanonical',
  'lrclib-search': 'lyricsSources.lrclibSearch',
  petitlyrics: 'lyricsSources.petitlyrics',
  utanet: 'lyricsSources.utanet',
  ytmusic: 'lyricsSources.ytmusic',
};

/** HSL saturation gives vibrant cover art a gentler ambient-light profile. */
function colorSaturation({ r, g, b }: CoverColor) {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const lightness = (max + min) / 2;
  if (max === min) return 0;
  return (max - min) / (1 - Math.abs(2 * lightness - 1));
}

/** Relative luminance lets ambient light remain visible across dark covers without letting bright art bloom. */
function colorLuminance({ r, g, b }: CoverColor) {
  const linear = (channel: number) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

const subscribeStaticCapability = () => () => {};
function getDocumentPiPSupport() {
  if (typeof window === 'undefined') return false;
  const pipWindow = window as Window & {
    documentPictureInPicture?: { requestWindow?: unknown };
  };
  return typeof pipWindow.documentPictureInPicture?.requestWindow === 'function';
}

/** Normalizes source output to a restrained range: dim art gets a modest lift, bright art is capped. */
function ambientBrightness(color: CoverColor) {
  return clamp(1.14 - colorLuminance(color) * 0.46, 0.82, 1.12);
}

/** RGB separation determines whether a second palette colour can read as a distinct light. */
function colorDistance(a: CoverColor, b: CoverColor) {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

export default function SongViewPage() {
  const router = useRouter();
  const transitionRouter = useTransitionRouter();
  const params = useParams();
  const { t } = useI18n();
  const id = params?.id as string;

  // Data + handlers hook
  const data = useSongData(id);
  const lyricsRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);

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
  });

  // Cached login state renders immediately; useAuthSession revalidates it on every entry.
  const { session } = useAuthSession();
  const currentUserEmail = session?.user?.email || '';
  const isAdmin = session?.user?.isAdmin === true;
  const spotifyConnected = session ? session.spotify.connected : null;

  // Spotify sync hook (polling + rAF + follow-playing)
  const sync = useSpotifySync(syncRefs, lineRefs, lyricsRef, spotifyConnected === true);

  // Keep syncRefs in sync with state
  useEffect(() => { syncRefs.current.songTitle = data.song?.title || ''; }, [data.song?.title]);
  useEffect(() => { syncRefs.current.furiganaLines = data.furiganaLines; }, [data.furiganaLines]);
  useEffect(() => { syncRefs.current.lineTimestamps = data.lineTimestamps; }, [data.lineTimestamps]);
  useEffect(() => { syncRefs.current.debug = data.debug; }, [data.debug]);
  useEffect(() => { syncRefs.current.followPlaying = sync.followPlaying; }, [sync.followPlaying]);
  useEffect(() => { syncRefs.current.allSongs = data.allSongs; }, [data.allSongs]);
  useEffect(() => { syncRefs.current.currentSongId = id; }, [id]);
  useEffect(() => { syncRefs.current.currentUserEmail = currentUserEmail; }, [currentUserEmail]);

  // Re-center on active line when debug toggled off
  useEffect(() => {
    if (!data.debug && sync.activeLine >= 0 && lineRefs.current?.[sync.activeLine]) {
      const lineEl = lineRefs.current[sync.activeLine];
      const container = lyricsRef.current;
      if (lineEl && container) {
        const lineTop = lineEl.offsetTop - container.offsetTop;
        container.scrollTo({ top: lineTop - container.clientHeight / 2 + lineEl.offsetHeight / 2, behavior: 'smooth' });
      }
    }
  }, [data.debug]);

  // PiP detection
  const pipSupported = useSyncExternalStore(subscribeStaticCapability, getDocumentPiPSupport, () => false);

  // Start with the list's cached cover so the shared element has real visual content on its first render.
  const [fallbackCoverUrl, setFallbackCoverUrl] = useState<string | null>(() => getCachedSongCover(id));
  const coverUrl = data.song?.cover_url ?? fallbackCoverUrl;
  const coverTheme = useCoverTheme(coverUrl);
  const coverColor = coverTheme.palette;
  useEffect(() => {
    if (data.song?.cover_url) {
      cacheSongCover(id, data.song.cover_url);
    }
  }, [data.song?.cover_url, id]);
  useEffect(() => {
    if (!id || !currentUserEmail || !spotifyConnected || coverUrl || !data.song?.permissions?.can_edit) return;
    fetch(`/api/songs/${id}/cover`)
      .then(async (r) => {
        if (!r.ok) return null;
        const d = await r.json();
        return d.cover_url as string | null;
      })
      .then((url) => {
        if (url) {
          cacheSongCover(id, url);
          setFallbackCoverUrl(url);
        }
      })
      .catch(() => {});
  }, [id, currentUserEmail, spotifyConnected, coverUrl, data.song?.permissions?.can_edit]);
  if (data.loading) {
    return (
      <div className="fade-in flex flex-col h-[calc(100dvh-2.75rem)] pb-24 overflow-hidden sm:block sm:h-auto sm:pb-0">
        {/* Breadcrumb */}
        <div className="shrink-0 mb-3 sm:mb-8 flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
          <button onClick={() => transitionRouter.push('/')} className="hover:text-[var(--foreground)] transition-colors inline-flex items-center gap-1">
            <ArrowLeft className="h-3 w-3" /> {t('common.list')}
          </button>
        </div>
        {/* Header placeholder with named cover */}
        <div className="shrink-0 mb-4 sm:mb-6">
          <div className="flex flex-col sm:flex-row items-start justify-between gap-3 sm:gap-4">
            <div className="flex items-start gap-3 sm:gap-4 min-w-0 flex-1">
              <CoverImage src={coverUrl} alt="" size="md" viewTransitionName={`song-cover-${id}`} />
              <div className="space-y-0.5 sm:space-y-1 min-w-0 flex-1 py-0.5">
                <div className="h-6 w-48 bg-[var(--muted)] rounded animate-pulse cover-transition" style={{ ['--vt-name' as string]: `song-title-${id}` }} />
                <div className="h-4 w-32 bg-[var(--muted)] rounded animate-pulse cover-transition" style={{ ['--vt-name' as string]: `song-artist-${id}` }} />
              </div>
            </div>
          </div>
        </div>
        {/* Spinner */}
        <div className="flex-1 flex items-center justify-center">
          <div className="h-5 w-5 border-2 border-[var(--muted-foreground)]/30 border-t-[var(--muted-foreground)] rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (!data.song) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-center">
        <p className="text-sm text-[var(--muted-foreground)]">{t('song.notFound')}</p>
        <button onClick={() => transitionRouter.push('/')} className="mt-4 text-xs text-[var(--song-accent)] hover:underline inline-flex items-center gap-1">
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
  const canEdit = song?.permissions?.can_edit === true;
  const lyricsSourceKey = song ? LYRICS_SOURCE_KEYS[song.lyrics_source] : undefined;
  const lyricsSourceLabel = song ? (lyricsSourceKey ? t(lyricsSourceKey) : song.lyrics_source) : '';
  const { spotify, activeLine, followPlaying, setFollowPlaying, pipWindowRef } = sync;
  const handleOpenPiP = () => data.openPiP(furiganaLines, song, activeLine, pipWindowRef, lineTimestamps);
  const isSameSong = !!(spotify?.is_playing && spotify.track && song && (
    song.spotify_track_id && spotify.track.id
      ? song.spotify_track_id === spotify.track.id
      : isTitleMatch(spotify.track.name, song.title)
  ));
  const isSynced = isSameSong && activeLine >= 0;
  const hasSyncData = syncLines.length > 0;
  const debugSyncActive = spotify?.is_playing && syncLines.length > 0 ? findActiveLine(syncLines, spotify.progress_ms) : -1;
  const playingMatch = spotify?.track && !isSameSong
    ? findBestMatch(data.allSongs.filter((s) => s.id !== id), spotify.track, currentUserEmail)
    : null;
  const songThemeStyle = coverTheme.style;
  const coverSaturation = coverColor ? Math.max(colorSaturation(coverColor.primary), colorSaturation(coverColor.secondary), colorSaturation(coverColor.tertiary)) : 0;
  // Near-monochrome covers retain the main halo without manufacturing a second,
  // muddy source. A clearly separated tertiary colour earns a visible rim light.
  const paletteSeparation = coverColor
    ? Math.max(
        colorDistance(coverColor.primary, coverColor.tertiary),
        colorDistance(coverColor.secondary, coverColor.tertiary),
      )
    : 0;
  const sideLightPresence = Math.max(0, Math.min(1, (paletteSeparation - 36) / 112));
  const ambientProfile = coverSaturation >= 0.68
    ? { opacity: 0.62, core: '64%', mid: '40%', edge: '14%', blur: '38px', shadow: '24%', staticShadow: '48%', sideOpacity: 0.30 + sideLightPresence * 0.28, breathOpacity: 0.62, breathMinOpacity: 0.36 }
    : coverSaturation >= 0.42
      ? { opacity: 0.68, core: '66%', mid: '44%', edge: '16%', blur: '33px', shadow: '26%', staticShadow: '52%', sideOpacity: 0.32 + sideLightPresence * 0.30, breathOpacity: 0.68, breathMinOpacity: 0.40 }
      : { opacity: 0.78, core: '72%', mid: '50%', edge: '18%', blur: '28px', shadow: '30%', staticShadow: '56%', sideOpacity: 0.34 + sideLightPresence * 0.32, breathOpacity: 0.74, breathMinOpacity: 0.44 };
  // Clamp alpha separately from color luminance: the minimum keeps muted covers readable,
  // while maximums prevent saturated/light covers from overpowering the lyric card.
  const mainOpacity = clamp(ambientProfile.opacity, 0.62, 0.70);
  const sideOpacity = clamp(ambientProfile.sideOpacity, 0.32, 0.52);
  const breathOpacity = clamp(ambientProfile.breathOpacity, 0.58, 0.68);
  const breathMinOpacity = clamp(ambientProfile.breathMinOpacity, 0.34, 0.42);
  const mainBrightness = coverColor ? ambientBrightness(coverColor.secondary) : 1;
  const sideBrightness = coverColor ? ambientBrightness(coverColor.tertiary) : 1;
  const edgeBrightness = coverColor ? ambientBrightness(coverColor.primary) : 1;
  const staticShadow = `${clamp(Number.parseFloat(ambientProfile.staticShadow) * edgeBrightness, 44, 54)}%`;
  const shadow = `${clamp(Number.parseFloat(ambientProfile.shadow) * edgeBrightness, 22, 28)}%`;
  const lyricPanelStyle = coverColor
    ? {
        ['--lyric-accent' as string]: `rgb(${coverColor.primary.r} ${coverColor.primary.g} ${coverColor.primary.b})`,
        ['--lyric-orbit-accent' as string]: `rgb(${coverColor.secondary.r} ${coverColor.secondary.g} ${coverColor.secondary.b})`,
        ['--lyric-orbit-accent-2' as string]: `rgb(${coverColor.tertiary.r} ${coverColor.tertiary.g} ${coverColor.tertiary.b})`,
        ['--lyric-ambient-opacity' as string]: String(mainOpacity),
        ['--lyric-ambient-main-brightness' as string]: String(mainBrightness),
        ['--lyric-ambient-side-brightness' as string]: String(sideBrightness),
        ['--lyric-ambient-edge-brightness' as string]: String(edgeBrightness),
        ['--lyric-ambient-core' as string]: ambientProfile.core,
        ['--lyric-ambient-mid' as string]: ambientProfile.mid,
        ['--lyric-ambient-edge' as string]: ambientProfile.edge,
        ['--lyric-ambient-blur' as string]: ambientProfile.blur,
        ['--lyric-shadow-strength' as string]: shadow,
        ['--lyric-static-shadow-strength' as string]: staticShadow,
        ['--lyric-ambient-secondary-opacity' as string]: String(sideOpacity),
        ['--lyric-ambient-breath-opacity' as string]: String(breathOpacity),
        ['--lyric-ambient-breath-min-opacity' as string]: String(breathMinOpacity),
      }
    : undefined;

  const copyLyricLine = async (line: FuriganaLine) => {
    const text = line.segments.map((segment) => segment.text).join('');
    if (!text) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const copied = document.execCommand('copy');
        textarea.remove();
        if (!copied) throw new Error('copy_failed');
      }
      data.showToast('success', t('share.copied'));
    } catch {
      data.showToast('error', t('song.copyFailed'));
    }
  };

  return (
    <div className={`song-view fade-in flex flex-col h-[calc(100dvh-2.75rem)] pb-24 overflow-visible sm:block sm:h-auto sm:pb-0${coverColor ? ' song-view--accented' : ''}`} style={songThemeStyle}>
      {/* Breadcrumb */}
      <div className="shrink-0 mb-3 sm:mb-8 flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
        <button onClick={() => transitionRouter.push('/')} className="hover:text-[var(--foreground)] transition-colors inline-flex items-center gap-1">
          <ArrowLeft className="h-3 w-3" /> {t('common.list')}
        </button>
        <span className="opacity-40">/</span>
        <span className="text-[var(--foreground)] truncate max-w-[200px] sm:max-w-[320px]">{song.title}</span>
      </div>

      {/* Header */}
      <div className="shrink-0 mb-3 sm:mb-8">
        <div className="flex flex-col items-start gap-3 sm:gap-4">
          <div className="flex items-start gap-3 sm:gap-4 min-w-0 w-full">
            <CoverImage src={coverUrl} alt={song.title} size="md" viewTransitionName={`song-cover-${id}`} />
            <div className="flex-1 w-fit max-w-full min-w-0 space-y-0.5 sm:space-y-1">
              <h1 className="text-base sm:text-xl font-semibold tracking-tight break-words cover-transition" style={{ ['--vt-name' as string]: `song-title-${id}` }}>{song.title}</h1>
              {song.artist && <p className="text-xs sm:text-sm text-[var(--muted-foreground)] cover-transition" style={{ ['--vt-name' as string]: `song-artist-${id}` }}>{song.artist}</p>}
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
                      className="text-[var(--song-accent)] hover:text-[var(--song-accent)]/80 underline transition-colors"
                    >
                      {t('admin.setPublic')}
                    </button>
                  ) : canEdit && song.public_requested !== 1 ? (
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
                      className="text-[var(--song-accent)] hover:text-[var(--song-accent)]/80 underline transition-colors"
                    >
                      {t('song.requestPublic')}
                    </button>
                  ) : null}
                </span>
              )}
              {song.is_public === 0 && song.public_requested === 1 && (
                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-[var(--warning)]/20 text-[var(--warning)]">{t('song.requestPublicPending')}</span>
              )}
              {canEdit && !isAdmin && song.is_public === 0 && (
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
                    className="text-[10px] text-[var(--song-accent)] hover:text-[var(--song-accent)]/80 underline transition-colors"
                  >
                    {t('song.requestPublic')}
                  </button>
                )
              )}
            </div>
          </div>
          {/* Desktop toolbar */}
          <div className="hidden self-end sm:flex flex-col items-end gap-3">
            <div className="flex flex-wrap items-center justify-end gap-2 [&>*]:shrink-0">
            <button
              onClick={data.handleCopy}
              className={btnCls(data.copied)}
              aria-label={t('song.copy')}
              title={t('song.copy')}
            >
              {data.copied ? <Check className="h-4 w-4 text-[var(--success)]" /> : <Copy className="h-4 w-4" />}
            </button>
            {furiganaLines.length > 0 && pipSupported && (
              <button
                onClick={handleOpenPiP}
                className={btnCls()}
                aria-label={t('song.pipBtn')}
                title={t('song.pipBtn')}
              >
                <PictureInPicture className="h-4 w-4" />
              </button>
            )}
            <Link
              href={isSynced && activeLine >= 0 ? `/songs/${id}/share?line=${activeLine}` : `/songs/${id}/share`}
              className={btnCls()}
              aria-label={t('song.share')}
              title={t('song.share')}
            >
              <Share2 className="h-4 w-4" />
            </Link>

            <ToolbarMenu
              label={<span className="inline-flex items-center gap-1"><Languages className="h-3.5 w-3.5" /> {t(data.readingMode === 'original' ? 'song.readingOriginal' : data.readingMode === 'romaji' ? 'song.readingRomaji' : 'song.readingFurigana')} <ChevronDown className="h-3 w-3 opacity-60" /></span>}
              items={([
                ['original', 'song.readingOriginal'],
                ['furigana', 'song.readingFurigana'],
                ['romaji', 'song.readingRomaji'],
              ] as const).map(([mode, label]) => ({
                icon: <Languages className="h-3.5 w-3.5" />,
                label: t(label),
                active: data.readingMode === mode,
                onClick: () => data.setReadingMode(mode),
              }))}
            />

            <ToolbarMenu
              label={<span className="inline-flex items-center gap-1">{t('common.edit')} <ChevronDown className="h-3 w-3 opacity-60" /></span>}
              items={[
                {
                  icon: <Pencil className="h-3.5 w-3.5" />,
                  label: t('common.edit'),
                  onClick: () => router.push(`/songs/${id}/edit`),
                  disabled: !canEdit,
                },
                {
                  icon: <Languages className="h-3.5 w-3.5" />,
                  label: t('furigana.title'),
                  onClick: () => router.push(`/songs/${id}/furigana/edit`),
                  disabled: !canEdit,
                },
                ...(song.lyrics_raw ? [{
                  icon: <Clock3 className="h-3.5 w-3.5" />,
                  label: t('song.timelineEdit'),
                  onClick: () => router.push(`/songs/${id}/timeline/edit`),
                  disabled: !canEdit,
                } as const] : []),
              ]}
            />

            <ToolbarMenu
              label={<span className="inline-flex items-center gap-1">{t('song.more')} <ChevronDown className="h-3 w-3 opacity-60" /></span>}
              items={[
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
                  disabled: data.syncing || !canEdit,
                },
                ...(!hasSyncData ? [{
                  icon: <ClipboardPaste className="h-3.5 w-3.5" />,
                  label: t('song.paste'),
                  onClick: () => data.setShowPasteLrc(!data.showPasteLrc),
                  disabled: !canEdit,
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
                  disabled: !canEdit,
                },
              ]}
            />
            </div>
            <div className="song-accent-surface inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-2" title={t('song.fontSize')}>
              <button onClick={() => data.setFontSize(s => Math.max(14, s - 2))} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"><Minus className="h-3.5 w-3.5" /></button>
              <span className="w-5 text-center text-xs font-medium tabular-nums" style={{ color: 'color-mix(in srgb, var(--foreground) 90%, var(--song-accent))' }}>{data.fontSize}</span>
              <button onClick={() => data.setFontSize(s => Math.min(32, s + 2))} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"><Plus className="h-3.5 w-3.5" /></button>
            </div>
          </div>
        </div>
      </div>

        {/* Spotify playback status stays mounted so loading/resolved state cannot move the lyrics layout. */}
        <div className="mt-2 sm:mt-4 flex min-h-7 items-center gap-2">
            {spotifyConnected === null || !spotify ? (
              <div className="song-playing-surface flex items-center gap-1.5 sm:gap-2 rounded-full px-2 sm:px-3 py-1">
                {spotifyConnected === null ? <Loader2 className="h-3 w-3 animate-spin text-[var(--muted-foreground)]" /> : <span className="inline-block h-2 w-2 rounded-full bg-[var(--muted-foreground)]" />}
                <span className="text-xs text-[var(--muted-foreground)] truncate max-w-[180px] sm:max-w-none">
                  {spotifyConnected === null ? t('song.spotifyLoading') : t('song.spotifyDisconnected')}
                </span>
              </div>
            ) : spotify.error ? (
              <div className="flex items-center gap-1.5 sm:gap-2 rounded-full bg-[var(--warning-muted)] border border-[var(--warning)]/30 px-2 sm:px-3 py-1">
                <span className="inline-block h-2 w-2 rounded-full bg-[var(--warning)]" />
                <span className="text-xs text-[var(--warning)]">{t('song.tokenExpired')}</span>
                <SpotifyLoginButton className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium bg-[var(--warning)]/20 text-[var(--warning)] hover:bg-[var(--warning)]/30 transition-colors shrink-0 disabled:opacity-60">
                  <RefreshCw className="h-3 w-3" /><span>{t('song.reconnect')}</span>
                </SpotifyLoginButton>
              </div>
            ) : isSynced ? (
              <div className="song-playing-surface song-playing-surface--synced flex items-center gap-1.5 sm:gap-2 rounded-full px-2 sm:px-3 py-1">
                <span className="inline-block h-2 w-2 rounded-full bg-[var(--success)] animate-pulse" />
                <Music className="h-3 w-3 text-[var(--success)]" />
                <span className="text-xs text-[var(--success)] truncate max-w-[180px] sm:max-w-none">
                  {spotify.track!.name}
                  {data.debug && spotify && <span className="ml-1 sm:ml-2 font-mono text-[var(--success)]/70 text-[10px]">[{fmtTime(spotify.progress_ms)}/{fmtTime(spotify.duration_ms)}]#{activeLine}</span>}
                </span>
              </div>
            ) : isSameSong ? (
              <div className="song-playing-surface song-playing-surface--matching flex items-center gap-1.5 sm:gap-2 rounded-full px-2 sm:px-3 py-1">
                <span className="inline-block h-2 w-2 rounded-full bg-[var(--success)]/50 animate-pulse" />
                <Music className="h-3 w-3 text-[var(--success)]/50" />
                <span className="text-xs text-[var(--success)]/60 truncate max-w-[180px] sm:max-w-none">
                  {spotify.track!.name}
                  {data.debug && <span className="ml-1 font-mono text-[10px]">[{fmtTime(spotify.progress_ms)}/{fmtTime(spotify.duration_ms)}] #{activeLine}</span>}
                </span>
              </div>
            ) : spotify.is_playing && spotify.track ? (
              <div className="song-playing-surface flex items-center gap-1.5 sm:gap-2 rounded-full px-2 sm:px-3 py-1">
                <span className="inline-block h-2 w-2 rounded-full bg-[var(--muted-foreground)]" />
                <span className="text-xs text-[var(--muted-foreground)] truncate max-w-[140px] sm:max-w-none">
                  {spotify.track.name}
                  {data.debug && <span className="ml-1 font-mono text-[10px]">[{fmtTime(spotify.progress_ms)}/{fmtTime(spotify.duration_ms)}]</span>}
                </span>
                {playingMatch ? (
                  <button onClick={() => router.push(`/songs/${playingMatch.id}`)} className="song-playing-action inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium text-[var(--foreground)] transition-colors shrink-0">
                    <ExternalLink className="h-3 w-3" /><span>{t('song.show')}</span>
                  </button>
                ) : spotifyConnected ? (
                  <button onClick={() => data.handleImportPlaying(spotify)} disabled={data.importing} className="song-playing-action--primary inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition-opacity hover:opacity-90 disabled:opacity-50 shrink-0">
                    {data.importing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}<span>{data.importing ? t('home.importing') : t('song.importBtn')}</span>
                  </button>
                ) : null}
              </div>
            ) : null}
            {spotify?.connected && (
              <button
                onClick={() => setFollowPlaying((v) => !v)}
                className={`song-follow-button shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-medium transition-colors ${followPlaying ? 'song-follow-button--active' : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'}`}
                title={followPlaying ? t('song.followOn') : t('song.followOff')}
              >
                <Repeat className="h-3 w-3" />
                <span className="hidden sm:inline">{followPlaying ? t('song.followOn') : t('song.followOff')}</span>
              </button>
            )}
          </div>

        {/* Debug panel */}
        {data.debug && (
          <div className="mt-3 rounded-md bg-[var(--muted)] border border-[var(--border)] p-2 sm:p-3 text-[10px] sm:text-[11px] font-mono space-y-1 overflow-x-auto">
            <div className="text-[var(--song-accent)] font-medium mb-1.5">Debug Info</div>
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
            <textarea value={data.pasteLrcText} onChange={(e) => data.setPasteLrcText(e.target.value)} placeholder={t('song.pasteLrcPlaceholder')} rows={6} className="w-full rounded-md border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-xs font-mono outline-none focus:border-[var(--song-accent)] transition-colors placeholder:text-[var(--muted-foreground)]/40 resize-y" />
            <div className="flex items-center gap-2 mt-2">
              <button onClick={data.handlePasteLrc} disabled={!data.pasteLrcText.trim()} className="song-editor-primary-button rounded-md px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-90 disabled:opacity-50">{t('common.save')}</button>
              <button onClick={() => { data.setShowPasteLrc(false); data.setPasteLrcText(''); }} className="rounded-md px-3 py-1.5 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors">{t('common.cancel')}</button>
            </div>
          </div>
        )}
      </div>
      <div className="lyrics-panel-shell relative isolate flex-1 min-h-0" style={lyricPanelStyle}>
        <div className="lyrics-ambient-breath" aria-hidden="true" />
        <div className="lyrics-ambient-orbit" aria-hidden="true" />
        <div className="lyrics-ambient-orbit lyrics-ambient-orbit--secondary" aria-hidden="true" />
        <div className="lyrics-panel relative isolate h-full rounded-lg overflow-hidden">
          <div ref={lyricsRef} className="relative z-10 p-4 sm:p-6 h-full sm:h-auto sm:max-h-[70vh] overflow-y-auto overflow-x-hidden scroll-smooth" style={{ fontSize: `${data.fontSize}px` }}>
            {furiganaLines.length > 0 ? (
              furiganaLines.map((line, i) => (
                <div key={i} ref={(el) => { lineRefs.current[i] = el; }}>
                  <FuriganaLineView
                    line={line}
                    isActive={i === activeLine && !!isSynced}
                    debugTs={data.debug && lineTimestamps[i] != null ? lineTimestamps[i] : undefined}
                    timestamp={hasSyncData && lineTimestamps[i] != null ? lineTimestamps[i] : undefined}
                    onSeek={hasSyncData && isSameSong && spotify?.connected ? handleSeek : undefined}
                    onCopyLine={() => copyLyricLine(line)}
                    onShareLine={() => router.push(`/songs/${id}/share?line=${i}`)}
                    onCorrectFurigana={() => router.push(`/songs/${id}/furigana/edit`)}
                    canCorrectFurigana={canEdit}
                    readingMode={data.readingMode}
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
        </div>
      </div>

      {/* Meta */}
      <div className="shrink-0 mt-2 sm:mt-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-1 sm:gap-2">
        <div className="flex flex-wrap items-center gap-x-3 sm:gap-x-6 gap-y-1 text-[10px] sm:text-[11px] text-[var(--muted-foreground)]">
          <span>{t('common.created')}{new Date(song.created_at).toLocaleString('ja-JP')}</span>
          <span>{t('common.updated')}{new Date(song.updated_at).toLocaleString('ja-JP')}</span>
          {hasSyncData && <span className="text-green-500/60">{t('common.linesSynced', { count: String(syncLines.length) })}</span>}
          <span>{t('song.lyricsSource', { source: lyricsSourceLabel })}</span>
          <span className={(song.lyrics_confidence ?? 100) >= 90 ? 'text-[var(--success)]/70' : (song.lyrics_confidence ?? 100) >= 75 ? 'text-[var(--warning)]/80' : 'text-[var(--destructive)]/80'}>{t('song.lyricsConfidence', { confidence: String(song.lyrics_confidence ?? 100) })}</span>
          {song.spotify_track_id && <span title={t('song.spotifyTrackId', { id: song.spotify_track_id })}>Spotify · {song.spotify_track_id.slice(0, 8)}…</span>}
          {song.spotify_album && <span>{t('song.spotifyAlbum', { album: song.spotify_album })}</span>}
        </div>
        {!spotify?.connected && (
          <SpotifyLoginButton className="text-[11px] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors disabled:opacity-60">{t('song.spotify')}</SpotifyLoginButton>
        )}
      </div>

      {/* Mobile bottom toolbar */}
      <MobileMenu
        data={data} sync={sync} song={song} id={id} router={router}
        furiganaLines={furiganaLines} hasSyncData={hasSyncData} pipSupported={pipSupported}
        onOpenPiP={handleOpenPiP} canEdit={canEdit}
      />

      {data.toast && <Toast type={data.toast.type} message={data.toast.msg} />}

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

/** Icon-only mobile controls reveal their localized action on a touch long-press. */
function MobileIconButton({ label, className = '', children, onClick, ...props }: React.ComponentProps<'button'> & { label: string }) {
  const [showLabel, setShowLabel] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressedRef = useRef(false);

  const clearLongPress = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  useEffect(() => clearLongPress, []);

  return (
    <button
      {...props}
      aria-label={label}
      title={label}
      className={`song-mobile-button relative flex items-center justify-center rounded-lg p-2 ${className}`}
      onPointerDown={(event) => {
        props.onPointerDown?.(event);
        if (event.pointerType === 'mouse') return;
        longPressedRef.current = false;
        timerRef.current = setTimeout(() => {
          longPressedRef.current = true;
          setShowLabel(true);
        }, 450);
      }}
      onPointerUp={(event) => {
        props.onPointerUp?.(event);
        clearLongPress();
      }}
      onPointerCancel={(event) => {
        props.onPointerCancel?.(event);
        clearLongPress();
        setShowLabel(false);
      }}
      onContextMenu={(event) => {
        props.onContextMenu?.(event);
        event.preventDefault();
      }}
      onClick={(event) => {
        if (longPressedRef.current) {
          event.preventDefault();
          longPressedRef.current = false;
          setShowLabel(false);
          return;
        }
        onClick?.(event);
      }}
    >
      {children}
      {showLabel && <span role="status" className="song-mobile-tooltip">{label}</span>}
    </button>
  );
}

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
                ? `${base} text-[var(--song-accent)] bg-[var(--song-accent)]/10`
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
function MobileMenu({ data, sync, song, id, router, furiganaLines, hasSyncData, pipSupported, onOpenPiP, canEdit }: {
  data: ReturnType<typeof useSongData>;
  sync: ReturnType<typeof useSpotifySync>;
  song: NonNullable<ReturnType<typeof useSongData>['song']>;
  id: string;
  router: ReturnType<typeof useRouter>;
  furiganaLines: ReturnType<typeof useSongData>['furiganaLines'];
  hasSyncData: boolean;
  pipSupported: boolean;
  onOpenPiP: () => void;
  canEdit: boolean;
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
    { icon: <RefreshCw className={`h-4 w-4 ${data.syncing ? 'animate-spin' : ''}`} />, label: data.syncing ? t('song.syncing') : t('song.sync'), onClick: data.handleSync, disabled: data.syncing || !canEdit },
    ...(song.lyrics_raw && canEdit ? [{ icon: <Clock3 className="h-4 w-4" />, label: t('song.timelineEdit'), onClick: () => router.push(`/songs/${id}/timeline/edit`) }] : []),
    ...(pipSupported && furiganaLines.length > 0 ? [{ icon: <PictureInPicture className="h-4 w-4" />, label: t('song.pipBtn'), onClick: onOpenPiP }] : []),
    { icon: <Bug className="h-4 w-4" />, label: t('song.debug'), onClick: () => data.setDebug(!data.debug), active: data.debug },
    { icon: <Download className="h-4 w-4" />, label: '.txt', onClick: () => { window.location.href = `/api/songs/${id}/export?format=text`; } },
    { icon: <Download className="h-4 w-4" />, label: '.lrc', onClick: () => { window.location.href = `/api/songs/${id}/export?format=lrc`; } },
    { icon: <Download className="h-4 w-4" />, label: `.html ${t('song.exportFurigana')}`, onClick: () => { window.location.href = `/api/songs/${id}/export?format=html`; } },
    ...(canEdit ? [
      { icon: <Pencil className="h-4 w-4" />, label: t('common.edit'), onClick: () => router.push(`/songs/${id}/edit`) },
      { icon: <Languages className="h-4 w-4" />, label: t('furigana.title'), onClick: () => router.push(`/songs/${id}/furigana/edit`) },
      { icon: <Trash2 className="h-4 w-4" />, label: t('common.delete'), onClick: data.handleDelete, danger: true },
    ] : []),
  ];

  return (
    <div className="fixed bottom-0 left-0 right-0 sm:hidden z-50 bg-[var(--background)]/95 backdrop-blur-sm border-t border-[var(--border)]">
      <div className="mx-auto max-w-[860px] flex items-center justify-between px-2" style={{ paddingTop: 8, paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 12px)' }}>
        {/* A-/A+ */}
        <div className="song-mobile-surface flex items-stretch rounded-lg overflow-hidden">
          <button onClick={() => data.setFontSize(s => Math.max(14, s - 2))} className="song-mobile-text-button flex items-center justify-center px-2 py-1 text-sm font-medium">A-</button>
          <div className="w-px bg-[var(--border)]" />
          <button onClick={() => data.setFontSize(s => Math.min(32, s + 2))} className="song-mobile-text-button flex items-center justify-center px-2 py-1 text-base font-medium">A+</button>
        </div>

        {/* Copy */}
        <MobileIconButton label={data.copied ? t('share.copied') : t('song.copy')} onClick={data.handleCopy} className={data.copied ? 'text-[var(--success)]' : ''}>
          {data.copied ? <Check className="h-5 w-5" /> : <Copy className="h-5 w-5" />}
        </MobileIconButton>

        {/* Paste */}
        {!hasSyncData && canEdit && (
          <MobileIconButton label={t('song.paste')} onClick={() => data.setShowPasteLrc(!data.showPasteLrc)} className={data.showPasteLrc ? 'song-mobile-button--active' : ''}>
            <ClipboardPaste className="h-5 w-5" />
          </MobileIconButton>
        )}

        {/* Original / Furigana / Romaji */}
        <MobileIconButton
          label={t(data.readingMode === 'original' ? 'song.readingOriginal' : data.readingMode === 'romaji' ? 'song.readingRomaji' : 'song.readingFurigana')}
          onClick={() => data.setReadingMode(data.readingMode === 'original' ? 'furigana' : data.readingMode === 'furigana' ? 'romaji' : 'original')}
          className={data.readingMode !== 'furigana' ? 'song-mobile-button--active' : ''}
        >
          <Languages className="h-5 w-5" />
        </MobileIconButton>

        {/* Share */}
        <MobileIconButton
          label={t('song.share')}
          onClick={() => router.push(sync.activeLine >= 0 ? `/songs/${id}/share?line=${sync.activeLine}` : `/songs/${id}/share`)}
        >
          <Share2 className="h-5 w-5" />
        </MobileIconButton>

        {/* 3-dot menu */}
        <div className="relative" ref={menuRef}>
          <MobileIconButton label={t('song.more')} onClick={() => setShowMenu(!showMenu)} className={showMenu ? 'song-mobile-button--active' : ''}>
            <MoreVertical className="h-5 w-5" />
          </MobileIconButton>
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
                        ? 'text-[var(--song-accent)] bg-[var(--song-accent)]/10'
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
