import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PERMS, type TwoFactorState } from '@biznexa/types';
import { ApiProvider } from '@biznexa/api-client/react';
import type { SessionResponse, StaffUser } from '@/lib/auth';
import { TwoFactorForm } from './two-factor-form';

const auth = vi.hoisted(() => ({
  user: null as StaffUser | null,
  ready: true,
  signIn: vi.fn<(s: SessionResponse) => Promise<boolean>>(() => Promise.resolve(true)),
  signOut: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  useAuth: () => auth,
}));
const nav = vi.hoisted(() => ({ replace: vi.fn(), next: '/services' as string | null }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: nav.replace }),
  useSearchParams: () => new URLSearchParams(nav.next ? { next: nav.next } : {}),
}));

const staff = (twoFactor: TwoFactorState): StaffUser => ({
  id: 'u1',
  name: 'Asha Admin',
  email: 'asha@biznexa.in',
  mobile: null,
  avatarUrl: null,
  roles: ['ADMIN'],
  permissions: [PERMS.ADMIN_ACCESS],
  twoFactor,
});
const SETUP = { secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP', otpauthUrl: 'otpauth://totp/x', qrDataUrl: 'data:image/png;base64,AAAA' };
const verified = { accessToken: 'verified', user: staff({ required: true, enabled: true, verified: true }) };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
let calls: { path: string; body: unknown }[];
let reply: (path: string, body: unknown) => Response;

function renderForm() {
  return render(
    <ApiProvider token="pending" refresh={() => Promise.resolve(null)}>
      <TwoFactorForm />
    </ApiProvider>,
  );
}

function submitCode(code: string) {
  fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: code } });
  fireEvent.click(screen.getByRole('button', { name: /continue/i }));
}

beforeEach(() => {
  auth.ready = true;
  auth.signIn.mockClear();
  auth.signOut.mockClear();
  nav.replace.mockClear();
  nav.next = '/services';
  calls = [];
  reply = (path) => (path.endsWith('/setup') ? json(SETUP) : json(verified));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (req: Request) => {
      const path = new URL(req.url).pathname;
      const text = await req.text();
      const body = text ? JSON.parse(text) : undefined;
      calls.push({ path, body });
      return reply(path, body);
    }),
  );
});

describe('TwoFactorForm', () => {
  it('first login: shows the QR code and key, turns 2FA on with the code and continues', async () => {
    auth.user = staff({ required: true, enabled: false, verified: false });
    renderForm();
    expect(screen.getByRole('heading', { name: 'Set up two-factor authentication' })).toBeTruthy();
    const qr = await screen.findByAltText('QR code for setting up two-factor authentication');
    expect(qr.getAttribute('src')).toBe(SETUP.qrDataUrl);
    expect(screen.getByLabelText('Setup key').textContent).toBe('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP');

    submitCode('123456');
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/services'));
    expect(calls).toEqual([
      { path: '/api/auth/2fa/setup', body: undefined },
      { path: '/api/auth/2fa/enable', body: { code: '123456' } },
    ]);
    expect(auth.signIn).toHaveBeenCalledWith(verified);
  });

  it('shows a wrong code on the field and stays on the page', async () => {
    auth.user = staff({ required: true, enabled: true, verified: false });
    const message = 'That code is not right. Check your authenticator app and try again.';
    reply = () => json({ statusCode: 400, message, errors: [{ field: 'code', message }] }, 400);
    renderForm();
    expect(screen.getByRole('heading', { name: 'Enter your security code' })).toBeTruthy();
    expect(screen.queryByAltText(/QR code/)).toBeNull();

    submitCode('000000');
    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.getByLabelText('6-digit code').getAttribute('aria-invalid')).toBe('true');
    expect(calls.map((c) => c.path)).toEqual(['/api/auth/2fa/verify']);
    expect(auth.signIn).not.toHaveBeenCalled();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it('later logins: verifies the code and continues', async () => {
    auth.user = staff({ required: true, enabled: true, verified: false });
    renderForm();
    submitCode('654321');
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/services'));
    expect(calls).toEqual([{ path: '/api/auth/2fa/verify', body: { code: '654321' } }]);
  });

  it('reports a lock-out without a field error', async () => {
    auth.user = staff({ required: true, enabled: true, verified: false });
    reply = () => json({ statusCode: 429, message: 'Too many wrong codes. Try again after 15 minutes.' }, 429);
    renderForm();
    submitCode('111111');
    expect(await screen.findByText('Too many wrong codes. Try again after 15 minutes.')).toBeTruthy();
  });

  it('lets the QR code be fetched again after an error', async () => {
    auth.user = staff({ required: true, enabled: false, verified: false });
    let fail = true;
    reply = () => (fail ? json({ statusCode: 500, message: 'Something went wrong' }, 500) : json(SETUP));
    renderForm();
    expect(await screen.findByText('Something went wrong')).toBeTruthy();
    expect((screen.getByRole('button', { name: /turn on/i }) as HTMLButtonElement).disabled).toBe(true);
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByAltText('QR code for setting up two-factor authentication')).toBeTruthy();
  });

  it('sends people without a session to login, and verified sessions straight on', async () => {
    auth.user = null;
    const { unmount } = renderForm();
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/login'));
    unmount();

    nav.replace.mockClear();
    nav.next = '/two-factor';
    auth.user = verified.user;
    renderForm();
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/')); // never loops back to itself
    expect(calls).toEqual([]);
  });

  it('logs out to switch account', async () => {
    auth.user = staff({ required: true, enabled: true, verified: false });
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: 'Log out and use another account' }));
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/login'));
    expect(auth.signOut).toHaveBeenCalled();
  });
});
