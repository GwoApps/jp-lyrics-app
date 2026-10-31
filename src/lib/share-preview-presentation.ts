/**
 * Finish an in-flight fade instead of stacking interrupt snapshots. Only two
 * canvases are ever mounted; one pending successful frame is replaced by newer
 * commits. Exporting is immediate, while presentation can trail by one fade.
 */
export function createSharePreviewPresentation(root: HTMLDivElement, layers: HTMLDivElement) {
  let current: HTMLCanvasElement | null = null;
  let pending: HTMLCanvasElement | null = null;
  let stopFade: (() => void) | null = null;
  let disposed = false;

  function present(frame: HTMLCanvasElement) {
    if (disposed) return;
    if (stopFade) {
      pending = frame;
      return;
    }

    frame.className = 'share-card-preview__frame';
    frame.setAttribute('aria-hidden', 'true');
    // This changes layout, not the canvas bitmap. Each layer uses object-fit:
    // contain throughout the aspect-ratio transition, so text is not stretched.
    root.style.aspectRatio = `${frame.width} / ${frame.height}`;
    const previous = current;
    current = frame;
    layers.append(frame);
    if (!previous) return;

    frame.classList.add('share-card-preview__frame--entering');
    let timer: ReturnType<typeof setTimeout> | undefined;
    function stop() {
      if (timer !== undefined) clearTimeout(timer);
      frame.removeEventListener('animationend', finish);
      frame.removeEventListener('animationcancel', finish);
    }
    function finish(event?: AnimationEvent) {
      if (event && event.target !== frame) return;
      stop();
      stopFade = null;
      previous?.remove();
      frame.classList.remove('share-card-preview__frame--entering');
      const next = pending;
      pending = null;
      if (next && !disposed) present(next);
    }
    stopFade = stop;
    frame.addEventListener('animationend', finish);
    frame.addEventListener('animationcancel', finish);
    const style = getComputedStyle(frame);
    const duration = parseFloat(style.animationDuration)
      * (style.animationDuration.endsWith('ms') ? 1 : 1000);
    if (style.animationName === 'none' || !duration) {
      finish();
    } else {
      // Background tabs and interrupted CSS animations need not emit an end
      // event. The fallback bounds both the queue delay and retained layers.
      timer = setTimeout(finish, duration + 32);
    }
  }

  return {
    present,
    dispose() {
      disposed = true;
      stopFade?.();
      stopFade = null;
      current = null;
      pending = null;
      layers.replaceChildren();
    },
  };
}
