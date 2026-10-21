import { cleanup, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { ClientApiError } from './browser';
import { ApiProvider, createBrowserApi, useApi, type Api } from './react';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Every request the client sent: path and the bearer token it carried. */
let sent: { path: string; auth: string | null }[];
let reply: (req: Request) => Response | Promise<Response>;

beforeEach(() => {
  sent = [];
  reply = () => json({ ok: true });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (req: Request) => {
      sent.push({ path: new URL(req.url).pathname, auth: req.headers.get('authorization') });
      return reply(req);
    }),
  );
});
afterEach(cleanup);

const categories = (api: Api) => api.call((c) => c.GET('/api/admin/catalogue/categories'));

describe('createBrowserApi', () => {
  it('returns the body and sends the current token, none when signed out', async () => {
    let token: string | null = 'abc';
    const api = createBrowserApi({ getToken: () => token, refresh: vi.fn() });
    expect(await categories(api)).toEqual({ ok: true });
    token = null;
    await categories(api);
    expect(sent).toEqual([
      { path: '/api/admin/catalogue/categories', auth: 'Bearer abc' },
      { path: '/api/admin/catalogue/categories', auth: null },
    ]);
  });

  it('renews an expired token once and repeats the request with the new one', async () => {
    const refresh = vi.fn(() => Promise.resolve('fresh'));
    reply = (req) => (req.headers.get('authorization') === 'Bearer old' ? json({ message: 'Please log in' }, 401) : json({ ok: true }));
    // The session still reports the old token: React has not re-rendered the provider yet.
    const api = createBrowserApi({ getToken: () => 'old', refresh });
    expect(await categories(api)).toEqual({ ok: true });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(sent.map((s) => s.auth)).toEqual(['Bearer old', 'Bearer fresh']);
    await categories(api); // and keeps using it until the session catches up
    expect(sent[2].auth).toBe('Bearer fresh');
  });

  it('reports a 401 when the session cannot be renewed, or when no token was sent', async () => {
    reply = () => json({ message: 'Please log in' }, 401);
    const refresh = vi.fn(() => Promise.resolve(null));
    await expect(categories(createBrowserApi({ getToken: () => 'old', refresh }))).rejects.toMatchObject({ status: 401, message: 'Please log in' });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(1);

    const anonymousRefresh = vi.fn();
    await expect(categories(createBrowserApi({ getToken: () => null, refresh: anonymousRefresh }))).rejects.toBeInstanceOf(ClientApiError);
    expect(anonymousRefresh).not.toHaveBeenCalled();
  });

  it('turns error bodies into ClientApiError with field errors and retry time', async () => {
    reply = () => json({ message: 'Please check the highlighted fields', errors: [{ field: 'slug', message: 'Taken' }], retryAfter: 30 }, 409);
    const err = await categories(createBrowserApi({ getToken: () => null, refresh: vi.fn() })).catch((e: ClientApiError) => e);
    expect(err).toBeInstanceOf(ClientApiError);
    expect(err).toMatchObject({ status: 409, message: 'Please check the highlighted fields', retryAfter: 30 });
    expect((err as ClientApiError).fieldError('slug')).toBe('Taken');

    reply = () => new Response('<html>Bad gateway</html>', { status: 502 });
    await expect(categories(createBrowserApi({ getToken: () => null, refresh: vi.fn() }))).rejects.toMatchObject({ status: 502, message: 'Something went wrong. Please try again.' });
  });

  it('says so when the API cannot be reached', async () => {
    reply = () => Promise.reject(new TypeError('Failed to fetch'));
    await expect(categories(createBrowserApi({ getToken: () => null, refresh: vi.fn() }))).rejects.toMatchObject({
      status: 0,
      message: 'Could not reach BizNexa. Check your internet connection and try again.',
    });
  });
});

describe('ApiProvider / useApi', () => {
  it('keeps one client across token changes and sends the latest token', async () => {
    const refresh = vi.fn(() => Promise.resolve(null));
    let token: string | null = 'first';
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ApiProvider token={token} refresh={refresh}>
        {children}
      </ApiProvider>
    );
    const { result, rerender } = renderHook(() => useApi(), { wrapper });
    const before = result.current;
    await categories(before);

    token = 'second';
    rerender();
    expect(result.current).toBe(before); // pages that depend on `api` do not reload when the token is renewed
    await categories(result.current);

    token = null;
    rerender();
    await categories(result.current);
    expect(sent.map((s) => s.auth)).toEqual(['Bearer first', 'Bearer second', null]);
  });

  it('explains a missing provider', () => {
    const Orphan = () => {
      useApi();
      return null;
    };
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Orphan />)).toThrow(/inside <ApiProvider>/);
  });
});
