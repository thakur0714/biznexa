import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import DashboardPage from '../src/app/(portal)/page';

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

const sampleDashboardData = {
  range: {
    from: '2026-10-10T18:30:00.000Z',
    to: '2026-10-17T18:29:59.999Z',
    preset: 'last 7 days',
  },
  kpis: {
    revenue: 12500000, // ₹1,25,000 in paise
    orders: 45,
    newCustomers: 18,
    activeApplications: 12,
  },
  series: [
    { date: '2026-10-16', revenue: 5000000, orders: 20 },
    { date: '2026-10-17', revenue: 7500000, orders: 25 },
  ],
  needsAttention: {
    slaBreaches: [
      {
        id: 'app-sla-1',
        code: 'BN10025',
        serviceName: 'GST Registration',
        customerName: 'Aarav Patel',
        slaDueAt: '2026-10-15T10:00:00.000Z',
        status: 'IN_PROGRESS',
        link: '/applications/app-sla-1',
      },
    ],
    waitingDocuments: [
      {
        id: 'doc-wait-1',
        applicationId: 'app-sla-1',
        applicationCode: 'BN10025',
        serviceName: 'GST Registration',
        documentName: 'Electricity Bill',
        uploadedAt: '2026-10-14T08:00:00.000Z',
        link: '/documents',
      },
    ],
  },
};

describe('Admin Dashboard Home Page (M10.2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserPermissions = ['admin.access', 'reports.view'];
    mockGet.mockResolvedValue(sampleDashboardData);
  });

  it('renders KPI cards with Indian rupee formatting and number counts', async () => {
    render(<DashboardPage />);

    expect(screen.getByText('Welcome, Admin')).toBeInTheDocument();

    await waitFor(() => {
      // ₹1,25,000 formatted with ₹ symbol
      expect(screen.getByText(/1,25,000/)).toBeInTheDocument();
      expect(screen.getByText('45')).toBeInTheDocument();
      expect(screen.getByText('18')).toBeInTheDocument();
      expect(screen.getByText('12')).toBeInTheDocument();
    });

    expect(screen.getAllByText('Revenue')[0]).toBeInTheDocument();
    expect(screen.getAllByText('Orders')[0]).toBeInTheDocument();
    expect(screen.getByText('New Customers')).toBeInTheDocument();
    expect(screen.getByText('Active Applications')).toBeInTheDocument();
  });

  it('renders Needs Attention section with SLA breach and waiting document details', async () => {
    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('BN10025')).toBeInTheDocument();
      expect(screen.getByText('Customer: Aarav Patel')).toBeInTheDocument();
      expect(screen.getByText('Electricity Bill')).toBeInTheDocument();
    });

    const slaLink = screen.getAllByRole('link', { name: /BN10025/ })[0];
    expect(slaLink).toHaveAttribute('href', '/applications/app-sla-1');
  });

  it('switches preset on button click and fetches new data', async () => {
    render(<DashboardPage />);

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith(
        '/api/admin/reports/dashboard',
        expect.objectContaining({ params: { query: { preset: 'last 7 days' } } }),
      );
    });

    const todayBtn = screen.getByRole('button', { name: 'Today' });
    fireEvent.click(todayBtn);

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith(
        '/api/admin/reports/dashboard',
        expect.objectContaining({ params: { query: { preset: 'today' } } }),
      );
    });
  });

  it('renders error notice and allows retry on fetch error', async () => {
    mockGet.mockRejectedValue(new Error('Network Error'));
    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('Network Error')).toBeInTheDocument();
    });

    mockGet.mockResolvedValue(sampleDashboardData);
    const retryBtn = screen.getByRole('button', { name: 'Retry' });
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.getByText(/1,25,000/)).toBeInTheDocument();
    });
  });

  it('hides reports KPI cards for staff without reports.view permission', () => {
    mockUserPermissions = ['admin.access'];
    render(<DashboardPage />);

    expect(screen.getByText('Welcome, Admin')).toBeInTheDocument();
    expect(screen.queryByText('Revenue')).not.toBeInTheDocument();
    expect(screen.queryByText('Needs Attention')).not.toBeInTheDocument();
    expect(mockGet).not.toHaveBeenCalled();
  });
});
