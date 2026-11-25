'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type Dispatch, type SetStateAction } from 'react';
import { useAuthSession } from './auth-session';
import { queueSettingUpload } from './settings-upload';

/**
 * Reading `localStorage` / `sessionStorage` during render is only safe once the
 * tree is interactive: the server cannot see those stores, so a value read
 * during the hydration render would disagree with the HTML the server sent and
 * React would throw the server markup away.
 *
 * These hooks return the server-side default (nothing / `null`) until hydration
 * has finished, then the stored value. A component can therefore render the
 * same first paint the server produced and adopt the stored preference one
 * frame later, instead of withholding the whole tree until hydration — which is
 * what left every cold start blank (issue #419).
 */

/** Nothing ever changes, so React re-reads the snapshot once, after hydration. */
const subscribe = () => () => {};

/** `false` on the server and during the hydration render, `true` afterwards. */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false);
}

/** Raw `localStorage` string, or `null` when unset/unavailable. */
export function readStoredString(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    // Private mode / blocked storage: behave as if nothing was stored.
    return null;
  }
}

/** `localStorage` write that never throws (storage can be disabled). */
export function writeStoredString(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Nothing to do: the preference stays session-only.
  }
}

/**
 * Hydration-safe `localStorage` read: `null` on the server and during the
 * hydration render, then the raw stored string. A string is a primitive, so
 * React's snapshot comparison stays stable across renders.
 */
export function useStoredString(key: string): string | null {
  return useSyncExternalStore(subscribe, () => readStoredString(key), () => null);
}

/**
 * A preference backed by `localStorage`, safe to render on the server.
 *
 * - `parse(raw)` maps the stored string (or `null`) to a usable value, so the
 *   server render and the hydration render always agree.
 * - The setter keeps React's `Dispatch` shape (value or updater function) and
 *   persists what it stored, so there is no write-back effect that could
 *   clobber the stored value with a pre-hydration default.
 */
export function useStoredPreference<T>(
  key: string,
  parse: (raw: string | null) => T,
  serialize: (value: T) => string = String,
): readonly [T, Dispatch<SetStateAction<T>>] {
  const { session } = useAuthSession();
  const isLoggedIn = !!session?.user;
  const isLoggedInRef = useRef(isLoggedIn);
  useEffect(() => { isLoggedInRef.current = isLoggedIn; }, [isLoggedIn]);
  const stored = useStoredString(key);
  // The raw string the reader chose, or `null` while the stored value is still
  // authoritative. Keeping the serialized form (not the parsed value) means the
  // write-back below needs no dependency on `serialize`.
  const [chosen, setChosen] = useState<string | null>(null);
  const value = parse(chosen ?? stored);

  useEffect(() => {
    // Only a reader's own choice is written back; the initial render must not
    // overwrite a stored value it merely read.
    if (chosen !== null) {
      writeStoredString(key, chosen);
      queueSettingUpload(key, isLoggedInRef.current);
    }
  }, [key, chosen]);

  const setValue = useCallback<Dispatch<SetStateAction<T>>>((action) => {
    setChosen((previous) => {
      const base = parse(previous ?? readStoredString(key));
      return serialize(typeof action === 'function' ? (action as (p: T) => T)(base) : action);
    });
  }, [key, parse, serialize]);

  return [value, setValue] as const;
}
