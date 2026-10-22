import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DashboardLayout from './layout';
import { StaffAccountNotice } from '@/components/staff-account-notice';

const { mockUseAuth, mockApiCall, mockSignOut } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
  mockApiCall: vi.fn(),
  mockSignOut: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ useAuth: mockUseAuth }));
vi.mock('@biznexa/api-client/react', () => ({ useApi: () => ({ call: mockApiCall }) }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const staffUser = { id: 'staff-1', roles: ['ADMIN'] };
const customerUser = { id: 'customer-1', roles: ['CUSTOMER', 'ADMIN'] };

beforeEach(() => {
  mockApiCall.mockReset().mockResolvedValue({ count: 0 });
  mockSignOut.mockReset().mockResolvedValue(undefined);
  mockUseAuth.mockReset();
  mockUseAuth.mockReturnValue({ user: staffUser, ready: true, signOut: mockSignOut });
});

describe('staff customer access', () => {
  it('shows the staff notice and does not mount dashboard customer pages or call their APIs', () => {
    render(
      <DashboardLayout>
        <div>Customer dashboard page</div>
      </DashboardLayout>,
    );

    expect(screen.getByText('This is a staff account. Customer pages are not available here. Please use the admin portal.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.queryByText('Customer dashboard page')).not.toBeInTheDocument();
    expect(mockApiCall).not.toHaveBeenCalled();
  });

  it('shows the customer dashboard for a user who has the CUSTOMER role', () => {
    mockUseAuth.mockReturnValue({ user: customerUser, ready: true, signOut: mockSignOut });

    render(
      <DashboardLayout>
        <div>Customer dashboard page</div>
      </DashboardLayout>,
    );

    expect(screen.getByText('Customer dashboard page')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Account' })).toBeInTheDocument();
    expect(screen.queryByText(/This is a staff account/)).not.toBeInTheDocument();
  });

  it('shows the admin portal link only when NEXT_PUBLIC_ADMIN_URL is configured', () => {
    const originalUrl = process.env.NEXT_PUBLIC_ADMIN_URL;
    process.env.NEXT_PUBLIC_ADMIN_URL = 'https://admin.example.com';
    const withAdminUrl = render(<StaffAccountNotice />);
    expect(screen.getByRole('link', { name: 'Open admin portal' })).toHaveAttribute('href', 'https://admin.example.com');
    withAdminUrl.unmount();

    delete process.env.NEXT_PUBLIC_ADMIN_URL;
    render(<StaffAccountNotice />);
    expect(screen.queryByRole('link', { name: 'Open admin portal' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(mockSignOut).toHaveBeenCalledOnce();

    if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_ADMIN_URL;
    else process.env.NEXT_PUBLIC_ADMIN_URL = originalUrl;
  });
});
