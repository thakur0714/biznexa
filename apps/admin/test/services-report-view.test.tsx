import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ServicesReportView } from '../src/app/(portal)/reports/services/services-view';

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
  usePathname: () => '/reports/services',
}));

const sampleServicesData = {
  range: {
    from: '2026-10-10T18:30:00.000Z',
    to: '2026-10-17T18:29:59.999Z',
    preset: 'last 7 days',
  },
  summary: {
    totalOrders: 15,
    totalRevenue: 7500000, // ₹75,000
    avgTurnaroundDays: 3.2,
    totalSlaBreaches: 2,
  },
  popularServices: [
    {
      serviceId: 'svc-pvt-ltd',
      serviceName: 'Private Limited Company',
      categoryName: 'Company Registration',
      orders: 10,
      revenue: 5000000,
      avgTurnaroundDays: 3.5,
      slaBreaches: 2,
    },
    {
      serviceId: 'svc-gst',
      serviceName: 'GST Registration',
      categoryName: 'Taxation',
      orders: 5,
      revenue: 2500000,
      avgTurnaroundDays: 2.1,
      slaBreaches: 0,
    },
  ],
  applicationsByStatus: [
    {
      status: 'COMPLETED',
      label: 'Completed',
      count: 10,
    },
    {
      status: 'IN_PROGRESS',
      label: 'In Progress',
      count: 5,
    },
  ],
  slaBreaches: [
    {
      serviceId: 'svc-pvt-ltd',
      serviceName: 'Private Limited Company',
      categoryName: 'Company Registration',
      breachCount: 2,
    },
  ],
};

describe('Admin Services Report View (M10.5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserPermissions = ['admin.access', 'reports.view'];
    mockGet.mockResolvedValue(sampleServicesData);
  });

  it('renders access denied notice if user lacks reports.view permission', () => {
    mockUserPermissions = ['admin.access'];
    render(<ServicesReportView />);

    expect(screen.getByText(/Access Denied/i)).toBeInTheDocument();
    expect(screen.getByText(/reports.view/i)).toBeInTheDocument();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('fetches and renders summary KPI cards with exact metrics', async () => {
    render(<ServicesReportView />);

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/api/admin/reports/services', {
        params: { query: { preset: 'last 7 days' } },
      });
    });

    // Check KPI Cards
    expect(screen.getByText('Total Orders')).toBeInTheDocument();
    expect(screen.getByText('15')).toBeInTheDocument();

    expect(screen.getByText('Total Revenue')).toBeInTheDocument();
    expect(screen.getByText('₹75,000')).toBeInTheDocument();

    expect(screen.getAllByText('Avg Turnaround')[0]).toBeInTheDocument();
    expect(screen.getByText('3.2 d')).toBeInTheDocument();

    expect(screen.getAllByText('SLA Breaches')[0]).toBeInTheDocument();
    expect(screen.getAllByText('2')[0]).toBeInTheDocument();
  });



  it('renders popular services table with rankings, revenue and turnaround', async () => {
    render(<ServicesReportView />);

    await waitFor(() => {
      expect(screen.getAllByText('Private Limited Company')[0]).toBeInTheDocument();
    });

    expect(screen.getByText('GST Registration')).toBeInTheDocument();
    expect(screen.getByText('₹50,000')).toBeInTheDocument();
    expect(screen.getByText('₹25,000')).toBeInTheDocument();
    expect(screen.getByText('3.5 d')).toBeInTheDocument();
    expect(screen.getByText('2.1 d')).toBeInTheDocument();
  });


  it('renders applications by status and SLA breaches per service', async () => {
    render(<ServicesReportView />);

    await waitFor(() => {
      expect(screen.getByText('Applications by Status')).toBeInTheDocument();
    });

    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getByText('10 (67%)')).toBeInTheDocument();
    expect(screen.getByText('In Progress')).toBeInTheDocument();
    expect(screen.getByText('5 (33%)')).toBeInTheDocument();

    expect(screen.getByText('SLA Breaches per Service')).toBeInTheDocument();
    expect(screen.getByText('2 breached')).toBeInTheDocument();
  });

  it('changes preset when filter button is clicked and refetches', async () => {
    render(<ServicesReportView />);

    await waitFor(() => {
      expect(screen.getByText('15')).toBeInTheDocument();
    });

    const thisMonthBtn = screen.getByRole('button', { name: 'This Month' });
    fireEvent.click(thisMonthBtn);

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/api/admin/reports/services', {
        params: { query: { preset: 'this month' } },
      });
    });
  });

  it('renders empty state when there are zero orders and no applications', async () => {
    mockGet.mockResolvedValue({
      range: sampleServicesData.range,
      summary: {
        totalOrders: 0,
        totalRevenue: 0,
        avgTurnaroundDays: 0,
        totalSlaBreaches: 0,
      },
      popularServices: [],
      applicationsByStatus: [],
      slaBreaches: [],
    });

    render(<ServicesReportView />);

    await waitFor(() => {
      expect(screen.getByText(/No service records for this period/i)).toBeInTheDocument();
    });
  });
});
