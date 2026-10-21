'use client';

import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from 'react';
import { createApiClient, type ApiClient } from './index';
import { ClientApiError, type FieldError } from './browser';

/**
 * The one way browser code talks to the API (web and admin):
 *
 *   const api = useApi();
 *   const rows = await api.call((c) => c.GET('/api/admin/catalogue/services'));
 *   const session = await api.call<Session>((c) => c.POST('/api/auth/login', { body }));
 *
 * - typed by the generated OpenAPI client (D19); the type argument is only needed where the API has
 *   no response contract yet;
 * - sends the signed-in user's access token, and on a 401 renews the session once and repeats the request;
 * - returns the response body or throws `ClientApiError` (status, message, field `errors`, `retryAfter`).
 *
 * `ApiProvider` is mounted by each app's `AuthProvider`, so every client component under the root layout can
 * call `useApi()`. Server Components fetch on the server instead (apps/web/src/lib/api.ts).
 */

type Sent<T> = { data?: T; error?: unknown; response: Response };

export interface Api {
  /** Send a request with the typed client; resolves to the body, rejects with `ClientApiError`. */
  call<T>(send: (client: ApiClient) => Promise<Sent<T>>): Promise<T>;
  /** The underlying typed client, for the rare case that needs the raw `{ data, error, response }`. */
  client: ApiClient;
}

export interface ApiSession {
  /** Current access token (null when signed out). Read on every request, so it is never stale. */
  getToken: () => string | null;
  /** Renew the session; resolves to the new access token, or null when the user must sign in again. */
  refresh: () => Promise<string | null>;
}

const OFFLINE = 'Could not reach BizNexa. Check your internet connection and try again.';

/** The client behind `useApi()`. Exported for code outside React and for tests. */
export function createBrowserApi(session: ApiSession, baseUrl?: string): Api {
  // Same-origin /api rewrite (D11). An absolute base so requests also work outside a page (tests, SSR import).
  const origin = baseUrl ?? (typeof window === 'undefined' ? 'http://localhost' : window.location.origin);
  const client = createApiClient({ baseUrl: origin, credentials: 'same-origin' });
  // A renewed token is used at once, until the session reports a different token than the one it replaced
  // (React has not re-rendered the provider yet when the request is repeated).
  let renewed: { from: string; to: string } | null = null;
  const currentToken = () => {
    const t = session.getToken();
    return renewed?.from === t ? renewed.to : t;
  };
  client.use({
    onRequest({ request }) {
      const token = currentToken();
      if (token) request.headers.set('authorization', `Bearer ${token}`);
      return request;
    },
  });

  async function attempt<T>(send: (c: ApiClient) => Promise<Sent<T>>) {
    try {
      return await send(client);
    } catch {
      throw new ClientApiError(0, OFFLINE);
    }
  }

  async function call<T>(send: (c: ApiClient) => Promise<Sent<T>>): Promise<T> {
    const sentToken = currentToken();
    let res = await attempt(send);
    // Only a request that carried a token can be fixed by renewing it.
    if (res.response.status === 401 && sentToken) {
      const fresh = await session.refresh();
      if (fresh) {
        renewed = { from: sentToken, to: fresh };
        res = await attempt(send);
      }
    }
    if (!res.response.ok) {
      const body = (res.error ?? {}) as { message?: unknown; errors?: FieldError[]; retryAfter?: number };
      const message = typeof body.message === 'string' ? body.message : 'Something went wrong. Please try again.';
      throw new ClientApiError(res.response.status, message, body.errors ?? [], body.retryAfter);
    }
    return res.data as T;
  }

  return { call, client };
}

const ApiContext = createContext<Api | null>(null);

/**
 * Provides `useApi()` for the session given by `token` / `refresh`. The client is created once and reads
 * the latest token on each request, so pages do not reload their data when the token is renewed.
 */
export function ApiProvider({ token, refresh, children }: Readonly<{ token: string | null; refresh: () => Promise<string | null>; children: ReactNode }>) {
  const [state] = useState(() => { // NOSONAR: fixed for this mount; no setter needed
    const session = { token, refresh };
    return { session, api: createBrowserApi({ getToken: () => session.token, refresh: () => session.refresh() }) };
  });
  // Layout effects run before any child's useEffect, so a request started by a sign-in already sees the new token.
  useLayoutEffect(() => {
    state.session.token = token;
    state.session.refresh = refresh;
  }, [state, token, refresh]);
  return <ApiContext.Provider value={state.api}>{children}</ApiContext.Provider>;
}

export function useApi(): Api {
  const api = useContext(ApiContext);
  if (!api) throw new Error('useApi must be used inside <ApiProvider> (mounted by AuthProvider)');
  return api;
}
