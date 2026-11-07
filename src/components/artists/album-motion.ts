import { artistMotionEasing } from './detail-motion';

/** Height is intentional for an accordion: surrounding albums must move with it.
 * Read the current frame before cancelling, so reversals never restart at zero. */
export function createArtistAlbumMotion() {
  let initialized = false;
  let target = false;
  let revision = 0;
  let animations: Animation[] = [];
  const cancel = () => { revision++; for (const animation of animations) animation.cancel(); animations = []; };
  return {
    cancel,
    transition(element: HTMLElement, body: HTMLElement, expanded: boolean, reducedMotion: boolean, onFinish: (expanded: boolean) => void) {
      const active = animations.length > 0;
      if (!initialized || (target === expanded && !active)) {
        initialized = true; target = expanded;
        element.style.height = ''; element.style.overflow = ''; body.style.opacity = '';
        return;
      }
      const summary = element.querySelector('summary')!;
      const closedHeight = summary.getBoundingClientRect().height + element.offsetHeight - element.clientHeight;
      const from = active || target ? element.getBoundingClientRect().height : closedHeight;
      const opacity = active ? element.ownerDocument.defaultView?.getComputedStyle(body).opacity ?? '1' : expanded ? '0' : '1';
      const to = expanded ? closedHeight + body.getBoundingClientRect().height : closedHeight;
      cancel(); target = expanded;
      const ownRevision = revision;
      const settle = () => {
        if (revision !== ownRevision) return;
        element.style.height = expanded ? '' : `${closedHeight}px`;
        element.style.overflow = expanded ? '' : 'hidden';
        body.style.opacity = expanded ? '' : '0';
        cancel(); onFinish(expanded);
      };
      element.style.overflow = 'hidden';
      if (reducedMotion || typeof element.animate !== 'function' || typeof body.animate !== 'function') {
        element.style.height = expanded ? '' : `${closedHeight}px`;
        body.style.opacity = expanded ? '' : '0';
        void Promise.resolve().then(settle);
        return;
      }
      const options: KeyframeAnimationOptions = { duration: 200, easing: artistMotionEasing, fill: 'both' };
      animations = [element.animate([{ height: `${from}px` }, { height: `${to}px` }], options), body.animate([{ opacity }, { opacity: expanded ? 1 : 0 }], options)];
      void Promise.all(animations.map(animation => animation.finished)).then(settle, settle);
    },
  };
}
