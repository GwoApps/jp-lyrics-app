'use client';

/* App-owned adaptation of next-view-transitions. See ViewTransitions.LICENSE.
 * Owning the update callback lets route data participate in snapshot readiness;
 * do not patch browser APIs or start a nested transition from a Back button. */
import NextLink from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, startTransition, use, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ComponentProps, type Dispatch, type SetStateAction } from 'react';
import { startArtistViewTransition } from '@/components/artists/artist-directory-transition';

type Finish = (() => void) | null;
const Context = createContext<Dispatch<SetStateAction<Finish>> | null>(null);
const subscribeHash = (callback: () => void) => { window.addEventListener('hashchange', callback); return () => window.removeEventListener('hashchange', callback); };
const currentHash = () => window.location.hash;
const serverHash = () => '';

function useBrowserTransitions() {
  const pathname = usePathname();
  const [previous, setPrevious] = useState(pathname);
  const [pending, setPending] = useState<{ captured: Promise<void>; finish: () => void; pathname: string; hash: string } | null>(null);
  useEffect(() => {
    if (typeof document.startViewTransition !== 'function') return;
    const onPopState = () => {
      let finish!: () => void;
      const routeCommitted = new Promise<void>(resolve => { finish = resolve; });
      const captured = new Promise<void>(resolve => {
        startArtistViewTransition(document, () => { resolve(); return routeCommitted; });
      });
      setPending({ captured, finish, pathname: window.location.pathname, hash: window.location.hash });
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  if (previous !== pathname) {
    if (pending) use(pending.captured);
    setPrevious(pathname);
  }
  const hash = useSyncExternalStore(subscribeHash, currentHash, serverHash);
  useEffect(() => {
    // Also settles same-URL history entries; only the actual target may release
    // a changed-route snapshot, never an intermediate source-path render.
    if (pending && new URL(pathname, window.location.origin).pathname === pending.pathname && hash === pending.hash) pending.finish();
  }, [pathname, hash, pending]);
}

export function ViewTransitions({ children }: { children: React.ReactNode }) {
  const [finish, setFinish] = useState<Finish>(null);
  useEffect(() => { finish?.(); }, [finish]);
  useBrowserTransitions();
  return <Context.Provider value={setFinish}>{children}</Context.Provider>;
}

type NavigateOptions = NonNullable<Parameters<ReturnType<typeof useRouter>['push']>[1]> & { onTransitionReady?: () => void };
export function useTransitionRouter() {
  const router = useRouter();
  const setFinish = useContext(Context);
  if (!setFinish) throw new Error('ViewTransitions provider is missing');
  const navigate = useCallback((callback: () => void, ready?: () => void) => {
    if (typeof document.startViewTransition !== 'function') { callback(); return; }
    const transition = startArtistViewTransition(document, () => new Promise<void>(resolve => {
      startTransition(() => { callback(); setFinish(() => resolve); });
    }));
    if (ready) void transition.ready.then(ready, () => {});
  }, [setFinish]);
  const push = useCallback((href: string, { onTransitionReady, ...options }: NavigateOptions = {}) => {
    navigate(() => router.push(href, options), onTransitionReady);
  }, [navigate, router]);
  const replace = useCallback((href: string, { onTransitionReady, ...options }: NavigateOptions = {}) => {
    navigate(() => router.replace(href, options), onTransitionReady);
  }, [navigate, router]);
  return useMemo(() => ({ ...router, push, replace }), [router, push, replace]);
}

type LinkProps = Omit<ComponentProps<typeof NextLink>, 'href' | 'as'> & { href: string; as?: string };
export function Link(props: LinkProps) {
  const router = useTransitionRouter();
  return <NextLink {...props} onClick={event => {
    props.onClick?.(event);
    if (event.defaultPrevented || typeof document.startViewTransition !== 'function') return;
    const target = event.currentTarget.getAttribute('target');
    if ((target && target !== '_self') || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0 || event.currentTarget.hasAttribute('download')) return;
    event.preventDefault();
    (props.replace ? router.replace : router.push)(props.as ?? props.href, { scroll: props.scroll ?? true });
  }} />;
}
