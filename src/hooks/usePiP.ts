'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { FuriganaLine, ReadingMode, SongData } from '@/lib/types';
import { escapeHtml } from '@/lib/escape-html';
import { renderPipLyricsHtml } from '@/lib/pip-render';

interface UsePiPDeps {
  fontSize: number;
  readingMode: ReadingMode;
  romanizeFurigana: boolean;
  song: SongData | null;
  furiganaLines: FuriganaLine[];
  lineTimestamps: (number | null)[];
  showToast: (type: 'success' | 'error' | 'info', msg: string, actionLabel?: string, onAction?: () => void) => void;
  t: (key: string, params?: Record<string, string>) => string;
}

export function usePiP(deps: UsePiPDeps) {
  const {
    fontSize, readingMode, romanizeFurigana, song, furiganaLines, lineTimestamps, showToast, t,
  } = deps;

  // Keep a reference to the page-provided pipWindowRef so the useEffect below
  // can push live font-size / reading-mode updates into an already-open PiP
  // window (the callback receives it per call, but the effect needs it too).
  const pipWindowRefInternal = useRef<React.MutableRefObject<Window | null> | null>(null);

  // PiP is complex and needs external refs, so it's a callback the page calls with context
  const openPiP = useCallback(async (
    furiganaLinesArg: FuriganaLine[],
    songArg: SongData | null,
    highlightLine: number,
    pipWindowRef: React.MutableRefObject<Window | null>,
    timestamps?: (number | null)[],
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
      pipWindowRefInternal.current = pipWindowRef;

      const title = escapeHtml(songArg?.title || '');
      const artist = escapeHtml(songArg?.artist || '');

      // Lyric lines read their size from this CSS variable so the open window
      // can be resized live via a `pip-font-size` message without rebuilding.
      const pipFontSize = fontSize;

      pipWindow.document.documentElement.innerHTML = `
        <head>
          <meta name="color-scheme" content="dark">
          <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500&display=swap" rel="stylesheet">
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
          </style>
        </head>
        <body>
          <div id="pip-header"><span class="title">${title}</span>${artist ? ` — ${artist}` : ''}</div>
          <div id="pip-lyrics">
            ${renderPipLyricsHtml(furiganaLinesArg, songArg?.reading_scheme, readingMode, romanizeFurigana, timestamps)}
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
  }, [fontSize, readingMode, romanizeFurigana, t, showToast]);

  // Keep an already-open PiP window in sync with the main page.
  // Font size is applied live via the CSS variable (no rebuild needed).
  useEffect(() => {
    const pipWin = pipWindowRefInternal.current?.current;
    if (!pipWin || pipWin.closed) return;
    pipWin.postMessage({ type: 'pip-font-size', fontSize }, '*');
  }, [fontSize]);

  // Reading mode / romanize toggle (and lyric data changes) regenerate the
  // PiP lyrics list in place instead of forcing a close/re-open.
  useEffect(() => {
    const pipWin = pipWindowRefInternal.current?.current;
    if (!pipWin || pipWin.closed) return;
    let activeLine = -1;
    try {
      const lines = Array.from(pipWin.document.querySelectorAll('#pip-lyrics .line'));
      const activeEl = pipWin.document.querySelector('#pip-lyrics .line.active');
      activeLine = activeEl ? lines.indexOf(activeEl) : -1;
    } catch { /* window gone */ }
    pipWin.postMessage({
      type: 'pip-lyrics-render',
      html: renderPipLyricsHtml(furiganaLines, song?.reading_scheme, readingMode, romanizeFurigana, lineTimestamps),
      activeLine,
    }, '*');
  }, [readingMode, romanizeFurigana, song, furiganaLines, lineTimestamps]);


  return { openPiP };
}
