'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useI18n } from '@/lib/i18n';
import { isSameOriginHref } from '@/lib/unsaved-changes';

export interface UnsavedChangesGuardOptions {
  /** Fallback destination when a confirmed navigation has no pending target. */
  confirmHref: string;
  /** True while the editor holds unsaved changes. */
  dirty: boolean;
}

/**
 * Guards an editor against silently losing unsaved changes, covering every way
 * a user can leave the page:
 *
 *  - tab close / refresh / mobile swipe-back that unloads the page
 *    (`beforeunload`);
 *  - in-app `<Link>` clicks (breadcrumbs, top navigation, song cards) via a
 *    capture-phase document listener that blocks Next's Link handler before it
 *    can start a client navigation;
 *  - explicit `router.push` navigation (cancel, breadcrumb buttons) through the
 *    returned `guard` function;
 *  - browser back / forward, by keeping a history sentinel on top of the stack
 *    while the editor is dirty (best effort — the Next App Router exposes no
 *    navigation blocker, so the sentinel is created by cloning the router's own
 *    history state to stay compatible with its internal bookkeeping).
 *
 * Every guarded navigation is routed through the project's shared ConfirmDialog,
 * which is rendered by this hook; pages only need to render `{dialog}`.
 */
export function useUnsavedChangesGuard({ confirmHref, dirty }: UnsavedChangesGuardOptions) {
  const router = useRouter();
  const { t } = useI18n();
  const [dialogOpen, setDialogOpen] = useState(false);
  const dirtyRef = useRef(dirty);
  const dialogOpenRef = useRef(dialogOpen);
  const pendingHrefRef = useRef<string | null>(null);
  const backTriggeredRef = useRef(false);
  const popStateHandlerRef = useRef<(() => void) | null>(null);
  const sentinelPushedRef = useRef(false);
  const entryUrlRef = useRef('');

  // Keep the refs in sync for window-level listeners (no render reads).
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);
  useEffect(() => {
    dialogOpenRef.current = dialogOpen;
  }, [dialogOpen]);

  /** Ask before navigating to `href`; returns false if the user cancelled. */
  const guard = useCallback((href: string): boolean => {
    if (!dirtyRef.current) {
      router.push(href);
      return true;
    }
    backTriggeredRef.current = false;
    pendingHrefRef.current = href;
    setDialogOpen(true);
    return false;
  }, [router]);

  const confirmLeave = useCallback(() => {
    setDialogOpen(false);
    const target = pendingHrefRef.current ?? confirmHref;
    pendingHrefRef.current = null;
    if (backTriggeredRef.current) {
      // Complete the back gesture the user already started: drop the sentinel
      // and the editor entry so the stack returns to the previous page.
      backTriggeredRef.current = false;
      const handler = popStateHandlerRef.current;
      if (handler) {
        window.removeEventListener('popstate', handler);
        popStateHandlerRef.current = null;
      }
      sentinelPushedRef.current = false;
      if (window.history.length >= 3) {
        window.history.go(-2);
      } else {
        // No page before the editor — fall back to the confirm target.
        router.replace(confirmHref);
      }
      return;
    }
    // Normal (cancel / breadcrumb / card) navigation: replace the sentinel so
    // the browser back button doesn't land on a stale copy of the editor.
    sentinelPushedRef.current = false;
    router.replace(target);
  }, [confirmHref, router]);

  const cancelLeave = useCallback(() => {
    setDialogOpen(false);
    pendingHrefRef.current = null;
    backTriggeredRef.current = false;
  }, []);

  // Tab close / refresh / mobile swipe-back that unloads the page.
  useEffect(() => {
    if (!dirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Chrome ignores returnValue but needs it set for the dialog to show.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [dirty]);

  // Browser back / forward: keep a sentinel on top of the history stack while
  // the editor is dirty, so a back gesture lands here again and can be
  // confirmed instead of silently leaving. When the editor becomes clean (e.g.
  // after a successful save) the sentinel is popped so a later back press
  // leaves normally.
  useEffect(() => {
    if (!dirty) {
      if (sentinelPushedRef.current && window.location.href === entryUrlRef.current) {
        // Pop the sentinel after the popstate listener is gone so the browser
        // simply returns to the editor's real entry (same URL).
        sentinelPushedRef.current = false;
        window.history.go(-1);
      }
      return;
    }
    const handlePopState = () => {
      // Re-pin the sentinel so the editor stays on top of the stack.
      window.history.pushState(window.history.state, '');
      if (dialogOpenRef.current) return;
      backTriggeredRef.current = true;
      setDialogOpen(true);
    };
    popStateHandlerRef.current = handlePopState;
    window.addEventListener('popstate', handlePopState);
    if (!sentinelPushedRef.current) {
      sentinelPushedRef.current = true;
      entryUrlRef.current = window.location.href;
      // Clone the router's own history state so Next still treats the sentinel
      // as an in-app entry rather than an external navigation.
      window.history.pushState(window.history.state, '');
    }
    return () => {
      window.removeEventListener('popstate', handlePopState);
      if (popStateHandlerRef.current === handlePopState) popStateHandlerRef.current = null;
    };
  }, [dirty]);

  // In-app <Link> clicks (breadcrumbs, top navigation, song cards) bypass
  // router hooks. Intercept them at the document level while the editor is
  // dirty so the ConfirmDialog can guard them too. Capture phase runs before
  // Next's delegated Link handler, and stopPropagation keeps it from starting
  // a client navigation.
  useEffect(() => {
    if (!dirty) return;
    const handleClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey
        || event.shiftKey || event.altKey) return;
      const anchor = (event.target as HTMLElement | null)?.closest('a');
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#') || anchor.hasAttribute('download') || anchor.target === '_blank') return;
      if (!isSameOriginHref(href, window.location.href)) return;
      event.preventDefault();
      event.stopPropagation();
      guard(href);
    };
    document.addEventListener('click', handleClick, true);
    return () => document.removeEventListener('click', handleClick, true);
  }, [dirty, guard]);

  const dialog = (
    <ConfirmDialog
      open={dialogOpen}
      title={t('common.unsavedTitle')}
      body={t('common.unsavedBody')}
      confirmLabel={t('common.discard')}
      cancelLabel={t('common.cancel')}
      variant="danger"
      onConfirm={confirmLeave}
      onCancel={cancelLeave}
    />
  );

  return { dialog, guard };
}
