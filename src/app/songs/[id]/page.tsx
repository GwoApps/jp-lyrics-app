'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, useCallback, type ReactNode } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useTransitionRouter } from 'next-view-transitions';
import Link from 'next/link';
import { RefreshCw, Bug, Clock3, Pencil, Trash2, ArrowLeft, ArrowDown, Minus, Plus, Music, Download, Loader2, ExternalLink, PictureInPicture, Repeat, Copy, Check, MoreVertical, Languages, ChevronDown, Share2, Info, X, CircleAlert, Eraser, Palette, SlidersHorizontal, Brain, FlaskConical } from 'lucide-react';
import ConfirmDialog from '@/components/ConfirmDialog';
import CoverImage from '@/components/CoverImage';
import FuriganaLineView from '@/components/FuriganaLine';
import LyricsDotGrid, { DEFAULT_DOT_GRID_PARAMS, type DotGridParams } from '@/components/LyricsDotGrid';
import LyricsDotParamsPanel from '@/components/LyricsDotParamsPanel';
import ExperimentsPanel from '@/components/ExperimentsPanel';
import Toast from '@/components/Toast';
import SpotifyLoginButton from '@/components/SpotifyLoginButton';
import { useI18n } from '@/lib/i18n';
import { fmtMs, fmtTime, findActiveLine } from '@/lib/lrc';
import { isTitleMatch, findBestMatch } from '@/lib/match';
import { useSongData } from '@/hooks/useSongData';
import { useSpotifySync } from '@/hooks/useSpotifySync';
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
  const { t } = useI18n();
  const id = params?.id as string;
  const cachedSong = useMemo(() => getCachedSong(id), [id]);

  // Data + handlers hook
  const data = useSongData(id);
  const [showSyncConfirm, setShowSyncConfirm] = useState(false);
  const lyricsRef = useRef<HTMLDivElement>(null);
  const reasoningScrollRef = useRef<HTMLDivElement>(null);
  const [reasoningFollow, setReasoningFollow] = useState(true);

  // Reasoning panel auto-scroll: follow the latest chunk unless the user has
  // scrolled up (a "back to bottom" button appears in that case).
  const handleReasoningScroll = () => {
    const el = reasoningScrollRef.current;
    if (!el) return;
    setReasoningFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
  };
  const scrollReasoningToBottom = () => {
    const el = reasoningScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setReasoningFollow(true);
  };
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
  // Keep the reasoning panel pinned to the latest streamed chunk (only while
  // the user hasn't scrolled up to inspect earlier output).
  useEffect(() => {
    if (!reasoningFollow) return;
    const el = reasoningScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [data.translationReasoning, reasoningFollow]);

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
  const [showSongInfo, setShowSongInfo] = useState(false);
  const [coverRefresh, setCoverRefresh] = useState(0);
  const [showDotParams, setShowDotParams] = useState(false);
  const [showExperiments, setShowExperiments] = useState(false);
  const [spectrumCaptureOn, setSpectrumCaptureOn] = useState(false);
  const [spectrumError, setSpectrumError] = useState<string | null>(null);
  // Live mic spectrum: the analyser writes byte frequency data into this
  // shared array every frame; LyricsDotGrid reads it without any re-render.
  const spectrumRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const spectrumRafRef = useRef(0);

  const stopSpectrum = useCallback(() => {
    cancelAnimationFrame(spectrumRafRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    void audioCtxRef.current?.close().catch(() => {});
    streamRef.current = null;
    audioCtxRef.current = null;
    analyserRef.current = null;
    spectrumRef.current = null;
  }, []);

  const startSpectrum = useCallback(async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('no mediaDevices API (insecure context?)');
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256; // 128 frequency bins
      source.connect(analyser);
      streamRef.current = stream;
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;
      spectrumRef.current = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
      const loop = () => {
        const analyserNode = analyserRef.current;
        const buf = spectrumRef.current;
        if (analyserNode && buf) {
          analyserNode.getByteFrequencyData(buf);
          spectrumRafRef.current = requestAnimationFrame(loop);
        }
      };
      loop();
      setSpectrumError(null);
      setSpectrumCaptureOn(true);
    } catch (error) {
      stopSpectrum();
      setSpectrumError(error instanceof Error ? error.message : String(error));
      setSpectrumCaptureOn(false);
    }
  }, [stopSpectrum]);

  const toggleSpectrum = useCallback(() => {
    if (spectrumCaptureOn) {
      stopSpectrum();
      setSpectrumCaptureOn(false);
    } else {
      void startSpectrum();
    }
  }, [spectrumCaptureOn, startSpectrum, stopSpectrum]);

  // Always release the microphone when leaving the page.
  useEffect(() => () => stopSpectrum(), [stopSpectrum]);

  const closeExperiments = useCallback(() => {
    setShowExperiments(false);
    // Privacy default: stop capturing when the panel closes.
    if (spectrumCaptureOn) {
      stopSpectrum();
      setSpectrumCaptureOn(false);
    }
  }, [spectrumCaptureOn, stopSpectrum]);
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
                    icon: <Eraser className="h-3.5 w-3.5" />,
                    label: t('song.clearFurigana'),
                    onClick: () => void data.clearFurigana(),
                    disabled: !canEdit,
                  },
                  {
                    icon: <Eraser className="h-3.5 w-3.5" />,
                    label: t('song.clearTranslation'),
                    onClick: () => void data.clearTranslation(),
                    disabled: !canEdit,
                  },
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
            spectrumRef={spectrumCaptureOn ? spectrumRef : undefined}
          />
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
        }} onToggleDotParams={() => setShowDotParams((v) => !v)} onOpenExperiments={() => setShowExperiments(true)} canEdit={canEdit}
      />

      {data.debug && showDotParams && (
        <LyricsDotParamsPanel
          params={dotParams}
          onChange={setDotParams}
          onClose={() => setShowDotParams(false)}
        />
      )}

      {showExperiments && (
        <ExperimentsPanel
          spectrumOn={spectrumCaptureOn}
          spectrumError={spectrumError}
          onToggleSpectrum={toggleSpectrum}
          onClose={closeExperiments}
        />
      )}

      {/* Translation status overlay — fixed at viewport level (not clipped by the lyrics panel): visible progress while translating, persistent error with dismiss + continue */}
      {(data.translating || data.translationError || (data.translationProgress && data.translationProgress.done < data.translationProgress.total)) && (
        <div className="fixed left-1/2 top-3 z-[100] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-col items-center gap-2">
          {data.translating ? (
            <>
              <span className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-[var(--border)] bg-[var(--background)]/90 px-3 py-1.5 text-xs text-[var(--muted-foreground)] shadow-sm backdrop-blur-sm">
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--primary)]" />
                {data.translationProgress
                  ? t('song.translatingProgress', { done: data.translationProgress.done, total: data.translationProgress.total })
                  : t('song.translating')}
              </span>
              {data.translationReasoning && (
                <button
                  type="button"
                  onClick={() => data.setShowTranslationReasoning(!data.showTranslationReasoning)}
                  className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-[var(--border)] bg-[var(--background)]/90 px-2.5 py-1 text-[11px] font-medium text-[var(--primary)] shadow-sm backdrop-blur-sm hover:bg-[var(--primary)]/10"
                >
                  <Brain className="h-3 w-3" />
                  {data.showTranslationReasoning ? t('song.translationReasoningHide') : t('song.translationReasoningShow')}
                </button>
              )}
              {data.showTranslationReasoning && data.translationReasoning && (
                <div className="reasoning-glow w-[min(94vw,560px)] overflow-hidden rounded-xl">
                  <div className="relative rounded-[11px] bg-[var(--card)]/95 backdrop-blur-sm">
                    <div className="flex items-center gap-1.5 border-b border-[var(--border)]/60 px-3 py-2 text-[11px] font-medium text-[var(--muted-foreground)]">
                      <Brain className="h-3 w-3 text-[var(--primary)]" />
                      {t('song.translationReasoning')}
                    </div>
                    <div
                      ref={reasoningScrollRef}
                      onScroll={handleReasoningScroll}
                      className="max-h-[45vh] overflow-y-auto whitespace-pre-wrap break-words p-3 pr-8 font-mono text-[11px] leading-relaxed text-[var(--muted-foreground)]"
                    >
                      {data.translationReasoning}
                      {data.translating && <span className="reasoning-cursor" />}
                    </div>
                    {!reasoningFollow && (
                      <button
                        type="button"
                        onClick={scrollReasoningToBottom}
                        className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--background)]/95 px-2 py-1 text-[10px] font-medium text-[var(--primary)] shadow-sm backdrop-blur-sm hover:bg-[var(--primary)]/10"
                      >
                        <ArrowDown className="h-3 w-3" />
                        {t('song.translationReasoningBottom')}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-full border border-[var(--warning)]/40 bg-[var(--background)]/90 px-3 py-1.5 text-xs text-[var(--warning)] shadow-sm backdrop-blur-sm">
              <CircleAlert className="h-3.5 w-3.5 shrink-0" />
              <span className="max-w-[200px] sm:max-w-[320px] truncate">
                {data.translationError
                  ?? (data.translationProgress
                    ? t('song.translatingProgress', { done: data.translationProgress.done, total: data.translationProgress.total })
                    : '')}
              </span>
              {data.translationProgress && data.translationProgress.done < data.translationProgress.total && (
                <button
                  type="button"
                  onClick={() => void data.handleTranslate()}
                  className="rounded-full border border-[var(--warning)]/40 px-2 py-0.5 font-medium text-[var(--warning)] hover:bg-[var(--warning)]/10"
                >
                  {t('song.translationContinue')}
                </button>
              )}
              <button
                type="button"
                onClick={data.dismissTranslationError}
                aria-label={t('common.close')}
                className="rounded-full p-0.5 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          )}
        </div>
      )}
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
                {t('common.created')}{new Date(song.created_at).toLocaleString('ja-JP')}
              </div>
              <div className="rounded-lg bg-[var(--accent)] px-3 py-2.5 text-[var(--muted-foreground)]">
                {t('common.updated')}{new Date(song.updated_at).toLocaleString('ja-JP')}
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
    </div>
  );
}

