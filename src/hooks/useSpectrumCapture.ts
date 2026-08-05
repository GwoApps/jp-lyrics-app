'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface SpectrumCapture {
  /** Whether the mic capture loop is currently running. */
  captureOn: boolean;
  /** Permission / API error to surface in the experiments panel. */
  error: string | null;
  /**
   * Shared frequency buffer: the analyser writes byte frequency data into
   * it every frame; LyricsDotGrid reads it without any React re-render.
   */
  spectrumRef: React.MutableRefObject<Uint8Array<ArrayBuffer> | null>;
  toggle: () => void;
}

/**
 * Microphone spectrum capture for the lyrics dot grid.
 *
 * getUserMedia → Web Audio API AnalyserNode (fftSize 256 = 128 bins); a
 * requestAnimationFrame loop drains getByteFrequencyData into a shared
 * buffer. The mic is always released on unmount; callers decide when else
 * to stop (toggle off, panel close).
 */
export function useSpectrumCapture(): SpectrumCapture {
  const [captureOn, setCaptureOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const spectrumRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef(0);

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    void audioCtxRef.current?.close().catch(() => {});
    streamRef.current = null;
    audioCtxRef.current = null;
    analyserRef.current = null;
    spectrumRef.current = null;
  }, []);

  const start = useCallback(async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('no mediaDevices API (insecure context?)');
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new AudioContext();
      // Browsers start AudioContext suspended until a user gesture resumes it;
      // without this the analyser yields all-zero data and the grid stays dark.
      await ctx.resume().catch(() => {});
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      // 2048 → 1024 bins ≈ 23 Hz resolution at 48 kHz. With fftSize 256 the
      // whole bass region (50–250 Hz) fell into the leftmost 1–2 bins, so
      // the wave's peak was pinned to the left edge.
      analyser.fftSize = 2048;
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
          rafRef.current = requestAnimationFrame(loop);
        }
      };
      loop();
      setError(null);
      setCaptureOn(true);
    } catch (err) {
      stop();
      setError(err instanceof Error ? err.message : String(err));
      setCaptureOn(false);
    }
  }, [stop]);

  const toggle = useCallback(() => {
    if (captureOn) {
      stop();
      setCaptureOn(false);
    } else {
      void start();
    }
  }, [captureOn, start, stop]);

  // Always release the microphone when leaving the page.
  useEffect(() => () => stop(), [stop]);

  return { captureOn, error, spectrumRef, toggle };
}
