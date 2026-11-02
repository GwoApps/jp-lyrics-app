/** Extend the app-owned transition's callback through the fresh directory/avatar
 * commit, without patching document APIs or retaining viewer-scoped rows. */
export function startArtistViewTransition(document: Document, options?: ViewTransitionUpdateCallback | StartViewTransitionOptions): ViewTransition {
  const window = document.defaultView;
  const outgoing = document.querySelector<HTMLElement>('.artist-profile .artist-avatar');
  const name = outgoing && window?.getComputedStyle(outgoing).viewTransitionName;
  if (!window || !name || name === 'none' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return document.startViewTransition(options);
  }
  const controller = new AbortController();
  const update = typeof options === 'function' ? options : options?.update;
  const readyUpdate = async () => {
    await update?.();
    if (window.location.pathname === '/artists') {
      await waitForArtistDirectorySnapshot(document, name, controller.signal);
    }
  };
  const transition = document.startViewTransition(typeof options === 'object'
    ? { ...options, update: readyUpdate }
    : readyUpdate);
  void transition.ready.catch(() => controller.abort());
  void transition.finished.then(() => controller.abort(), () => controller.abort());
  return transition;
}

export function waitForArtistDirectorySnapshot(document: Document, name: string, signal: AbortSignal): Promise<void> {
  const window = document.defaultView;
  if (!window || signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    let decoding: HTMLImageElement | undefined;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      observer.disconnect();
      window.removeEventListener('popstate', inspect);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const inspect = () => {
      if (done) return;
      if (window.location.pathname !== '/artists') { finish(); return; }
      const directory = document.querySelector<HTMLElement>('[data-artist-directory-state]');
      if (!directory || directory.dataset.artistDirectoryState === 'loading') return;
      // Errors, empty lists, and artists no longer authorized are valid endpoints.
      const avatar = Array.from(directory.querySelectorAll<HTMLElement>('.artist-avatar'))
        .find((element) => window.getComputedStyle(element).viewTransitionName === name);
      const image = avatar?.querySelector('img');
      if (!image) { finish(); return; }
      if (image === decoding) return;
      decoding = image;
      // Reused public portraits are synchronous, but a fresh DOM img must still
      // be decoded before its pixels can appear in the native new snapshot.
      image.loading = 'eager';
      void image.decode().catch(() => {}).then(() => {
        if (done) return;
        if (image.isConnected && avatar?.isConnected) finish();
        else { decoding = undefined; inspect(); }
      });
    };
    const observer = new MutationObserver(inspect);
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-artist-directory-state', 'src'] });
    signal.addEventListener('abort', finish, { once: true });
    window.addEventListener('popstate', inspect);
    inspect();
  });
}
