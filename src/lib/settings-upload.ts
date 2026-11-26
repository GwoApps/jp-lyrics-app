/**
 * Debounced upload channel for reader-driven preference changes.
 *
 * `useStoredPreference` writes the chosen value to localStorage immediately
 * and queues the matching server setting here. The upload is best-effort: a
 * failed request never changes the local value, so offline readers keep using
 * what they just chose (issue #519).
 */
'use client';

import { SETTING_TO_LS, SYNCABLE_KEYS, isSyncEnabled } from './sync-settings';

const UPLOAD_DEBOUNCE_MS = 400;

const LS_TO_SETTING: Record<string, string> = {};
for (const [key, lsKey] of Object.entries(SETTING_TO_LS)) LS_TO_SETTING[lsKey] = key;

type UploadQueue = {
  timer: ReturnType<typeof setTimeout> | null;
  pending: Record<string, string>;
  inFlight: Record<string, string> | null;
};

declare global {
  interface Window {
    __jplrcSettingsUploadQueue?: UploadQueue;
  }
}

function getQueue(): UploadQueue | null {
  if (typeof window === 'undefined') return null;
  const existing = window.__jplrcSettingsUploadQueue;
  if (existing) return existing;
  const created: UploadQueue = { timer: null, pending: {}, inFlight: null };
  window.__jplrcSettingsUploadQueue = created;
  return created;
}

/**
 * Queue one localStorage preference for upload. Unknown/non-syncable keys,
 * disabled sync and logged-out readers are ignored; isSyncEnabled() is checked
 * at flush time as well, so turning sync off cancels a queued upload.
 */
export function queueSettingUpload(lsKey: string, isLoggedIn: boolean) {
  if (!isLoggedIn || !isSyncEnabled()) return;
  const key = LS_TO_SETTING[lsKey];
  if (!key || !SYNCABLE_KEYS.includes(key as (typeof SYNCABLE_KEYS)[number])) return;
  const queue = getQueue();
  if (!queue) return;
  let value: string | null;
  try { value = localStorage.getItem(lsKey); } catch { return; }
  if (value === null) return;
  queue.pending[key] = value;
  if (queue.timer !== null) clearTimeout(queue.timer);
  queue.timer = setTimeout(() => void flushSettingUploads(), UPLOAD_DEBOUNCE_MS);
}

/** Send the currently queued patch (or the patch left over from a failed send). */
export async function flushSettingUploads(): Promise<boolean> {
  const queue = getQueue();
  if (!queue) return false;
  if (queue.timer !== null) {
    clearTimeout(queue.timer);
    queue.timer = null;
  }
  if (!isSyncEnabled()) return false;
  // Keep the failed patch for a later retry; never rewrite localStorage from
  // the response, so a stale server payload cannot reverse a local choice.
  // Changes made during an in-flight request are newer and win on retry.
  const patch = { ...queue.inFlight, ...queue.pending };
  if (!Object.keys(patch).length) return false;
  queue.inFlight = patch;
  queue.pending = {};
  try {
    const res = await fetch('/api/me/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
      cache: 'no-store',
    });
    if (!res.ok) return false;
    queue.inFlight = null;
    return true;
  } catch {
    return false;
  }
}

/** Clear pending state (e.g. after logout); the next change starts fresh. */
export function resetSettingUploads() {
  const queue = getQueue();
  if (!queue) return;
  if (queue.timer !== null) clearTimeout(queue.timer);
  queue.timer = null;
  queue.pending = {};
  queue.inFlight = null;
}