type ToolbarMenuItem = {
  icon?: ReactNode;
  label: ReactNode;
  status?: ReactNode;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  href?: string;
  /** Keep the menu open after clicking this item (for toggles / mode switching). */
  keepOpen?: boolean;
};

/** Shared Languages-menu items for the desktop toolbar and the mobile popover. */
function buildReadingMenuItems(
  data: ReturnType<typeof useSongData>,
  song: NonNullable<ReturnType<typeof useSongData>['song']>,
  t: ReturnType<typeof useI18n>['t'],
  canEdit: boolean,
): ToolbarMenuItem[] {
  return [
    ...([
      ['original', 'song.readingOriginal'],
      ['furigana', song.reading_scheme === 'yue-jyutping' ? 'song.readingJyutping' : 'song.readingFurigana'],
    ] as const).map(([mode, label]) => ({
      icon: <Languages className="h-3.5 w-3.5" />,
      label: t(label),
      active: data.readingMode === mode,
      onClick: () => data.setReadingMode(mode),
      keepOpen: true,
    })),
    ...(song.reading_scheme === 'yue-jyutping' ? [] : [{
      icon: <Languages className="h-3.5 w-3.5" />,
      label: t('song.romanizeFurigana'),
      status: t(data.romanizeFurigana ? 'common.on' : 'common.off'),
      onClick: () => data.setRomanizeFurigana(!data.romanizeFurigana),
      keepOpen: true,
    }]),
    {
      icon: data.translating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Languages className="h-3.5 w-3.5" />,
      label: t('song.translation'),
      status: data.translating ? t('song.translating') : t(data.showTranslation ? 'common.on' : 'common.off'),
      onClick: () => {
        if (data.translations.length > 0) data.setShowTranslation(!data.showTranslation);
        else void data.handleTranslate();
      },
      disabled: data.translating || (!canEdit && data.translations.length === 0),
      keepOpen: true,
    },
  ];
}

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

