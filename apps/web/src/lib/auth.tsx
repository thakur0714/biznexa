'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { safeRedirectPath } from '@biznexa/types';
import { post } from '@biznexa/api-client/browser';
import { ApiProvider } from '@biznexa/api-client/react';

export interface SessionUser {
  id: string;
  name: string;
  email: string | null;
  mobile: string | null;
  avatarUrl: string | null;
  emailVerified: boolean;
  mobileVerified: boolean;
  roles: string[];
}

interface SessionResponse {
  accessToken: string;
  user: SessionUser;
}

interface AuthState {
  user: SessionUser | null;
  token: string | null;
  ready: boolean;
  /** Store a session returned by login/register/OTP verification. */
  signIn: (s: SessionResponse) => void;
  signOut: () => Promise<void>;
  /** Refresh the access token using the httpOnly refresh cookie. */
  refresh: () => Promise<string | null>;
}

const AuthContext = createContext<AuthState | null>(null);

/**
 * The access token lives only in memory; the refresh token is an httpOnly cookie the
 * browser sends to /api/auth. On load we exchange the cookie for a fresh access token.
 */
export function AuthProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const inflight = useRef<Promise<string | null> | null>(null);

  const signIn = useCallback((s: SessionResponse) => {
    setUser(s.user);
    setToken(s.accessToken);
    try {
      localStorage.setItem('bn_has_session', '1');
    } catch {}
  }, []);

  const refresh = useCallback(() => {
    inflight.current ??= post<SessionResponse>('/auth/refresh')
      .then((s) => {
        signIn(s);
        return s.accessToken;
      })
      .catch(() => {
        setUser(null);
        setToken(null);
        try {
          localStorage.removeItem('bn_has_session');
        } catch {}
        return null;
      })
      .finally(() => {
        inflight.current = null;
      });
    return inflight.current;
  }, [signIn]);

  useEffect(() => {
    let hasSession = false;
    try {
      hasSession = localStorage.getItem('bn_has_session') === '1';
    } catch {}
    void (hasSession ? refresh() : Promise.resolve(null)).finally(() => setReady(true));
  }, [refresh]);

  // Access tokens last 15 minutes; renew a little before that while the tab is open.
  useEffect(() => {
    if (!token) return;
    const id = setTimeout(() => void refresh(), 13 * 60_000);
    return () => clearTimeout(id);
  }, [token, refresh]);

  const signOut = useCallback(async () => {
    await post('/auth/logout').catch(() => undefined);
    setUser(null);
    setToken(null);
    try {
      localStorage.removeItem('bn_has_session');
    } catch {}
  }, []);

  const value = useMemo(() => ({ user, token, ready, signIn, signOut, refresh }), [user, token, ready, signIn, signOut, refresh]);
  return (
    <AuthContext.Provider value={value}>
      {/* Every client component below gets the typed API client for this session: useApi(). */}
      <ApiProvider token={token} refresh={refresh}>
        {children}
      </ApiProvider>
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/** Only allow same-site relative redirects after login. */
export function safeNext(next: string | null | undefined, fallback = '/dashboard') {
  return safeRedirectPath(next, fallback);
}
