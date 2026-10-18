import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PERMS, type TwoFactorState } from '@biznexa/types';
import { afterSignIn, type StaffUser } from '@/lib/auth';
import { PortalShell } from './portal-shell';

const auth = vi.hoisted(() => ({ user: null as StaffUser | null, ready: true, signOut: vi.fn() }));
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth')>()),
  useAuth: () => auth,
}));
const nav = vi.hoisted(() => ({ replace: vi.fn(), pathname: '/services' }));
vi.mock('next/navigation', () => ({
  useRouter: () => nav,
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams('status=inactive'),
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

beforeEach(() => { nav.replace.mockClear(); nav.pathname = '/services'; });

describe('PortalShell two-factor gate', () => {
  it('sends a staff session that has not passed 2FA to the 2FA step, keeping the page to return to', async () => {
    auth.user = staff({ required: true, enabled: false, verified: false });
    render(<PortalShell>secret page</PortalShell>);
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith(`/two-factor?next=${encodeURIComponent('/services?status=inactive')}`));
    expect(screen.queryByText('secret page')).toBeNull();
  });

  it('shows the portal once 2FA is verified', () => {
    auth.user = staff({ required: true, enabled: true, verified: true });
    render(<PortalShell>secret page</PortalShell>);
    expect(screen.getByText('secret page')).toBeTruthy();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it('redirects consultants from other admin routes and shows only consultant portal navigation', async () => {
    auth.user = { ...staff({ required: true, enabled: true, verified: true }), roles: ['CONSULTANT'], permissions: [PERMS.ADMIN_ACCESS, PERMS.APPLICATIONS_VIEW_ASSIGNED] };
    render(<PortalShell>admin route</PortalShell>);
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/consultant/bookings'));
    expect(screen.queryByText('admin route')).toBeNull();

    nav.pathname = '/consultant/profile';
    nav.replace.mockClear();
    render(<PortalShell>consultant route</PortalShell>);
    expect(screen.getByText('consultant route')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'My profile' }).getAttribute('href')).toBe('/consultant/profile');
    expect(screen.getByRole('link', { name: 'Availability' }).getAttribute('href')).toBe('/consultant/availability');
    expect(screen.queryByRole('link', { name: 'Applications' })).toBeNull();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it('sends the login form to the 2FA step only when needed', () => {
    expect(afterSignIn(staff({ required: true, enabled: true, verified: false }), '/services')).toBe('/two-factor?next=%2Fservices');
    expect(afterSignIn(staff({ required: true, enabled: true, verified: true }), '/services')).toBe('/services');
  });
});
