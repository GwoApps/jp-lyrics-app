import type { ReactNode } from 'react';

/**
 * Shared anchor for every transient status layer pinned to the top-center of
 * the song detail page (partial-translation banner, translation pill, sync
 * pill): a single `fixed left-1/2 top-3 z-[100]` flex column that stacks its
 * children vertically instead of letting each layer copy its own `fixed …
 * top-3` anchor and overlap the others (issue #282).
 *
 * The container only owns the position and the stacking; children keep their
 * own layout. `max-w` stays on the container so an over-wide child truncates
 * instead of overflowing narrow viewports, and the column items are centered
 * so every pill keeps the same horizontally-centered anchor it had before.
 *
 * `pointer-events-none` makes the full-width band click-through (only the pills
 * should take clicks), but `pointer-events` is inherited — a child without its
 * own restore stays unclickable, so its buttons look alive and do nothing
 * (issue #369). Children must therefore be wrapped in `StatusLayer` below.
 */
export default function SongTopStatusStack({ children }: { children: ReactNode }) {
  return (
    <div
      data-status-stack="top"
      className="pointer-events-none fixed left-1/2 top-3 z-[100] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-col items-center gap-2"
    >
      {children}
    </div>
  );
}

/**
 * Wrapper for every direct child of `SongTopStatusStack`: restores
 * `pointer-events-auto` so the layer's own buttons and scroll areas stay
 * clickable under the click-through container. Use it for any new status layer
 * instead of hand-adding the class, so the restore cannot be forgotten
 * (issue #369).
 */
export function StatusLayer({ children }: { children: ReactNode }) {
  return <div className="pointer-events-auto contents">{children}</div>;
}
