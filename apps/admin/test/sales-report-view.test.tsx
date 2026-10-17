import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { SalesReportView } from '../src/app/(portal)/reports/sales/sales-view';

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
  usePathname: () => '/reports/sales',
}));

const sampleSalesData = {
  range: {
    from: '2026-10-10T18:30:00.000Z',
    to: '2026-10-17T18:29:59.999Z',
    preset: 'last 7 days',
  },
  total: {
    revenue: 15000000, // ₹1,50,000
    orders: 30,
    discountTotal: 150000, // ₹1,500
    refundTotal: 250000, // ₹2,500
  },
  monthly: [
    {
      month: '2026-10',
      label: 'October 2026',
      revenue: 15000000,
      orders: 30,
    },
  ],
  serviceWise: [
    {
      serviceId: 'svc-gst',
      serviceName: 'GST Registration',
      categoryName: 'Taxation',
      orders: 20,
      revenue: 10000000,
    },
    {
      serviceId: 'svc-fssai',
      serviceName: 'FSSAI License',
      categoryName: 'Licenses',
      orders: 10,
      revenue: 5000000,
    },
  ],
  categoryWise: [
    {
      categoryId: 'cat-tax',
      categoryName: 'Taxation',
      orders: 20,
      revenue: 10000000,
    },
    {
      categoryId: 'cat-lic',
      categoryName: 'Licenses',
      orders: 10,
      revenue: 5000000,
    },
  ],
  couponImpact: {
    discountGiven: 150000,
    ordersWithCoupon: 5,
    coupons: [
      {
        code: 'WELCOME10',
        type: 'PERCENTAGE',
        ordersCount: 5,
        discountGiven: 150000,
      },
    ],
  },
};

describe('Admin Sales Report View (M10.3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserPermissions = ['admin.access', 'reports.view'];
    mockGet.mockResolvedValue(sampleSalesData);
  });

  it('renders summary KPI cards, tables for monthly, service, category and coupons', async () => {
    render(<SalesReportView />);

    await waitFor(() => {
      // Net revenue ₹1,50,000 (appears in KPI card and monthly table)
      expect(screen.getAllByText('₹1,50,000')[0]).toBeInTheDocument();
      // Orders: 30
      expect(screen.getAllByText('30')[0]).toBeInTheDocument();
      // Discounts given: ₹1,500
      expect(screen.getAllByText('₹1,500')[0]).toBeInTheDocument();
      // Refunds: ₹2,500
      expect(screen.getByText('₹2,500')).toBeInTheDocument();
    });

    // Breakdown headings and contents
    expect(screen.getByText('Monthly Breakdown')).toBeInTheDocument();
    expect(screen.getByText('October 2026')).toBeInTheDocument();

    expect(screen.getByText('Service-wise Breakdown')).toBeInTheDocument();
    expect(screen.getByText('GST Registration')).toBeInTheDocument();
    expect(screen.getByText('FSSAI License')).toBeInTheDocument();

    expect(screen.getByText('Category-wise Breakdown')).toBeInTheDocument();
    expect(screen.getAllByText('Taxation')[0]).toBeInTheDocument();
    expect(screen.getAllByText('Licenses')[0]).toBeInTheDocument();

    expect(screen.getByText('Coupon Impact')).toBeInTheDocument();
    expect(screen.getByText('WELCOME10')).toBeInTheDocument();
  });

  it('switches preset on button click and fetches new data', async () => {
    render(<SalesReportView />);

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith(
        '/api/admin/reports/sales',
        expect.objectContaining({ params: { query: { preset: 'last 7 days' } } }),
      );
    });

    const monthBtn = screen.getByRole('button', { name: 'This Month' });
    fireEvent.click(monthBtn);

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith(
        '/api/admin/reports/sales',
        expect.objectContaining({ params: { query: { preset: 'this month' } } }),
      );
    });
  });

  it('renders error notice and allows retry on fetch error', async () => {
    mockGet.mockRejectedValue(new Error('Network Failure'));
    render(<SalesReportView />);

    await waitFor(() => {
      expect(screen.getByText('Network Failure')).toBeInTheDocument();
    });

    mockGet.mockResolvedValue(sampleSalesData);
    const retryBtn = screen.getByRole('button', { name: 'Retry' });
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.getAllByText('₹1,50,000')[0]).toBeInTheDocument();
    });
  });

  it('renders empty state when there are no sales in the range', async () => {
    mockGet.mockResolvedValue({
      ...sampleSalesData,
      total: { revenue: 0, orders: 0, discountTotal: 0, refundTotal: 0 },
      monthly: [],
      serviceWise: [],
      categoryWise: [],
      couponImpact: { discountGiven: 0, ordersWithCoupon: 0, coupons: [] },
    });

    render(<SalesReportView />);

    await waitFor(() => {
      expect(screen.getByText('No sales in selected period')).toBeInTheDocument();
    });
  });

  it('displays access denied when staff lacks reports.view permission', async () => {
    mockUserPermissions = ['admin.access'];
    render(<SalesReportView />);

    expect(
      screen.getByText('Access Denied: You need the reports.view permission to view sales reports.'),
    ).toBeInTheDocument();
    expect(mockGet).not.toHaveBeenCalled();
  });
});
