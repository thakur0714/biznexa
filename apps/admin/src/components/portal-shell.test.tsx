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
const nav = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => nav,
  usePathname: () => '/services',
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

beforeEach(() => nav.replace.mockClear());

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

  it('sends the login form to the 2FA step only when needed', () => {
    expect(afterSignIn(staff({ required: true, enabled: true, verified: false }), '/services')).toBe('/two-factor?next=%2Fservices');
    expect(afterSignIn(staff({ required: true, enabled: true, verified: true }), '/services')).toBe('/services');
  });
});
