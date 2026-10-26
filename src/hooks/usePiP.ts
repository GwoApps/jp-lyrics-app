'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { FuriganaLine, ReadingMode, SongData } from '@/lib/types';
import { escapeHtml } from '@/lib/escape-html';
import { renderPipLyricsHtml } from '@/lib/pip-render';
import { normalizeFuriganaSegments, resolveFuriganaReading } from '@/lib/romaji';
import { normalizeReadingScheme } from '@/lib/lyrics-reading';
import { getPiPCapabilities } from '@/lib/pip-support';

interface UsePiPDeps {
  fontSize: number;
  readingMode: ReadingMode;
  romanizeFurigana: boolean;
  disableVideoPiP: boolean;
  song: SongData | null;
  furiganaLines: FuriganaLine[];
  lineTimestamps: (number | null)[];
  /**
   * Issue #331: per-line translations, index-aligned with `furiganaLines`.
   * The caller (detail page) already gates these on `song.showTranslation`
   * and on there being any translated line, so PiP needs no switch of its
   * own — it follows the same preference as the main lyric list.
   */
  translationLines?: string[];
  /** True when the song is only partially translated → show the placeholder. */
  showUntranslatedHint?: boolean;
  showToast: (type: 'success' | 'error' | 'info', msg: string, actionLabel?: string, onAction?: () => void) => void;
  t: (key: string, params?: Record<string, string>) => string;
}

/**
 * Everything the PiP window needs to render the lyric list. Kept in one object
 * so the initial build and the in-place `pip-lyrics-render` redraw always pass
 * the exact same inputs — a new render input only has to be added here.
 */
interface PipLyricsSource {
  furiganaLines: FuriganaLine[];
  song: SongData | null;
  timestamps?: (number | null)[];
  translations: (string | null)[];
  untranslatedHint?: string;
}

