'use client';

import { useEffect, useState } from 'react';
import Toast from '@/components/Toast';
import { useI18n } from '@/lib/i18n';
import { shouldAnnounceUpdate } from '@/lib/sw-update';
import { OFFLINE_IDENTITY_HEADER } from '@/lib/offline-identity';

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000; // hourly
/** Matches the previous inline toast, which hid itself after 15s. */
const TOAST_LIFETIME_MS = 15_000;

/**
 * Registers the service worker and surfaces a new version as a localized
 * toast. Registration lives here (not in an inline `<script>`) so the copy can
 * come from the dictionaries: the old inline script carried its own locale
 * detection and message table, which drifted from `detectLocale()` and no i18n
 * test could reach it.
 */

/** Tell the worker which account's offline cache may be used. */
async function syncOfflineIdentity() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const response = await fetch('/api/me', { cache: 'no-store' });
    const identity = response.headers.get(OFFLINE_IDENTITY_HEADER);
    const worker = navigator.serviceWorker.controller
      || (await navigator.serviceWorker.ready).active;
    if (identity && worker) worker.postMessage({ type: 'OFFLINE_IDENTITY', identity });
  } catch {
    // Offline or transient failure: keep the last known identity; the worker
    // will never serve a snapshot for an account it has not been told about.
  }
}

export default function ServiceWorkerUpdate() {
  const { t } = useI18n();
  const [updateReady, setUpdateReady] = useState(false);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    // Snapshot before registering: after the first install this flips to true,
    // which would make the initial activation look like an update.
    const hadController = navigator.serviceWorker.controller !== null;
    let timer: number | undefined;
    let cancelled = false;

    // The worker can reach `activated` between `register()` resolving and the
    // listener attaching, so check the current state once as well.
    const watch = (worker: ServiceWorker | null) => {
      if (!worker) return;
      const check = () => {
        if (!cancelled && shouldAnnounceUpdate(worker.state, hadController)) setUpdateReady(true);
      };
      worker.addEventListener('statechange', check);
      check();
    };

    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then(async (reg) => {
        if (cancelled) return;
        reg.update();
        timer = window.setInterval(() => reg.update(), UPDATE_CHECK_INTERVAL_MS);
        watch(reg.installing);
        reg.addEventListener('updatefound', () => watch(reg.installing));
        await syncOfflineIdentity();
      })
      .catch((err) => console.warn('[SW] registration failed:', err));

    // Re-check after every auth revalidation (login / logout / account switch).
    const onAuth = () => { void syncOfflineIdentity(); };
    window.addEventListener('jplrc:auth-session-updated', onAuth);

    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearInterval(timer);
      window.removeEventListener('jplrc:auth-session-updated', onAuth);
    };
  }, []);

  useEffect(() => {
    if (!updateReady) return;
    const hide = window.setTimeout(() => setUpdateReady(false), TOAST_LIFETIME_MS);
    return () => window.clearTimeout(hide);
  }, [updateReady]);

  if (!updateReady) return null;

  return (
    <Toast
      type="success"
      message={t('common.updateAvailable')}
      actionLabel={t('common.updateNow')}
      onAction={() => window.location.reload()}
      onClick={() => window.location.reload()}
    />
  );
}