function ToolbarMenu({ label, items, triggerClassName }: { label: ReactNode; items: ToolbarMenuItem[]; triggerClassName?: string }) {
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
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={triggerClassName ?? `${btnTextCls(open)} song-menu-trigger`}
        data-open={open}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {label}
      </button>
      <div
        role="menu"
        aria-hidden={!open}
        data-open={open}
        className="song-menu-popover song-menu-popover--desktop absolute right-0 top-full z-50 mt-1 min-w-[160px] rounded-lg border border-[var(--border)] bg-[var(--card)] py-1 shadow-lg"
      >
        {items.map((item, i) => {
          const base = "song-menu-item w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left disabled:opacity-50";
          const cls = item.danger
            ? `${base} text-[var(--destructive)] hover:bg-[var(--destructive)]/10`
            : item.active
              ? `${base} text-[var(--song-accent)] bg-[var(--song-accent)]/10`
              : `${base} text-[var(--foreground)] hover:bg-[var(--accent)]`;
          if (item.href) {
            return (
              <a key={i} role="menuitem" data-menu-item href={item.href} onClick={() => setOpen(false)} className={cls}>
                {item.icon}
                <span className="min-w-0 flex-1">{item.label}</span>
                {item.status && <span className="ml-auto text-[10px] text-[var(--muted-foreground)]">{item.status}</span>}
              </a>
            );
          }
          return (
            <button
              type="button"
              role="menuitem"
              data-menu-item
              key={i}
              onClick={() => { item.onClick?.(); if (!item.keepOpen) setOpen(false); }}
              disabled={item.disabled}
              className={cls}
            >
              {item.icon}
              <span className="min-w-0 flex-1">{item.label}</span>
              {item.status && <span className="ml-auto text-[10px] text-[var(--muted-foreground)]">{item.status}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Mobile bottom toolbar — A-/A+, Sync, Copy visible; rest in 3-dot menu */
function MobileMenu({ data, sync, song, id, router, furiganaLines, pipSupported, onOpenPiP, onShowSongInfo, onRecolorCover, onToggleDotParams, onOpenExperiments, canEdit }: {
  data: ReturnType<typeof useSongData>;
  sync: ReturnType<typeof useSpotifySync>;
  song: NonNullable<ReturnType<typeof useSongData>['song']>;
  id: string;
  router: ReturnType<typeof useRouter>;
  furiganaLines: ReturnType<typeof useSongData>['furiganaLines'];
  pipSupported: boolean;
  onOpenPiP: () => void;
  onShowSongInfo: () => void;
  onOpenExperiments: () => void;
  onRecolorCover: () => void;
  onToggleDotParams: () => void;
  canEdit: boolean;
}) {
  const { t } = useI18n();
  const [showCopyMenu, setShowCopyMenu] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showLangMenu, setShowLangMenu] = useState(false);
  const [showDownloadMenu, setShowDownloadMenu] = useState(false);
  const [showEditMenu, setShowEditMenu] = useState(false);
  const [showSyncConfirm, setShowSyncConfirm] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const langMenuRef = useRef<HTMLDivElement>(null);
  const copyMenuRef = useRef<HTMLDivElement>(null);

  // Close menus on outside tap
  useEffect(() => {
    if (!showMenu && !showLangMenu && !showCopyMenu) return;
    const handler = (e: TouchEvent | MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
      if (langMenuRef.current && !langMenuRef.current.contains(e.target as Node)) {
        setShowLangMenu(false);
      }
      if (copyMenuRef.current && !copyMenuRef.current.contains(e.target as Node)) {
        setShowCopyMenu(false);
      }
    };
    document.addEventListener('touchstart', handler);
    document.addEventListener('mousedown', handler);
    return () => { document.removeEventListener('touchstart', handler); document.removeEventListener('mousedown', handler); };
  }, [showMenu, showLangMenu, showCopyMenu]);

  const menuItems: ToolbarMenuItem[] = [
    { icon: <Info className="h-4 w-4" />, label: t('song.info'), onClick: onShowSongInfo },
    ...(pipSupported && furiganaLines.length > 0 ? [{ icon: <PictureInPicture className="h-4 w-4" />, label: t('song.pipBtn'), onClick: onOpenPiP }] : []),
    { icon: <Bug className="h-4 w-4" />, label: t('song.debug'), status: t(data.debug ? 'common.on' : 'common.off'), onClick: () => data.setDebug(!data.debug), keepOpen: true },
    { icon: <FlaskConical className="h-4 w-4" />, label: t('song.experimentsTitle'), onClick: () => onOpenExperiments() },
    { icon: <Download className="h-4 w-4" />, label: t('song.download'), status: <ChevronDown className="h-3.5 w-3.5 -rotate-90" />, onClick: () => { setShowEditMenu(false); setShowDownloadMenu(true); }, keepOpen: true },
    ...(canEdit ? [{
      icon: <Pencil className="h-4 w-4" />,
      label: t('common.edit'),
      status: <ChevronDown className="h-3.5 w-3.5 -rotate-90" />,
      onClick: () => { setShowDownloadMenu(false); setShowEditMenu(true); },
      keepOpen: true,
    }] : []),
  ];

  const downloadItems = [
    { label: '.txt', format: 'text' },
    { label: '.lrc', format: 'lrc' },
    { label: `.html ${t('song.exportFurigana')}`, format: 'html' },
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

        {/* Copy — original / translation */}
        <div className="relative" ref={copyMenuRef}>
          <MobileIconButton
            label={data.copied ? t('share.copied') : t('song.copy')}
            onClick={() => {
              setShowMenu(false);
              setShowLangMenu(false);
              setShowCopyMenu((v) => !v);
            }}
            className={`${data.copied ? 'text-[var(--success)]' : ''} ${showCopyMenu ? 'song-mobile-button--active' : ''}`}
            data-open={showCopyMenu}
            aria-haspopup="menu"
            aria-expanded={showCopyMenu}
          >
            {data.copied ? <Check className="h-5 w-5" /> : <Copy className="h-5 w-5" />}
          </MobileIconButton>
          <div
            role="menu"
            aria-hidden={!showCopyMenu}
            data-open={showCopyMenu}
            className="song-menu-popover song-menu-popover--mobile absolute right-0 bottom-full z-50 mb-2 min-w-[200px] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] py-1.5 shadow-xl"
          >
            <button
              type="button"
              role="menuitem"
              data-menu-item
              onClick={() => {
                setShowCopyMenu(false);
                void data.handleCopy('original');
              }}
              className="song-menu-item flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-[var(--foreground)] hover:bg-[var(--accent)]"
            >
              <Copy className="h-4 w-4" />
              <span>{t('song.copyOriginal')}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              data-menu-item
              onClick={() => {
                setShowCopyMenu(false);
                void data.handleCopy('translation');
              }}
              disabled={data.translations.length === 0}
              className="song-menu-item flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-[var(--foreground)] hover:bg-[var(--accent)] disabled:opacity-50"
            >
              <Languages className="h-4 w-4" />
              <span>{t('song.copyTranslation')}</span>
            </button>
          </div>
        </div>

        {/* Original / Furigana — expands a menu like the desktop Languages menu */}
        <div className="relative" ref={langMenuRef}>
          <MobileIconButton
            label={t(data.readingMode === 'original' ? 'song.readingOriginal' : 'song.readingFurigana')}
            onClick={() => {
              setShowMenu(false);
              setShowCopyMenu(false);
              setShowLangMenu((v) => !v);
            }}
            className={`${data.readingMode !== 'furigana' ? 'song-mobile-button--active' : ''} ${showLangMenu ? 'song-mobile-button--active' : ''}`}
            data-open={showLangMenu}
            aria-haspopup="menu"
            aria-expanded={showLangMenu}
          >
            <Languages className="h-5 w-5" />
          </MobileIconButton>
          <div
            role="menu"
            aria-hidden={!showLangMenu}
            data-open={showLangMenu}
            className="song-menu-popover song-menu-popover--mobile absolute right-0 bottom-full z-50 mb-2 min-w-[200px] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] py-1.5 shadow-xl"
          >
            {buildReadingMenuItems(data, song, t, canEdit).map((item, i) => {
              const base = "song-menu-item flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm";
              const cls = item.active
                ? `${base} text-[var(--song-accent)] bg-[var(--song-accent)]/10`
                : `${base} text-[var(--foreground)] hover:bg-[var(--accent)]`;
              return (
                <button
                  type="button"
                  role="menuitem"
                  data-menu-item
                  key={i}
                  onClick={() => {
                    item.onClick?.();
                    if (!item.keepOpen) setShowLangMenu(false);
                  }}
                  disabled={item.disabled}
                  className={`${cls} disabled:opacity-50`}
                >
                  {item.icon}
                  <span className="min-w-0 flex-1">{item.label}</span>
                  {item.status && <span className="ml-auto text-[11px] text-[var(--muted-foreground)]">{item.status}</span>}
                </button>
              );
            })}
          </div>
        </div>

        {/* Share */}
        <MobileIconButton
          label={t('song.share')}
          onClick={() => router.push(sync.activeLine >= 0 ? `/songs/${id}/share?line=${sync.activeLine}` : `/songs/${id}/share`)}
        >
          <Share2 className="h-5 w-5" />
        </MobileIconButton>

        {/* 3-dot menu */}
        <div className="relative" ref={menuRef}>
          <MobileIconButton
            label={t('song.more')}
            onClick={() => {
              if (showMenu) {
                setShowMenu(false);
              } else {
                setShowDownloadMenu(false);
                setShowEditMenu(false);
                setShowLangMenu(false);
                setShowCopyMenu(false);
                setShowMenu(true);
              }
            }}
            className={`song-mobile-menu-trigger ${showMenu ? 'song-mobile-button--active' : ''}`}
            data-open={showMenu}
            aria-haspopup="menu"
            aria-expanded={showMenu}
          >
            <MoreVertical className="h-5 w-5" />
          </MobileIconButton>
          <div
            role="menu"
            aria-hidden={!showMenu}
            data-open={showMenu}
            className="song-menu-popover song-menu-popover--mobile absolute right-0 bottom-full z-50 mb-2 min-w-[200px] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] py-1.5 shadow-xl"
          >
            {showDownloadMenu ? (
              <div key="download" className="song-menu-page song-menu-page--forward">
                <button
                  type="button"
                  role="menuitem"
                  data-menu-item
                  onClick={() => setShowDownloadMenu(false)}
                  className="song-menu-item flex w-full items-center gap-3 border-b border-[var(--border)] px-4 py-2.5 text-left text-sm font-medium text-[var(--foreground)] hover:bg-[var(--accent)]"
                >
                  <ArrowLeft className="h-4 w-4" />
                  <span>{t('song.download')}</span>
                </button>
                {downloadItems.map((item) => (
                  <button
                    type="button"
                    role="menuitem"
                    data-menu-item
                    key={item.format}
                    onClick={() => {
                      setShowMenu(false);
                      window.location.href = `/api/songs/${id}/export?format=${item.format}`;
                    }}
                    className="song-menu-item flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-[var(--foreground)] hover:bg-[var(--accent)]"
                  >
                    <Download className="h-4 w-4" />
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            ) : showEditMenu ? (
              <div key="edit" className="song-menu-page song-menu-page--forward">
                <button
                  type="button"
                  role="menuitem"
                  data-menu-item
                  onClick={() => setShowEditMenu(false)}
                  className="song-menu-item flex w-full items-center gap-3 border-b border-[var(--border)] px-4 py-2.5 text-left text-sm font-medium text-[var(--foreground)] hover:bg-[var(--accent)]"
                >
                  <ArrowLeft className="h-4 w-4" />
                  <span>{t('common.edit')}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  data-menu-item
                  onClick={() => router.push(`/songs/${id}/edit`)}
                  className="song-menu-item flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-[var(--foreground)] hover:bg-[var(--accent)]"
                >
                  <Pencil className="h-4 w-4" />
                  <span>{t('common.edit')}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  data-menu-item
                  onClick={() => router.push(`/songs/${id}/furigana/edit`)}
                  className="song-menu-item flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-[var(--foreground)] hover:bg-[var(--accent)]"
                >
                  <Languages className="h-4 w-4" />
                  <span>{t('furigana.title')}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  data-menu-item
                  onClick={() => router.push(`/songs/${id}/translation/edit`)}
                  className="song-menu-item flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-[var(--foreground)] hover:bg-[var(--accent)]"
                >
                  <Languages className="h-4 w-4" />
                  <span>{t('song.translationEdit')}</span>
                </button>
                {song.lyrics_raw && (
                  <button
                    type="button"
                    role="menuitem"
                    data-menu-item
                    onClick={() => router.push(`/songs/${id}/timeline/edit`)}
                    className="song-menu-item flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-[var(--foreground)] hover:bg-[var(--accent)]"
                  >
                    <Clock3 className="h-4 w-4" />
                    <span>{t('song.timelineEdit')}</span>
                  </button>
                )}
                <button
                  type="button"
                  role="menuitem"
                  data-menu-item
                  onClick={() => {
                    setShowEditMenu(false);
                    setShowSyncConfirm(true);
                  }}
                  disabled={data.syncing}
                  className="song-menu-item flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-[var(--foreground)] hover:bg-[var(--accent)] disabled:opacity-50"
                >
                  <RefreshCw className={`h-4 w-4 ${data.syncing ? 'animate-spin' : ''}`} />
                  <span>{data.syncing ? t('song.syncing') : t('song.sync')}</span>
                </button>
                {data.debug && (
                  <>
                    <button
                      type="button"
                      role="menuitem"
                      data-menu-item
                      onClick={() => {
                        setShowEditMenu(false);
                        void data.clearFurigana();
                      }}
                      disabled={!canEdit}
                      className="song-menu-item flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-[var(--foreground)] hover:bg-[var(--accent)] disabled:opacity-50"
                    >
                      <Eraser className="h-4 w-4" />
                      <span>{t('song.clearFurigana')}</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      data-menu-item
                      onClick={() => {
                        setShowEditMenu(false);
                        void data.clearTranslation();
                      }}
                      disabled={!canEdit}
                      className="song-menu-item flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-[var(--foreground)] hover:bg-[var(--accent)] disabled:opacity-50"
                    >
                      <Eraser className="h-4 w-4" />
                      <span>{t('song.clearTranslation')}</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      data-menu-item
                      onClick={() => {
                        setShowEditMenu(false);
                        onRecolorCover();
                      }}
                      className="song-menu-item flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-[var(--foreground)] hover:bg-[var(--accent)]"
                    >
                      <Palette className="h-4 w-4" />
                      <span>{t('song.recolorCover')}</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      data-menu-item
                      onClick={() => {
                        setShowEditMenu(false);
                        onToggleDotParams();
                      }}
                      className="song-menu-item flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-[var(--foreground)] hover:bg-[var(--accent)]"
                    >
                      <SlidersHorizontal className="h-4 w-4" />
                      <span>{t('song.dotParams')}</span>
                    </button>
                  </>
                )}
                <button
                  type="button"
                  role="menuitem"
                  data-menu-item
                  onClick={() => {
                    setShowMenu(false);
                    data.handleDelete();
                  }}
                  className="song-menu-item flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-[var(--destructive)] hover:bg-[var(--destructive)]/10"
                >
                  <Trash2 className="h-4 w-4" />
                  <span>{t('common.delete')}</span>
                </button>
              </div>
            ) : (
              <div key="main" className="song-menu-page song-menu-page--back">
                {menuItems.map((item, i) => (
                  <button
                    type="button"
                    role="menuitem"
                    data-menu-item
                    key={i}
                    onClick={() => {
                      item.onClick?.();
                      if (!('keepOpen' in item && item.keepOpen)) {
                        setShowMenu(false);
                      }
                    }}
                    disabled={'disabled' in item ? item.disabled : false}
                    className={`song-menu-item flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm disabled:opacity-50 ${
                      'danger' in item && item.danger
                        ? 'text-[var(--destructive)] hover:bg-[var(--destructive)]/10'
                        : 'text-[var(--foreground)] hover:bg-[var(--accent)]'
                    }`}
                  >
                    {item.icon}
                    <span className="min-w-0 flex-1">{item.label}</span>
                    {'status' in item && item.status && (
                      <span className="ml-auto text-[11px] text-[var(--muted-foreground)]">{item.status}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

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
    </div>
  );
}