export function usePiP(deps: UsePiPDeps) {
  const {
    fontSize, readingMode, romanizeFurigana, disableVideoPiP, song, furiganaLines, lineTimestamps,
    translationLines, showUntranslatedHint, showToast, t,
  } = deps;

  // Keep a reference to the page-provided pipWindowRef so the useEffect below
  // can push live font-size / reading-mode updates into an already-open PiP
  // window (the callback receives it per call, but the effect needs it too).
  const pipWindowRefInternal = useRef<React.MutableRefObject<Window | null> | null>(null);
  const videoPipElements = useRef<{ canvas: HTMLCanvasElement; video: HTMLVideoElement; stream: MediaStream } | null>(null);
  const videoPipSource = useRef<PipLyricsSource | null>(null);
  const videoPipActiveLine = useRef(-1);
  const videoPipRenderConfig = useRef({ readingMode, romanizeFurigana });
  videoPipRenderConfig.current = { readingMode, romanizeFurigana };

  const drawVideoPiP = useCallback(() => {
    const elements = videoPipElements.current;
    const source = videoPipSource.current;
    if (!elements || !source) return;

    const { canvas } = elements;
    const context = canvas.getContext('2d');
    if (!context) return;

    const width = canvas.width;
    const height = canvas.height;
    const activeLine = videoPipActiveLine.current;
    const { readingMode: currentReadingMode, romanizeFurigana: currentRomanize } = videoPipRenderConfig.current;
    const scheme = normalizeReadingScheme(source.song?.reading_scheme);
    const lineText = (index: number) => {
      const line = source.furiganaLines[index];
      if (!line) return '';
      return normalizeFuriganaSegments(line.segments, scheme).map(segment => {
        if (currentReadingMode === 'original') return segment.text;
        return resolveFuriganaReading(segment.text, segment.reading, currentRomanize, scheme, segment) || segment.text;
      }).join('');
    };
    const fitText = (text: string, maxWidth: number, font: string) => {
      context.font = font;
      if (context.measureText(text).width <= maxWidth) return text;
      let shortened = text;
      while (shortened.length > 1 && context.measureText(`${shortened}…`).width > maxWidth) shortened = shortened.slice(0, -1);
      return `${shortened}…`;
    };
    const drawWrapped = (text: string, x: number, y: number, maxWidth: number, lineHeight: number, maxLines: number) => {
      context.font = '500 38px system-ui, -apple-system, sans-serif';
      const chars = Array.from(text || ' ');
      let row = '';
      let rows = 0;
      for (const char of chars) {
        const next = row + char;
        if (row && context.measureText(next).width > maxWidth) {
          context.fillText(row, x, y + rows * lineHeight, maxWidth);
          rows += 1;
          row = char;
          if (rows >= maxLines) break;
        } else {
          row = next;
        }
      }
      if (row && rows < maxLines) context.fillText(row, x, y + rows * lineHeight, maxWidth);
    };

    context.clearRect(0, 0, width, height);
    context.fillStyle = '#09090b';
    context.fillRect(0, 0, width, height);
    context.fillStyle = '#a1a1aa';
    context.font = '500 18px system-ui, -apple-system, sans-serif';
    const title = [source.song?.title, source.song?.artist].filter(Boolean).join(' · ');
    context.fillText(fitText(title, width - 64, context.font), 32, 46);
    context.fillStyle = '#3f3f46';
    context.fillRect(32, 66, width - 64, 1);

    const current = activeLine >= 0 ? activeLine : 0;
    context.fillStyle = '#ffffff';
    drawWrapped(lineText(current), 32, 145, width - 64, 48, 2);
    const translation = source.translations[current]?.trim();
    const hint = !translation && source.untranslatedHint ? source.untranslatedHint : '';
    if (translation || hint) {
      context.fillStyle = translation ? '#a1a1aa' : '#71717a';
      context.font = '400 24px system-ui, -apple-system, sans-serif';
      context.fillText(fitText(translation || hint, width - 64, context.font), 32, 250);
    }

    const next = current + 1;
    if (next < source.furiganaLines.length) {
      context.fillStyle = '#71717a';
      drawWrapped(lineText(next), 32, 315, width - 64, 38, 1);
    }
  }, []);

  // Keep a muted, real video stream ready so the PiP request can be made
  // directly from the user's click without waiting for media setup.
  useEffect(() => {
    const capabilities = getPiPCapabilities();
    if (disableVideoPiP || capabilities.document || !capabilities.video || !capabilities.canvasCapture) return;
    if (typeof document === 'undefined' || typeof HTMLCanvasElement === 'undefined'
      || typeof HTMLCanvasElement.prototype.captureStream !== 'function') return;

    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    let stream: MediaStream;
    try {
      stream = canvas.captureStream(2);
    } catch {
      return;
    }
    const video = document.createElement('video');
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.autoplay = true;
    video.setAttribute('aria-hidden', 'true');
    Object.assign(video.style, {
      position: 'fixed', width: '1px', height: '1px', opacity: '0',
      pointerEvents: 'none', left: '-2px', bottom: '0',
    });
    video.srcObject = stream;
    document.body.appendChild(video);
    videoPipElements.current = { canvas, video, stream };
    drawVideoPiP();
    void video.play().catch(() => { /* the click handler retries playback */ });

    return () => {
      if (document.pictureInPictureElement === video && document.exitPictureInPicture) {
        void document.exitPictureInPicture().catch(() => {});
      }
      stream.getTracks().forEach(track => track.stop());
      video.srcObject = null;
      video.remove();
      videoPipElements.current = null;
    };
  }, [drawVideoPiP, disableVideoPiP]);

  // The playback sync loop runs outside this hook. Forward active-line changes
  // so a video PiP canvas stays current even though it has no DOM to update.
  useEffect(() => {
    const onActiveLine = (event: Event) => {
      const detail = (event as CustomEvent<{ activeLine?: number }>).detail;
      if (typeof detail?.activeLine !== 'number') return;
      videoPipActiveLine.current = detail.activeLine;
      drawVideoPiP();
    };
    window.addEventListener('lyrics-pip-active-line', onActiveLine);
    return () => window.removeEventListener('lyrics-pip-active-line', onActiveLine);
  }, [drawVideoPiP]);

  useEffect(() => {
    const shownTranslations = translationLines?.length ? translationLines : undefined;
    videoPipSource.current = {
      furiganaLines,
      song,
      timestamps: lineTimestamps,
      translations: shownTranslations ?? [],
      untranslatedHint: shownTranslations && showUntranslatedHint ? t('song.untranslatedHint') : undefined,
    };
    drawVideoPiP();
  }, [furiganaLines, song, lineTimestamps, translationLines, showUntranslatedHint, t, drawVideoPiP]);

  useEffect(() => {
    drawVideoPiP();
  }, [readingMode, romanizeFurigana, drawVideoPiP]);

  // PiP is complex and needs external refs, so it's a callback the page calls with context
  const openPiP = useCallback(async (
    furiganaLinesArg: FuriganaLine[],
    songArg: SongData | null,
    highlightLine: number,
    pipWindowRef: React.MutableRefObject<Window | null>,
    timestamps?: (number | null)[],
    translations?: (string | null)[],
    showTranslationHint?: boolean,
  ) => {
    const existingVideoPiP = typeof document !== 'undefined' ? document.pictureInPictureElement : null;
    const localVideo = videoPipElements.current?.video as (HTMLVideoElement & { webkitPresentationMode?: string; webkitSetPresentationMode?: (mode: string) => void }) | undefined;
    const isVideoPiPActive = (typeof HTMLVideoElement !== 'undefined' && existingVideoPiP instanceof HTMLVideoElement)
      || localVideo?.webkitPresentationMode === 'picture-in-picture';
    if (isVideoPiPActive) {
      try {
        if (existingVideoPiP && document.exitPictureInPicture) await document.exitPictureInPicture();
        else localVideo?.webkitSetPresentationMode?.('inline');
      } catch { /* already closed by the browser */ }
      return;
    }

    if (pipWindowRef.current && !pipWindowRef.current.closed) {
      pipWindowRef.current.close();
      pipWindowRef.current = null;
      return;
    }

    if (furiganaLinesArg.length === 0) {
      showToast('error', t('song.noLyrics'));
      return;
    }

    // Issue #331: the PiP follows the page's "show translation" preference —
    // the caller has already applied it to `translations`, so a non-empty list
    // is the only switch. Keeping the source in one object means the initial
    // build and every later `pip-lyrics-render` redraw render identically.
    const shownTranslations = translations?.length ? translations : undefined;
    const pipSource: PipLyricsSource = {
      furiganaLines: furiganaLinesArg,
      song: songArg,
      timestamps,
      translations: shownTranslations ?? [],
      untranslatedHint: shownTranslations && showTranslationHint ? t('song.untranslatedHint') : undefined,
    };

    const pipWindowApi = (window as Window & {
      documentPictureInPicture?: { requestWindow?: (options: { width: number; height: number }) => Promise<Window> };
    }).documentPictureInPicture;

    if (typeof pipWindowApi?.requestWindow !== 'function') {
      if (disableVideoPiP) {
        showToast('error', t('song.pipUnsupported'));
        return;
      }
      const elements = videoPipElements.current;
      if (!elements) {
        showToast('error', t('song.pipUnsupported'));
        return;
      }

      videoPipSource.current = pipSource;
      videoPipActiveLine.current = highlightLine;
      drawVideoPiP();
      const { video } = elements;
      const legacyVideo = video as HTMLVideoElement & {
        webkitSupportsPresentationMode?: (mode: string) => boolean;
        webkitSetPresentationMode?: (mode: string) => void;
      };
      const canUseStandardPiP = document.pictureInPictureEnabled !== false
        && typeof video.requestPictureInPicture === 'function';
      const canUseWebKitPiP = typeof legacyVideo.webkitSupportsPresentationMode === 'function'
        && legacyVideo.webkitSupportsPresentationMode('picture-in-picture')
        && typeof legacyVideo.webkitSetPresentationMode === 'function';

      try {
        // Do not await play(): request PiP while this click's transient user
        // activation is still available.
        void video.play().catch(() => {});
        if (canUseStandardPiP) {
          await video.requestPictureInPicture();
        } else if (canUseWebKitPiP) {
          legacyVideo.webkitSetPresentationMode?.('picture-in-picture');
        } else {
          showToast('error', t('song.pipUnsupported'));
        }
      } catch (e) {
        console.error('Video PiP failed:', e);
        showToast('error', t('song.pipFailed'));
      }
      return;
    }

    try {
      const pipWindow = await pipWindowApi.requestWindow({
        width: 380,
        height: 520,
      });

      pipWindowRef.current = pipWindow;
      pipWindowRefInternal.current = pipWindowRef;

      const title = escapeHtml(songArg?.title || '');
      const artist = escapeHtml(songArg?.artist || '');

      // Lyric lines read their size from this CSS variable so the open window
      // can be resized live via a `pip-font-size` message without rebuilding.
      const pipFontSize = fontSize;

      pipWindow.document.documentElement.innerHTML = `
        <head>
          <meta name="color-scheme" content="dark">
          <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500&family=Noto+Sans+SC:wght@400;500&family=Noto+Sans+TC:wght@400;500&display=swap" rel="stylesheet">
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            html { --pip-font-size: ${pipFontSize}px; }
            html, body { background: #0a0a0a; color: #a3a3a3; font-family: 'Noto Sans JP', 'system-ui', system-ui, -apple-system, sans-serif; height: 100%; overflow: hidden; }
            #pip-header { padding: 8px 12px; border-bottom: 1px solid #262626; font-size: 11px; color: #737373; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            #pip-header .title { color: #e5e5e5; font-weight: 500; }
            #pip-lyrics { height: calc(100% - 36px); overflow-y: auto; padding: 12px; scroll-behavior: smooth; }
            .line { line-height: 2.2; padding: 2px 4px; border-radius: 4px; transition: color 0.3s, transform 0.3s, opacity 0.3s; transform-origin: left; opacity: 0.6; font-size: var(--pip-font-size); }
            .line.has-ts { cursor: pointer; }
            .line.has-ts:hover { color: #e5e5e5; opacity: 0.9; }
            @keyframes lyricActivate { 0% { transform: scale(1); filter: brightness(1); } 40% { transform: scale(1.06); filter: brightness(1.25); } 100% { transform: scale(1.03); filter: brightness(1); } }
            .line.active { color: #ffffff; transform: scale(1.03); opacity: 1; font-weight: 700; animation: lyricActivate 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) forwards; }
            .line.empty { height: 1.5em; }
            ruby rt { font-size: 0.5em; color: #a3a3a3; }
            ruby.korean-word rt { padding-inline: 0.16em; }
            ruby.cantonese-reading { ruby-overhang: none; white-space: nowrap; }
            ruby.cantonese-reading rt { padding-inline: 0.08em; }
            ruby.katakana-chunk { ruby-overhang: none; white-space: nowrap; }
            .line.active ruby rt { color: #d4d4d4; }
            /* Issue #331: translation typography mirrors the detail page
               (FuriganaLine): 0.72em, pulled into the source line's half-leading
               and padded back so line spacing stays uniform. */
            .line .translation { margin-top: -0.6em; padding-bottom: 0.6em; font-size: 0.72em; line-height: 1.6; color: #8a8a8a; }
            .line.untranslated-hint .translation, .line .translation.untranslated-hint { font-style: italic; color: #5c5c5c; }
            .line.active .translation { color: #a3a3a3; }
            /* Per-language fonts, same policy as globals.css: a Chinese
               translation must not be drawn with Japanese glyph shapes, and
               readings (romaji / jyutping) stay in the Latin stack. */
            [lang="ja"] { font-family: 'Noto Sans JP', 'system-ui', system-ui, -apple-system, sans-serif; }
            [lang^="zh"] { font-family: 'Noto Sans SC', 'Noto Sans JP', 'system-ui', system-ui, -apple-system, sans-serif; }
            [lang^="zh-TW"], [lang^="zh-HK"], [lang^="zh-Hant"], [lang="yue-Hant"] { font-family: 'Noto Sans TC', 'Noto Sans JP', 'system-ui', system-ui, -apple-system, sans-serif; }
            [lang="en"], [lang="yue-Latn"] { font-family: 'Inter', 'Noto Sans JP', 'system-ui', system-ui, -apple-system, sans-serif; }
          </style>
        </head>
        <body>
          <div id="pip-header"><span class="title">${title}</span>${artist ? ` — ${artist}` : ''}</div>
          <div id="pip-lyrics">
            ${renderPipLyricsHtml(pipSource.furiganaLines, pipSource.song?.reading_scheme, readingMode, romanizeFurigana, pipSource.timestamps, pipSource)}
          </div>
        </body>
      `;

      // Add click-to-seek handler in PiP
      if (timestamps?.some(t => t != null)) {
        const script = pipWindow.document.createElement('script');
        script.textContent = `
          document.getElementById('pip-lyrics').addEventListener('click', function(e) {
            var line = e.target.closest('.line.has-ts');
            if (!line) return;
            var ts = line.getAttribute('data-ts');
            if (ts && window.opener && !window.opener.closed) {
              window.opener.postMessage({ type: 'pip-seek', position_ms: parseInt(ts) }, '*');
            }
          });
        `;
        pipWindow.document.body.appendChild(script);

        // Listen for seek messages from PiP in main window.
        // fetch() only rejects on network errors, so inspect res.ok to surface
        // HTTP failures (401 token expiry / 4xx / 5xx) via the same toast path
        // as the main lyric page instead of silently dropping them.
        const onPipMessage = (e: MessageEvent) => {
          if (e.data?.type !== 'pip-seek' || typeof e.data.position_ms !== 'number') return;
          (async () => {
            let res: Response;
            try {
              res = await fetch('/api/spotify/seek', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ position_ms: e.data.position_ms }),
              });
            } catch {
              showToast('error', t('song.seekFailed'));
              return;
            }
            if (res.ok) return;
            if (res.status === 401) {
              showToast('error', t('song.seekAuthFailed'), t('song.reconnect'), () => {
                window.location.assign('/api/auth/login');
              });
              return;
            }
            showToast('error', t('song.seekFailed'));
          })();
        };
        window.addEventListener('message', onPipMessage);
        pipWindow.addEventListener('pagehide', () => {
          window.removeEventListener('message', onPipMessage);
          pipWindowRef.current = null;
        });
      } else {
        pipWindow.addEventListener('pagehide', () => {
          pipWindowRef.current = null;
        });
      }

      // Live-update handler: the main window pushes font-size and reading-mode
      // changes here while the PiP stays open, so the user no longer needs to
      // close/re-open the window to see them take effect.
      const pipUpdateScript = pipWindow.document.createElement('script');
      pipUpdateScript.textContent = `
        window.addEventListener('message', function(e) {
          var msg = e.data;
          if (!msg || typeof msg !== 'object') return;
          if (msg.type === 'pip-font-size' && typeof msg.fontSize === 'number') {
            document.documentElement.style.setProperty('--pip-font-size', msg.fontSize + 'px');
          } else if (msg.type === 'pip-lyrics-render' && typeof msg.html === 'string') {
            var container = document.getElementById('pip-lyrics');
            if (!container) return;
            var activeIndex = (typeof msg.activeLine === 'number') ? msg.activeLine : -1;
            container.innerHTML = msg.html;
            var lines = container.querySelectorAll('.line');
            lines.forEach(function(el, i) {
              if (i === activeIndex) {
                el.classList.add('active');
                el.scrollIntoView({ block: 'center' });
              }
            });
          }
        });
      `;
      pipWindow.document.body.appendChild(pipUpdateScript);

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
    } catch (e) {
      console.error('PiP failed:', e);
      showToast('error', t('song.pipFailed'));
    }
  }, [fontSize, readingMode, romanizeFurigana, disableVideoPiP, t, showToast, drawVideoPiP]);

  // Keep an already-open PiP window in sync with the main page.
  // Font size is applied live via the CSS variable (no rebuild needed).
  useEffect(() => {
    const pipWin = pipWindowRefInternal.current?.current;
    if (!pipWin || pipWin.closed) return;
    pipWin.postMessage({ type: 'pip-font-size', fontSize }, '*');
  }, [fontSize]);

  // Reading mode / romanize toggle, translation updates (issue #331) and lyric
  // data changes regenerate the PiP lyrics list in place instead of forcing a
  // close/re-open. Deliberately a whole-block redraw: a per-line diff would
  // cost more than it saves while a translation streams in.
  useEffect(() => {
    const pipWin = pipWindowRefInternal.current?.current;
    if (!pipWin || pipWin.closed) return;
    let activeLine = -1;
    try {
      const lines = Array.from(pipWin.document.querySelectorAll('#pip-lyrics .line'));
      const activeEl = pipWin.document.querySelector('#pip-lyrics .line.active');
      activeLine = activeEl ? lines.indexOf(activeEl) : -1;
    } catch { /* window gone */ }
    const shownTranslations = translationLines?.length ? translationLines : undefined;
    pipWin.postMessage({
      type: 'pip-lyrics-render',
      html: renderPipLyricsHtml(furiganaLines, song?.reading_scheme, readingMode, romanizeFurigana, lineTimestamps, {
        translations: shownTranslations,
        untranslatedHint: shownTranslations && showUntranslatedHint ? t('song.untranslatedHint') : undefined,
      }),
      activeLine,
    }, '*');
  }, [readingMode, romanizeFurigana, song, furiganaLines, lineTimestamps, translationLines, showUntranslatedHint, t]);


  return { openPiP };
}
