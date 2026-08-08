'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, useCallback, type ReactNode } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useTransitionRouter } from 'next-view-transitions';
import Link from 'next/link';
import { RefreshCw, Bug, Clock3, Pencil, Trash2, ArrowLeft, ArrowDown, Minus, Plus, Music, Download, Loader2, ExternalLink, PictureInPicture, Repeat, Copy, Check, MoreVertical, Languages, ChevronDown, Share2, Info, X, CircleAlert, Palette, SlidersHorizontal, Brain, FlaskConical } from 'lucide-react';
import ConfirmDialog from '@/components/ConfirmDialog';
import CoverImage from '@/components/CoverImage';
import FuriganaLineView from '@/components/FuriganaLine';
import LyricsDotGrid, { DEFAULT_DOT_GRID_PARAMS, type DotGridParams } from '@/components/LyricsDotGrid';
import LyricsDotParamsPanel from '@/components/LyricsDotParamsPanel';
import { useSpectrumCapture } from '@/hooks/useSpectrumCapture';
import ExperimentsPanel from '@/components/ExperimentsPanel';
import Toast from '@/components/Toast';
import TranslationStatusOverlay from '@/components/TranslationStatusOverlay';
import { ToolbarMenu, buildReadingMenuItems, type ToolbarMenuItem } from '@/components/song/ToolbarMenu';
import { MobileMenu } from '@/components/song/MobileMenu';
import DownloadDialog from '@/components/song/DownloadDialog';
import { isEmptyAfterTrim } from '@/lib/lyrics-export';
import SpotifyLoginButton from '@/components/SpotifyLoginButton';
import { useI18n } from '@/lib/i18n';
import { fmtMs, fmtTime, findActiveLine } from '@/lib/lrc';
import { isTitleMatch, findBestMatch } from '@/lib/match';
import { useSongData } from '@/hooks/useSongData';
import { useSpotifySync } from '@/hooks/useSpotifySync';
import { animateSmoothScroll } from '@/lib/scroll-ease';
import type { CoverColor } from '@/lib/cover-color';
import type { CoverPalette } from '@/lib/cover-color';
import { useCoverTheme } from '@/hooks/useCoverPalette';
import { getCachedSongCover, cacheSongCover, clearCachedSongPalette } from '@/lib/song-cover-cache';
import { getCachedSong } from '@/lib/song-list-cache';
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
  const { t, bcp47 } = useI18n();
  const id = params?.id as string;
  const cachedSong = useMemo(() => getCachedSong(id), [id]);

  // Data + handlers hook
  const data = useSongData(id);
  const [showSyncConfirm, setShowSyncConfirm] = useState(false);
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
        animateSmoothScroll(container, lineTop - container.clientHeight / 2 + lineEl.offsetHeight / 2);
      }
    }
  }, [data.debug]);

  // PiP detection
  const pipSupported = useSyncExternalStore(subscribeStaticCapability, getDocumentPiPSupport, () => false);

  // Start with the list's cached cover so the shared element has real visual content on its first render.
  const [fallbackCoverUrl, setFallbackCoverUrl] = useState<string | null>(() => getCachedSongCover(id));
  const [showSongInfo, setShowSongInfo] = useState(false);
  const [showDownloadDialog, setShowDownloadDialog] = useState(false);
  const [coverRefresh, setCoverRefresh] = useState(0);
  const [showDotParams, setShowDotParams] = useState(false);
  const [showExperiments, setShowExperiments] = useState(false);
  const spectrum = useSpectrumCapture();

  const closeExperiments = useCallback(() => {
    // Keep the toggle and the capture running — closing the panel only hides
    // it; the mic stops on page leave (cleanup effect) or manual toggle-off.
    setShowExperiments(false);
  }, []);
  const [dotParams, setDotParams] = useState<DotGridParams>(DEFAULT_DOT_GRID_PARAMS);
  const coverUrl = data.song?.cover_url ?? fallbackCoverUrl;

  /** Persist a freshly extracted palette to the server (skip when unchanged). */
  const handlePaletteExtracted = useCallback((palette: CoverPalette | null) => {
    if (!palette || !data.song) return;
    const server = data.song.cover_palette;
    if (server && JSON.stringify(server) === JSON.stringify(palette)) return;
    void fetch(`/api/songs/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cover_palette: palette }),
    }).then((res) => res.json()).then((updated) => {
      if (updated?.cover_palette) {
        data.refreshSong();
      }
    }).catch(() => { /* server cache is best-effort; localStorage already has it */ });
  }, [id, data.song]);

  const coverTheme = useCoverTheme(coverUrl, coverRefresh, data.song?.cover_palette ?? null, id, handlePaletteExtracted);
  const coverColor = coverTheme.palette;
  useEffect(() => {
    if (data.song?.cover_url) {
      cacheSongCover(id, data.song.cover_url);
    }
  }, [data.song?.cover_url, id]);
  useEffect(() => {
    if (!showSongInfo) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowSongInfo(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showSongInfo]);
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
                {cachedSong ? (
                  <>
                    <div className="text-lg sm:text-xl font-semibold tracking-tight truncate">{cachedSong.title}</div>
                    <div className="text-sm text-[var(--muted-foreground)] truncate">{cachedSong.artist || t('common.unknownArtist')}</div>
                  </>
                ) : (
                  <>
                    <div className="h-6 w-48 bg-[var(--muted)] rounded animate-pulse" />
                    <div className="h-4 w-32 bg-[var(--muted)] rounded animate-pulse" />
                  </>
                )}
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
  const { spotify, syncState, resumeSync, activeLine, followPlaying, setFollowPlaying, pipWindowRef } = sync;
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

  const copyLyricTranslation = async (index: number) => {
    const text = data.translations[index]?.trim();
    if (!text) {
      data.showToast('error', t('song.copyTranslationEmpty'));
      return;
    }
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
              <h1 className="text-base sm:text-xl font-semibold tracking-tight break-words">{song.title}</h1>
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
            <ToolbarMenu
              label={<span className="inline-flex items-center">{data.copied ? <Check className="h-4 w-4 text-[var(--success)]" /> : <Copy className="h-4 w-4" />}</span>}
              triggerClassName={btnCls(data.copied)}
              items={[
                {
                  icon: <Copy className="h-3.5 w-3.5" />,
                  label: t('song.copyOriginal'),
                  onClick: () => data.handleCopy('original'),
                },
                {
                  icon: <Languages className="h-3.5 w-3.5" />,
                  label: t('song.copyTranslation'),
                  onClick: () => data.handleCopy('translation'),
                  disabled: data.translations.length === 0,
                },
              ]}
            />
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
              label={<span className="inline-flex items-center gap-1"><Languages className="h-3.5 w-3.5" /> {t(data.readingMode === 'original' ? 'song.readingOriginal' : song.reading_scheme === 'yue-jyutping' ? 'song.readingJyutping' : 'song.readingFurigana')} <ChevronDown className="h-3 w-3 opacity-60" /></span>}
              items={buildReadingMenuItems(data, song, t, canEdit)}
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
                {
                  icon: <Languages className="h-3.5 w-3.5" />,
                  label: t('song.translationEdit'),
                  onClick: () => router.push(`/songs/${id}/translation/edit`),
                  disabled: !canEdit,
                },
                ...(song.lyrics_raw ? [{
                  icon: <Clock3 className="h-3.5 w-3.5" />,
                  label: t('song.timelineEdit'),
                  onClick: () => router.push(`/songs/${id}/timeline/edit`),
                  disabled: !canEdit,
                } as const] : []),
                {
                  icon: <RefreshCw className={`h-3.5 w-3.5 ${data.syncing ? 'animate-spin' : ''}`} />,
                  label: data.syncing ? t('song.syncing') : t('song.sync'),
                  onClick: () => setShowSyncConfirm(true),
                  disabled: data.syncing || !canEdit,
                },
                ...(data.debug ? [
                  {
                    icon: <Palette className="h-3.5 w-3.5" />,
                    label: t('song.recolorCover'),
                    onClick: () => {
                      clearCachedSongPalette(id);
                      setCoverRefresh((n) => n + 1);
                    },
                  },
                  {
                    icon: <SlidersHorizontal className="h-3.5 w-3.5" />,
                    label: t('song.dotParams'),
                    onClick: () => setShowDotParams((v) => !v),
                  },
                ] as const : []),
              ]}
            />

            <ToolbarMenu
              label={<span className="inline-flex items-center gap-1">{t('song.more')} <ChevronDown className="h-3 w-3 opacity-60" /></span>}
              items={[
                {
                  icon: <Bug className="h-3.5 w-3.5" />,
                  label: t('song.debug'),
                  status: t(data.debug ? 'common.on' : 'common.off'),
                  onClick: () => data.setDebug(!data.debug),
                },
                {
                  icon: <FlaskConical className="h-3.5 w-3.5" />,
                  label: t('song.experimentsTitle'),
                  onClick: () => setShowExperiments(true),
                },
                {
                  icon: <Download className="h-3.5 w-3.5" />,
                  label: t('song.downloadWithEllipsis'),
                  onClick: () => setShowDownloadDialog(true),
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
            {syncState === 'stopped' ? (
              <div className="flex items-center gap-1.5 sm:gap-2 rounded-full bg-[var(--warning-muted)] border border-[var(--warning)]/40 px-2 sm:px-3 py-1">
                <span className="inline-block h-2 w-2 rounded-full bg-[var(--warning)]" />
                <span className="text-xs text-[var(--warning)]">{t('song.syncStopped')}</span>
                <button onClick={() => void resumeSync()} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium bg-[var(--warning)]/20 text-[var(--warning)] hover:bg-[var(--warning)]/30 transition-colors shrink-0">
                  <RefreshCw className="h-3 w-3" /><span>{t('song.resumeSync')}</span>
                </button>
              </div>
            ) : syncState === 'retrying' ? (
              <div className="flex items-center gap-1.5 sm:gap-2 rounded-full bg-[var(--warning-muted)] border border-[var(--warning)]/30 px-2 sm:px-3 py-1">
                <Loader2 className="h-3 w-3 animate-spin text-[var(--warning)]" />
                <span className="text-xs text-[var(--warning)]">{t('song.syncRetrying')}</span>
              </div>
            ) : spotifyConnected === null || !spotify ? (
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
            <div className="text-[var(--song-accent)] font-medium mb-1.5">{t('song.debugInfo')}</div>
            <div>{t('song.debugConnection', {
              connection: spotify?.connected ? `✓ ${t('song.debugConnected')}` : `✗ ${t('song.debugDisconnected')}`,
              playing: String(!!spotify?.is_playing),
              same: String(isSameSong),
              synced: String(isSynced),
            })}</div>
            <div>{t('song.debugProgress')}: {spotify ? `${spotify.progress_ms}ms (${fmtTime(spotify.progress_ms)})` : '—'} / {spotify ? `${spotify.duration_ms}ms (${fmtTime(spotify.duration_ms)})` : '—'}</div>
            <div>{t('song.debugCounts', {
              sync: String(syncLines.length),
              furigana: String(furiganaLines.length),
              active: `#${activeLine} (${activeLine >= 0 && lineTimestamps[activeLine] != null ? fmtMs(lineTimestamps[activeLine]!) : '—'})`,
              syncActive: `#${debugSyncActive}`,
            })}</div>
            <div>{t('song.debugTrack', { track: spotify?.track?.name || '—', song: song.title })}</div>
            {syncLines.length > 0 && (
              <div className="pt-1.5 mt-1.5 border-t border-[var(--border)]">
                <div className="text-[var(--muted-foreground)] mb-1">{t('song.debugTimestamps', { count: String(syncLines.length) })}</div>
                <div className="max-h-40 overflow-y-auto space-y-0.5">
                  {syncLines.map((sl, i) => (
                    <div key={i} className={i === debugSyncActive ? 'text-[var(--success)] font-medium' : 'text-[var(--muted-foreground)]'}>[{fmtMs(sl.timeMs)}] {sl.text}</div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

      </div>
      {data.cantoneseSuggestion && (
        <div className="mb-3 flex shrink-0 flex-col gap-3 rounded-lg border border-[var(--song-accent)]/25 bg-[var(--accent)]/60 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-medium text-[var(--foreground)]">{t('song.cantoneseSuggestionTitle')}</p>
            <p className="mt-1 text-[11px] leading-relaxed text-[var(--muted-foreground)]">{t('song.cantoneseSuggestionDescription')}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => void data.setSongReadingScheme('yue-jyutping')}
              className="song-editor-primary-button rounded-md px-3 py-2 text-xs font-medium"
            >
              {t('song.useJyutping')}
            </button>
            <button
              type="button"
              onClick={() => void data.dismissCantoneseSuggestion()}
              className="rounded-md px-3 py-2 text-xs text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
            >
              {t('common.notNow')}
            </button>
          </div>
        </div>
      )}
      <div className="lyrics-panel-shell relative isolate flex-1 min-h-0" style={lyricPanelStyle}>
        <div className="lyrics-ambient-breath" aria-hidden="true" />
        <div className="lyrics-ambient-orbit" aria-hidden="true" />
        <div className="lyrics-ambient-orbit lyrics-ambient-orbit--secondary" aria-hidden="true" />
        <div className="lyrics-panel relative isolate h-full rounded-lg overflow-hidden">
          <LyricsDotGrid
            accent={coverColor
              ? `${coverColor.primary.r} ${coverColor.primary.g} ${coverColor.primary.b}`
              : undefined}
            params={dotParams}
            spectrumRef={spectrum.captureOn ? spectrum.spectrumRef : undefined}
          />
          <div ref={lyricsRef} className="relative z-10 p-4 sm:p-6 h-full sm:h-auto sm:max-h-[70vh] overflow-y-auto overflow-x-hidden" style={{ fontSize: `${data.fontSize}px` }}>
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
                    onCopyTranslation={() => copyLyricTranslation(i)}
                    onShareLine={() => router.push(`/songs/${id}/share?line=${i}`)}
                    onCorrectFurigana={() => router.push(`/songs/${id}/furigana/edit`)}
                    canCorrectFurigana={canEdit}
                    readingMode={data.readingMode}
                    romanizeFurigana={data.romanizeFurigana}
                    readingScheme={song.reading_scheme}
                    translation={data.showTranslation ? data.translations[i] ?? null : null}
                  />
                </div>
              ))
            ) : data.furiganaLoading ? (
              <div className="flex items-center gap-2 py-8 text-sm text-[var(--muted-foreground)]">
                <div className="h-4 w-4 border-2 border-[var(--muted-foreground)]/30 border-t-[var(--muted-foreground)] rounded-full animate-spin" />
                <span>{t('song.loadingFurigana')}</span>
              </div>
            ) : data.furiganaError ? (
              <div className="flex flex-col gap-4 py-8">
                <div className="flex items-center gap-2 text-sm text-[var(--warning)]">
                  <span>{data.furiganaError}</span>
                </div>
                <pre className="whitespace-pre-wrap font-sans leading-relaxed text-[var(--muted-foreground)]" style={{ fontSize: `${data.fontSize}px` }}>{song.lyrics_raw}</pre>
                {canEdit && (
                  <button
                    type="button"
                    onClick={data.retryFurigana}
                    disabled={data.furiganaLoading}
                    className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium song-accent-button self-start disabled:opacity-50"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${data.furiganaLoading ? 'animate-spin' : ''}`} />
                    {t('song.furiganaRetry')}
                  </button>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 py-10 text-center">
                <p className="text-sm text-[var(--muted-foreground)]">{t('song.noLyricsSimple')}</p>
                {canEdit ? (
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowSyncConfirm(true)}
                      disabled={data.syncing}
                      className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium song-editor-primary-button disabled:opacity-50"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${data.syncing ? 'animate-spin' : ''}`} />
                      {data.syncing ? t('song.syncing') : t('song.noLyricsSync')}
                    </button>
                    <button
                      type="button"
                      onClick={() => router.push(`/songs/${id}/edit`)}
                      className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium song-accent-button"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      {t('song.noLyricsEdit')}
                    </button>
                  </div>
                ) : (
                  <p className="text-xs text-[var(--muted-foreground)]/80">{t('song.noLyricsWaiting')}</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Compact metadata footer */}
      <div className={`shrink-0 mt-2 sm:mt-4 items-center justify-between gap-2 ${spotify?.connected ? 'hidden sm:flex' : 'flex'}`}>
        <button
          type="button"
          onClick={() => setShowSongInfo(true)}
          className="song-accent-button hidden h-8 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-medium sm:inline-flex"
          aria-haspopup="dialog"
        >
          <Info className="h-3.5 w-3.5" />
          {t('song.info')}
        </button>
        {!spotify?.connected && (
          <SpotifyLoginButton className="ml-auto text-[11px] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors disabled:opacity-60">{t('song.spotify')}</SpotifyLoginButton>
        )}
      </div>

      {/* Mobile bottom toolbar */}
      <MobileMenu
        data={data} sync={sync} song={song} id={id} router={router}
        furiganaLines={furiganaLines} pipSupported={pipSupported}
        onOpenPiP={handleOpenPiP} onShowSongInfo={() => setShowSongInfo(true)} onRecolorCover={() => {
          clearCachedSongPalette(id);
          setCoverRefresh((n) => n + 1);
        }} onToggleDotParams={() => setShowDotParams((v) => !v)} onOpenExperiments={() => setShowExperiments(true)} onOpenDownload={() => setShowDownloadDialog(true)} canEdit={canEdit}
      />

      {/* Download dialog — replaces the previous three export menu items. */}
      {showDownloadDialog && (
        <DownloadDialog
          songId={id}
          hasReadingData={furiganaLines.length > 0}
          hasTranslation={data.translations.length > 0}
          hasSynced={!isEmptyAfterTrim(data.song.lyrics_synced)}
          onClose={() => setShowDownloadDialog(false)}
        />
      )}

      {data.debug && showDotParams && (
        <LyricsDotParamsPanel
          params={dotParams}
          onChange={setDotParams}
          onClose={() => setShowDotParams(false)}
        />
      )}

      {showExperiments && (
        <ExperimentsPanel
          spectrumOn={spectrum.captureOn}
          spectrumError={spectrum.error}
          onToggleSpectrum={spectrum.toggle}
          onClose={closeExperiments}
        />
      )}

      {/* Translation status overlay — fixed at viewport level (not clipped by the lyrics panel): visible progress while translating, persistent error with dismiss + continue */}
      <TranslationStatusOverlay
        translating={data.translating}
        translationProgress={data.translationProgress}
        translationError={data.translationError}
        translationReasoning={data.translationReasoning}
        showTranslationReasoning={data.showTranslationReasoning}
        onToggleReasoning={data.toggleTranslationReasoning}
        onDismissError={data.dismissTranslationError}
        onCloseReasoning={() => data.setShowTranslationReasoning(false)}
        onCopyReasoning={() => void data.copyReasoning()}
        onClearReasoning={() => void data.clearReasoning()}
        onContinue={() => void data.handleTranslate()}
        onCancel={data.cancelTranslate}
      />
      {data.toast && <Toast type={data.toast.type} message={data.toast.msg} actionLabel={data.toast.actionLabel} onAction={data.toast.onAction} />}

      {showSongInfo && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onMouseDown={() => setShowSongInfo(false)}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="song-info-title"
            className="w-full max-w-md overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3 sm:px-5 sm:py-4">
              <span className="song-accent-surface inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full">
                <Info className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 id="song-info-title" className="truncate text-sm font-semibold sm:text-base">{t('song.info')}</h2>
                <p className="truncate text-xs text-[var(--muted-foreground)]">{song.title}{song.artist ? ` / ${song.artist}` : ''}</p>
              </div>
              <button
                type="button"
                autoFocus
                onClick={() => setShowSongInfo(false)}
                className="rounded-md p-2 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
                aria-label={t('common.close')}
                title={t('common.close')}
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="grid gap-2 p-4 text-xs sm:p-5">
              <div className="rounded-lg bg-[var(--accent)] px-3 py-2.5 text-[var(--muted-foreground)]">
                {t('common.created')}{new Date(song.created_at).toLocaleString(bcp47)}
              </div>
              <div className="rounded-lg bg-[var(--accent)] px-3 py-2.5 text-[var(--muted-foreground)]">
                {t('common.updated')}{new Date(song.updated_at).toLocaleString(bcp47)}
              </div>
              {hasSyncData && (
                <div className="rounded-lg bg-[var(--accent)] px-3 py-2.5 text-[var(--success)]">
                  {t('common.linesSynced', { count: String(syncLines.length) })}
                </div>
              )}
              <div className="rounded-lg bg-[var(--accent)] px-3 py-2.5 text-[var(--muted-foreground)]">
                {t('song.lyricsSource', { source: lyricsSourceLabel })}
              </div>
              <div className={`rounded-lg bg-[var(--accent)] px-3 py-2.5 ${(song.lyrics_confidence ?? 100) >= 90 ? 'text-[var(--success)]' : (song.lyrics_confidence ?? 100) >= 75 ? 'text-[var(--warning)]' : 'text-[var(--destructive)]'}`}>
                {t('song.lyricsConfidence', { confidence: String(song.lyrics_confidence ?? 100) })}
              </div>
              {song.spotify_track_id && (
                <div className="break-all rounded-lg bg-[var(--accent)] px-3 py-2.5 text-[var(--muted-foreground)]">
                  {t('song.spotifyTrackId', { id: song.spotify_track_id })}
                </div>
              )}
              {song.spotify_album && (
                <div className="rounded-lg bg-[var(--accent)] px-3 py-2.5 text-[var(--muted-foreground)]">
                  {t('song.spotifyAlbum', { album: song.spotify_album })}
                </div>
              )}
            </div>

            <footer className="flex justify-end border-t border-[var(--border)] px-4 py-3 sm:px-5">
              <button
                type="button"
                onClick={() => setShowSongInfo(false)}
                className="song-editor-primary-button rounded-md px-4 py-2 text-xs font-medium"
              >
                {t('common.close')}
              </button>
            </footer>
          </section>
        </div>
      )}

      <ConfirmDialog open={data.deleteConfirm} title={t('dialog.deleteConfirmTitle', { title: song?.title || '' })} body={t('dialog.deleteConfirmBody')} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')} variant="danger" onConfirm={data.confirmDelete} onCancel={() => data.setDeleteConfirm(false)} />
      <ConfirmDialog
        open={showSyncConfirm}
        title={t('song.syncConfirmTitle')}
        body={t('song.syncConfirmBody')}
        confirmLabel={t('song.sync')}
        cancelLabel={t('common.cancel')}
        onConfirm={() => {
          setShowSyncConfirm(false);
          void data.handleSync();
        }}
        onCancel={() => setShowSyncConfirm(false)}
      />
      <ConfirmDialog
        open={!!data.importAlert}
        title={t('dialog.importErrorTitle')}
        body={data.importAlert?.message}
        confirmLabel={data.importAlert?.manualCreateUrl ? t('home.createManually') : t('common.confirm')}
        cancelLabel={data.importAlert?.manualCreateUrl ? t('common.cancel') : undefined}
        alert={!data.importAlert?.manualCreateUrl}
        onConfirm={() => {
          const url = data.importAlert?.manualCreateUrl;
          data.setImportAlert(null);
          if (url) router.push(url);
        }}
        onCancel={() => data.setImportAlert(null)}
      />
      <ConfirmDialog
        open={!!data.lowConfidenceSync}
        title={t('song.syncLowConfidenceTitle')}
        body={t('song.syncLowConfidenceBody')}
        confirmLabel={t('song.syncLowConfidenceConfirm')}
        cancelLabel={t('common.cancel')}
        onConfirm={data.confirmLowConfidenceSync}
        onCancel={data.cancelLowConfidenceSync}
      />
      <ConfirmDialog
        open={!!data.plainHitSync}
        title={t('song.plainHitTitle')}
        body={t('song.plainHitBody', {
          source: data.plainHitSync
            ? (LYRICS_SOURCE_KEYS[data.plainHitSync.source]
              ? t(LYRICS_SOURCE_KEYS[data.plainHitSync.source])
              : data.plainHitSync.source)
            : '',
        })}
        confirmLabel={t('song.plainHitConfirm')}
        cancelLabel={t('common.cancel')}
        onConfirm={data.confirmPlainSync}
        onCancel={data.cancelPlainSync}
      />
    </div>
  );
}

