import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { CustomersReportView } from '../src/app/(portal)/reports/customers/customers-view';

const mockGet = vi.fn();
let mockUserPermissions = ['admin.access', 'reports.view'];

const mockCall = vi.fn((cb: unknown) =>
  (cb as (api: { GET: typeof mockGet }) => unknown)({ GET: mockGet }),
);

vi.mock('@biznexa/api-client/react', () => ({
  useApi: () => ({
    call: mockCall,
  }),
}));

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    user: {
      id: 'staff-admin',
      name: 'Admin Boss',
      email: 'boss@example.com',
      roles: ['ADMIN'],
      permissions: mockUserPermissions,
    },
  }),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/reports/customers',
}));

const sampleCustomerData = {
  range: {
    from: '2026-10-10T18:30:00.000Z',
    to: '2026-10-17T18:29:59.999Z',
    preset: 'last 7 days',
  },
  total: 500,
  newInRange: 45,
  activeLast90Days: 250,
};

describe('Admin Customers Report View (M10.4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserPermissions = ['admin.access', 'reports.view'];
    mockGet.mockResolvedValue(sampleCustomerData);
  });

  it('renders Total, New in range, and Active in last 90 days KPI cards', async () => {
    render(<CustomersReportView />);

    await waitFor(() => {
      expect(screen.getByText('500')).toBeInTheDocument();
      expect(screen.getByText('45')).toBeInTheDocument();
      expect(screen.getByText('250')).toBeInTheDocument();
    });

    expect(screen.getByText('Total Customers')).toBeInTheDocument();
    expect(screen.getByText('New Customers')).toBeInTheDocument();
    expect(screen.getByText('Active in Last 90 Days')).toBeInTheDocument();

    // Engagement rate: (250 / 500) * 100 = 50%
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open Customer Directory/ })).toHaveAttribute(
      'href',
      '/customers',
    );
  });

  it('switches preset on button click and fetches new data', async () => {
    render(<CustomersReportView />);

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith(
        '/api/admin/reports/customers',
        expect.objectContaining({ params: { query: { preset: 'last 7 days' } } }),
      );
    });

    const monthBtn = screen.getByRole('button', { name: 'Last Month' });
    fireEvent.click(monthBtn);

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith(
        '/api/admin/reports/customers',
        expect.objectContaining({ params: { query: { preset: 'last month' } } }),
      );
    });
  });

  it('renders error notice and allows retry on fetch error', async () => {
    mockGet.mockRejectedValue(new Error('Fetch Error'));
    render(<CustomersReportView />);

    await waitFor(() => {
      expect(screen.getByText('Fetch Error')).toBeInTheDocument();
    });

    mockGet.mockResolvedValue(sampleCustomerData);
    const retryBtn = screen.getByRole('button', { name: 'Retry' });
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.getByText('500')).toBeInTheDocument();
    });
  });

  it('displays access denied when staff lacks reports.view permission', () => {
    mockUserPermissions = ['admin.access'];
    render(<CustomersReportView />);

    expect(
      screen.getByText('Access Denied: You need the reports.view permission to view customer reports.'),
    ).toBeInTheDocument();
    expect(mockGet).not.toHaveBeenCalled();
  });
});
