'use client';

/* App-owned adaptation of next-view-transitions. See ViewTransitions.LICENSE.
 * Owning the update callback lets route data participate in snapshot readiness;
 * do not patch browser APIs or start a nested transition from a Back button. */
import NextLink from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, startTransition, use, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentProps } from 'react';
import { isLibraryRoute, startRouteViewTransition } from './library-navigation';

type Finish = (() => void) | null;
const Context = createContext<((finish: () => void) => void) | null>(null);
const subscribeHash = (callback: () => void) => { window.addEventListener('hashchange', callback); return () => window.removeEventListener('hashchange', callback); };
const currentHash = () => window.location.hash;
const serverHash = () => '';

function useBrowserTransitions(settlePush: () => void) {
  const pathname = usePathname();
  const [previous, setPrevious] = useState(pathname);
  const committedPath = useRef(pathname);
  const activeFinish = useRef<Finish>(null);
  useEffect(() => { committedPath.current = pathname; }, [pathname]);
  const [pending, setPending] = useState<{ captured: Promise<void>; finish: () => void; pathname: string; hash: string } | null>(null);
  useEffect(() => {
    if (typeof document.startViewTransition !== 'function') return;
    const onPopState = () => {
      settlePush();
      activeFinish.current?.();
      let finish!: () => void;
      const routeCommitted = new Promise<void>(resolve => { finish = resolve; });
      activeFinish.current = finish;
      const captured = new Promise<void>(resolve => {
        startRouteViewTransition(document, () => { resolve(); return routeCommitted; }, committedPath.current, window.location.pathname);
      });
      setPending({ captured, finish, pathname: window.location.pathname, hash: window.location.hash });
    };
    window.addEventListener('popstate', onPopState);
    return () => { window.removeEventListener('popstate', onPopState); activeFinish.current?.(); };
  }, [settlePush]);
  if (previous !== pathname) {
    if (pending) use(pending.captured);
    setPrevious(pathname);
  }
  const hash = useSyncExternalStore(subscribeHash, currentHash, serverHash);
  useEffect(() => {
    // Also settles same-URL history entries; only the actual target may release
    // a changed-route snapshot, never an intermediate source-path render.
    if (pending && new URL(pathname, window.location.origin).pathname === pending.pathname && hash === pending.hash) {
      pending.finish();
      if (activeFinish.current === pending.finish) activeFinish.current = null;
    }
  }, [pathname, hash, pending]);
}

export function ViewTransitions({ children }: { children: React.ReactNode }) {
  const [finish, setFinish] = useState<Finish>(null);
  const activeFinish = useRef<Finish>(null);
  const settle = useCallback(() => { activeFinish.current?.(); activeFinish.current = null; }, []);
  const register = useCallback((next: () => void) => {
    settle(); activeFinish.current = next; setFinish(() => next);
  }, [settle]);
  useEffect(() => { finish?.(); if (activeFinish.current === finish) activeFinish.current = null; }, [finish]);
  useEffect(() => settle, [settle]);
  useBrowserTransitions(settle);
  return <Context.Provider value={register}>{children}</Context.Provider>;
}

type NavigateOptions = NonNullable<Parameters<ReturnType<typeof useRouter>['push']>[1]> & { onTransitionReady?: () => void };
export function useTransitionRouter() {
  const router = useRouter();
  const registerFinish = useContext(Context);
  if (!registerFinish) throw new Error('ViewTransitions provider is missing');
  const navigate = useCallback((callback: () => void, href: string, ready?: () => void) => {
    if (typeof document.startViewTransition !== 'function') { callback(); return; }
    const transition = startRouteViewTransition(document, () => new Promise<void>(resolve => {
      startTransition(() => { callback(); registerFinish(resolve); });
    }), window.location.pathname, new URL(href, window.location.href).pathname);
    if (ready) void transition.ready.then(ready, () => {});
  }, [registerFinish]);
  const push = useCallback((href: string, { onTransitionReady, ...options }: NavigateOptions = {}) => {
    navigate(() => router.push(href, options), href, onTransitionReady);
  }, [navigate, router]);
  const replace = useCallback((href: string, { onTransitionReady, ...options }: NavigateOptions = {}) => {
    navigate(() => router.replace(href, options), href, onTransitionReady);
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
    const destination = new URL(props.as ?? props.href, window.location.href);
    // Keyboard and same-list activation stay immediate; NextLink retains normal
    // routing, modifier-key behavior and URL/scroll semantics.
    if (event.detail === 0 || (destination.pathname === window.location.pathname && isLibraryRoute(destination.pathname))) return;
    event.preventDefault();
    (props.replace ? router.replace : router.push)(props.as ?? props.href, { scroll: props.scroll ?? true });
  }} />;
}
