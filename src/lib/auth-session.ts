'use client';

import { useCallback, useEffect, useState } from 'react';

export type SpotifyLoginStatus = {
  connected: boolean;
  display_name?: string;
};

export type CurrentUser = {
  email: string;
  name: string;
  isAdmin: boolean;
};

export type AuthSession = {
  user: CurrentUser | null;
  spotify: SpotifyLoginStatus;
};

const CACHE_KEY = 'jplrc:auth-session:v1';
const SESSION_EVENT = 'jplrc:auth-session-updated';
let refreshInFlight: Promise<AuthSession> | null = null;

function isSession(value: unknown): value is AuthSession {
  if (!value || typeof value !== 'object') return false;
  const session = value as Partial<AuthSession>;
  if (!session.spotify || typeof session.spotify.connected !== 'boolean') return false;
  if (session.user === null) return true;
  return !!session.user
    && typeof session.user.email === 'string'
    && typeof session.user.name === 'string'
    && typeof session.user.isAdmin === 'boolean';
}

export function getCachedAuthSession(): AuthSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const cached: unknown = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null');
    return isSession(cached) ? cached : null;
  } catch {
    return null;
  }
}

function sessionsEqual(a: AuthSession | null, b: AuthSession) {
  return a?.user?.email === b.user?.email
    && a?.user?.name === b.user?.name
    && a?.user?.isAdmin === b.user?.isAdmin
    && a?.spotify.connected === b.spotify.connected
    && a?.spotify.display_name === b.spotify.display_name;
}

export function setCachedAuthSession(session: AuthSession) {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(session));
  } catch {}
  window.dispatchEvent(new CustomEvent<AuthSession>(SESSION_EVENT, { detail: session }));
}

/**
 * Always revalidates both server-side login signals. Cached data is only used as
 * immediate UI state; every page entry still asks the server for the current truth.
 */
export function refreshAuthSession(): Promise<AuthSession> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = Promise.all([
    fetch('/api/me', { cache: 'no-store' }),
    fetch('/api/spotify/status', { cache: 'no-store' }),
  ])
    .then(async ([meResponse, spotifyResponse]) => {
      if (!meResponse.ok || !spotifyResponse.ok) throw new Error('auth_status_unavailable');
      const [me, spotify] = await Promise.all([meResponse.json(), spotifyResponse.json()]);
      const session: AuthSession = {
        user: me.authenticated
          ? { email: String(me.email || ''), name: String(me.name || ''), isAdmin: me.isAdmin === true }
          : null,
        spotify: {
          connected: spotify.connected === true,
          ...(typeof spotify.display_name === 'string' ? { display_name: spotify.display_name } : {}),
        },
      };
      setCachedAuthSession(session);
      return session;
    })
    .finally(() => { refreshInFlight = null; });

  return refreshInFlight;
}

export function useAuthSession() {
  const [session, setSession] = useState<AuthSession | null>(() => getCachedAuthSession());

  useEffect(() => {
    const sync = (event: Event) => {
      const next = (event as CustomEvent<AuthSession>).detail;
      if (isSession(next)) setSession((previous) => sessionsEqual(previous, next) ? previous : next);
    };
    window.addEventListener(SESSION_EVENT, sync);
    refreshAuthSession()
      .then((next) => setSession((previous) => sessionsEqual(previous, next) ? previous : next))
      // A transient network error must not turn a known cached login state into a false logout.
      .catch(() => {});
    return () => window.removeEventListener(SESSION_EVENT, sync);
  }, []);

  const updateSession = useCallback((next: AuthSession) => {
    setCachedAuthSession(next);
    setSession((previous) => sessionsEqual(previous, next) ? previous : next);
  }, []);

  return { session, updateSession };
}
