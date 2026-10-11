'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { canUseAdmin, needsTwoFactor, safeRedirectPath, type TwoFactorState } from '@biznexa/types';
import { post } from '@biznexa/api-client/browser';
import { ApiProvider } from '@biznexa/api-client/react';

export interface StaffUser {
  id: string;
  name: string;
  email: string | null;
  mobile: string | null;
  avatarUrl: string | null;
  roles: string[];
  permissions: string[];
  /** Staff must set up or enter a 2FA code before the API applies their permissions (D27). */
  twoFactor: TwoFactorState;
}

export interface SessionResponse {
  accessToken: string;
  user: StaffUser;
}

interface AuthState {
  user: StaffUser | null;
  token: string | null;
  ready: boolean;
  /** The last login/refresh belonged to someone without `admin.access` (e.g. a customer). */
  denied: boolean;
  /** Store a session from /auth/login. Returns false (and drops the session) for non-staff users. */
  signIn: (s: SessionResponse) => Promise<boolean>;
  signOut: () => Promise<void>;
  refresh: () => Promise<string | null>;
}

const AuthContext = createContext<AuthState | null>(null);
const FLAG = 'bn_admin_session';

function setFlag(on: boolean) {
  try {
    if (on) localStorage.setItem(FLAG, '1');
    else localStorage.removeItem(FLAG);
  } catch {}
}

/**
 * Same token model as the website (D10): access token in memory, refresh token in an httpOnly cookie.
 * The portal only keeps sessions that carry `admin.access`; anyone else is logged straight back out so
 * no usable session is left behind. The API still enforces every permission on its own routes.
 * A staff session that has not passed 2FA is kept, but the portal sends it to /two-factor first.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<StaffUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [denied, setDenied] = useState(false);
  const inflight = useRef<Promise<string | null> | null>(null);

  const clear = useCallback(() => {
    setUser(null);
    setToken(null);
    setFlag(false);
  }, []);

  const signIn = useCallback(
    async (s: SessionResponse) => {
      if (!canUseAdmin(s.user.permissions ?? [])) {
        await post('/auth/logout').catch(() => undefined);
        clear();
        setDenied(true);
        return false;
      }
      setUser(s.user);
      setToken(s.accessToken);
      setDenied(false);
      setFlag(true);
      return true;
    },
    [clear],
  );

  const refresh = useCallback(() => {
    inflight.current ??= post<SessionResponse>('/auth/refresh')
      .then(async (s) => ((await signIn(s)) ? s.accessToken : null))
      .catch(() => {
        clear();
        return null;
      })
      .finally(() => {
        inflight.current = null;
      });
    return inflight.current;
  }, [signIn, clear]);

  useEffect(() => {
    let hasSession = false;
    try {
      hasSession = localStorage.getItem(FLAG) === '1';
    } catch {}
    (hasSession ? refresh() : Promise.resolve(null)).finally(() => setReady(true));
  }, [refresh]);

  // Access tokens last 15 minutes; renew a little before that while the tab is open.
  useEffect(() => {
    if (!token) return;
    const id = setTimeout(() => void refresh(), 13 * 60_000);
    return () => clearTimeout(id);
  }, [token, refresh]);

  const signOut = useCallback(async () => {
    await post('/auth/logout').catch(() => undefined);
    clear();
  }, [clear]);

  const value = useMemo(() => ({ user, token, ready, denied, signIn, signOut, refresh }), [user, token, ready, denied, signIn, signOut, refresh]);
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
export function safeNext(next: string | null | undefined, fallback = '/') {
  const path = safeRedirectPath(next, fallback);
  return path.startsWith('/login') || path.startsWith('/two-factor') ? fallback : path;
}

/** Where to go after signing in: the 2FA step first when the session still needs it. */
export function afterSignIn(user: StaffUser, next: string) {
  return needsTwoFactor(user.twoFactor) ? `/two-factor?next=${encodeURIComponent(next)}` : next;
}
