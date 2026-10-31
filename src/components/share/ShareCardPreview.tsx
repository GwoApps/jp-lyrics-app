'use client';

import { useEffectEvent, useLayoutEffect, useRef, type RefObject } from 'react';
import { Loader2 } from 'lucide-react';
import { createSharePreviewRenderer } from '@/lib/share-preview-renderer';
import { createSharePreviewPresentation } from '@/lib/share-preview-presentation';
import './share-card-preview.css';

export interface ShareCardPreviewProps {
  /** The latest completed full-resolution frame, never a work-in-progress. */
  canvasRef: RefObject<HTMLCanvasElement | null>;
  /** Memoize this callback; its identity invalidates the previous request. */
  draw: (canvas: HTMLCanvasElement) => Promise<void>;
  enabled: boolean;
  onReadyChange: (ready: boolean) => void;
}

export default function ShareCardPreview({
  canvasRef,
  draw,
  enabled,
  onReadyChange,
}: ShareCardPreviewProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const layersRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<ReturnType<typeof createSharePreviewRenderer<HTMLCanvasElement>> | null>(null);
  const notifyReady = useEffectEvent((ready: boolean) => onReadyChange(ready));

  useLayoutEffect(() => {
    const root = rootRef.current;
    const layers = layersRef.current;
    if (!root || !layers) return;
    const presentation = createSharePreviewPresentation(root, layers);
    let latest: HTMLCanvasElement | null = null;
    delete root.dataset.hasFrame;
    root.style.removeProperty('aspect-ratio');
    canvasRef.current = null;

    const renderer = createSharePreviewRenderer<HTMLCanvasElement>({
      createFrame() {
        const canvas = document.createElement('canvas');
        canvas.width = 1200;
        canvas.height = 630;
        // drawCard silently returns without drawing if there is no 2D context.
        if (!canvas.getContext('2d')) throw new Error('Canvas 2D context unavailable');
        return canvas;
      },
      commit(frame) {
        if (!frame.width || !frame.height) throw new Error('Empty preview frame');
        presentation.present(frame);
        canvasRef.current = latest = frame;
        root.dataset.hasFrame = 'true';
      },
      onStatus(status) {
        root.dataset.status = status;
        root.setAttribute('aria-busy', String(status === 'drawing'));
        notifyReady(status === 'ready');
      },
      release(frame) {
        // Never clear an active asynchronous draw; release it only on settle.
        frame.width = frame.height = 0;
      },
    });
    rendererRef.current = renderer;
    return () => {
      rendererRef.current = null;
      renderer.dispose();
      presentation.dispose();
      if (canvasRef.current === latest) canvasRef.current = null;
    };
  }, [canvasRef]);

  // Layout effects revoke download readiness before the changed options paint.
  // The callback notification is an Effect Event, so inline readiness handlers
  // do not restart a render or cause parent/child update loops.
  useLayoutEffect(() => {
    rendererRef.current?.request(enabled ? draw : null);
  }, [canvasRef, draw, enabled]);

  return (
    <div ref={rootRef} className="share-card-preview" aria-busy="true">
      <div ref={layersRef} className="share-card-preview__layers" />
      <div className="share-card-preview__loader" aria-hidden="true">
        <Loader2 className="share-card-preview__spinner" />
      </div>
    </div>
  );
}
