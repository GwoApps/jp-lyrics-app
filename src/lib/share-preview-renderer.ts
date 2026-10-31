export type SharePreviewStatus = 'idle' | 'drawing' | 'ready' | 'error';

type Draw<Frame> = (frame: Frame) => Promise<void>;

/**
 * At most one draw owns a work frame at a time. While it is awaiting fonts,
 * artwork or QR data, subsequent requests replace a single pending job.
 * An obsolete draw can finish, but can never publish pixels or readiness.
 */
export function createSharePreviewRenderer<Frame>({
  createFrame,
  commit,
  onStatus,
  release,
}: {
  createFrame: () => Frame;
  commit: (frame: Frame) => void;
  onStatus: (status: SharePreviewStatus) => void;
  release?: (frame: Frame) => void;
}) {
  let version = 0;
  let disposed = false;
  let running = false;
  let pending: { version: number; draw: Draw<Frame> } | null = null;

  async function drain() {
    if (running || disposed) return;
    running = true;
    try {
      while (pending && !disposed) {
        const job = pending;
        pending = null;
        let frame: Frame | undefined;
        let committed = false;
        try {
          frame = createFrame();
          await job.draw(frame);
          if (!disposed && job.version === version) {
            commit(frame);
            committed = true;
            onStatus('ready');
          }
        } catch {
          // Rejected draws, synchronous throws and failed publication all leave
          // the last successful frame intact, with downloading disabled.
          if (!disposed && job.version === version) onStatus('error');
        } finally {
          if (!committed && frame !== undefined) release?.(frame);
        }
      }
    } finally {
      running = false;
    }
  }

  return {
    request(draw: Draw<Frame> | null) {
      if (disposed) return;
      version += 1;
      pending = draw ? { version, draw } : null;
      onStatus(draw ? 'drawing' : 'idle');
      void drain();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      version += 1;
      pending = null;
      onStatus('idle');
    },
  };
}
