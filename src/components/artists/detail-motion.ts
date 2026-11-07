export type LibraryTab = 'songs' | 'albums';
const easing = 'cubic-bezier(0.22, 1, 0.36, 1)';
export { easing as artistMotionEasing };

/** Progressive enhancement: underlying rows are always opaque, including after cancellation. */
export function animateArtistSongArrival(rows: Iterable<HTMLElement>, reducedMotion: boolean, routeFinished?: Promise<unknown>) {
  const animations: Animation[] = [];
  let cancelled = false;
  if (!reducedMotion) {
    // Do not create hundreds of compositor layers or make off-screen songs wait.
    for (const row of rows) {
      if (animations.length >= 8) break;
      if (typeof row.animate !== 'function') continue;
      const animation = row.animate([
        { opacity: 0, transform: 'translateY(12px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ], { duration: 320, delay: animations.length * 40, easing, fill: 'backwards' });
      // Cancellation rejects finished; it must never become an unhandled rejection.
      void animation.finished.catch(() => {});
      if (routeFinished) animation.pause();
      animations.push(animation);
    }
  }
  if (routeFinished) {
    // Native route snapshots freeze visible DOM: don't spend the entrance while
    // that snapshot hides it. Paused backwards-fill holds the real start frame.
    const resume = () => { if (!cancelled) for (const animation of animations) animation.play(); };
    void routeFinished.then(resume, resume);
  }
  return () => { cancelled = true; for (const animation of animations) animation.cancel(); };
}

/** Use the active route's completion, with a native-animation fallback for older engines. */
export function artistRouteTransitionFinished(document: Document): Promise<unknown> | undefined {
  const active = (document as Document & { activeViewTransition?: { finished: Promise<unknown> } }).activeViewTransition;
  if (active) return active.finished;
  const native = document.getAnimations?.().filter((animation) => {
    const name = (animation as CSSAnimation).animationName;
    return typeof name === 'string' && name.includes('view-transition');
  });
  return native?.length ? Promise.allSettled(native.map((animation) => animation.finished)) : undefined;
}

/** Own the two panes' WAAPI lifetimes, retargeting interrupted transitions at their current frame. */
export function createArtistTabMotion() {
  const animations = new Map<HTMLElement, Animation>();
  let revision = 0;
  const cancel = () => {
    revision++;
    for (const animation of animations.values()) animation.cancel();
    animations.clear();
  };
  const currentFrame = (element: HTMLElement): Keyframe | undefined => {
    if (!animations.has(element)) return;
    const style = element.ownerDocument.defaultView?.getComputedStyle(element);
    return style ? { opacity: style.opacity, transform: style.transform } : undefined;
  };
  return {
    cancel,
    transition(incoming: HTMLElement, outgoing: HTMLElement, direction: 1 | -1, reducedMotion: boolean, onFinish: () => void) {
      const incomingFrame = currentFrame(incoming);
      const outgoingFrame = currentFrame(outgoing);
      cancel();
      const ownRevision = revision;
      if (reducedMotion || typeof incoming.animate !== 'function' || typeof outgoing.animate !== 'function') {
        onFinish();
        return;
      }
      const options: KeyframeAnimationOptions = { duration: 320, easing, fill: 'both' };
      const enter = incoming.animate([
        incomingFrame ?? { opacity: 0, transform: `translateX(${direction * 32}px)` },
        { opacity: 1, transform: 'translateX(0)' },
      ], options);
      const exit = outgoing.animate([
        outgoingFrame ?? { opacity: 1, transform: 'translateX(0)' },
        { opacity: 0, transform: `translateX(${-direction * 32}px)` },
      ], options);
      animations.set(incoming, enter);
      animations.set(outgoing, exit);
      // Keep the outgoing final frame until React hides it; no one-frame flash on finish.
      const settle = () => { if (revision === ownRevision) onFinish(); };
      void Promise.all([enter.finished, exit.finished]).then(settle, settle);
    },
  };
}
