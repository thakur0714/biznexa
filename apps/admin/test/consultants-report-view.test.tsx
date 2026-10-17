import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ConsultantsReportView } from '../src/app/(portal)/reports/consultants/consultants-view';

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
  usePathname: () => '/reports/consultants',
}));

const sampleConsultantsData = {
  range: {
    from: '2026-10-10T18:30:00.000Z',
    to: '2026-10-17T18:29:59.999Z',
    preset: 'last 7 days',
  },
  summary: {
    total: 20,
    active: 16,
    bookingsCount: 45,
    bookingRevenue: 22500000, // ₹2,25,000
    averageRating: 4.8,
  },
  byVerificationStatus: [
    { status: 'APPROVED', label: 'Approved', count: 16 },
    { status: 'PENDING', label: 'Pending Review', count: 3 },
    { status: 'REJECTED', label: 'Rejected', count: 1 },
  ],
  consultants: [
    {
      consultantId: 'c-1',
      name: 'Dr. Ramesh Kumar',
      slug: 'dr-ramesh-kumar',
      category: 'CA',
      verificationStatus: 'APPROVED',
      rating: 4.9,
      reviewCount: 30,
      bookingsCount: 25,
      bookingRevenue: 12500000,
    },
    {
      consultantId: 'c-2',
      name: 'Adv. Sneha Roy',
      slug: 'adv-sneha-roy',
      category: 'LAWYER',
      verificationStatus: 'APPROVED',
      rating: 4.7,
      reviewCount: 15,
      bookingsCount: 20,
      bookingRevenue: 10000000,
    },
  ],
};

describe('Admin Consultants Report View (M10.6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserPermissions = ['admin.access', 'reports.view'];
    mockGet.mockResolvedValue(sampleConsultantsData);
  });

  it('renders access denied notice if user lacks reports.view permission', () => {
    mockUserPermissions = ['admin.access'];
    render(<ConsultantsReportView />);

    expect(screen.getByText(/Access Denied/i)).toBeInTheDocument();
    expect(screen.getByText(/reports.view/i)).toBeInTheDocument();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('fetches and renders summary KPI cards with exact numbers', async () => {
    render(<ConsultantsReportView />);

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/api/admin/reports/consultants', {
        params: { query: { preset: 'last 7 days' } },
      });
    });

    expect(screen.getByText('Total Consultants')).toBeInTheDocument();
    expect(screen.getAllByText('20')[0]).toBeInTheDocument();

    expect(screen.getByText('Active Experts')).toBeInTheDocument();
    expect(screen.getAllByText('16')[0]).toBeInTheDocument();

    expect(screen.getByText('Bookings Count')).toBeInTheDocument();
    expect(screen.getByText('45')).toBeInTheDocument();

    expect(screen.getByText('Booking Revenue')).toBeInTheDocument();
    expect(screen.getByText('₹2,25,000')).toBeInTheDocument();

    expect(screen.getByText('Average Rating')).toBeInTheDocument();
    expect(screen.getByText('★ 4.8')).toBeInTheDocument();
  });

  it('renders verification status breakdown and consultants list', async () => {
    render(<ConsultantsReportView />);

    await waitFor(() => {
      expect(screen.getByText('Verification Status Breakdown')).toBeInTheDocument();
    });

    expect(screen.getByText('Dr. Ramesh Kumar')).toBeInTheDocument();
    expect(screen.getByText('Adv. Sneha Roy')).toBeInTheDocument();
    expect(screen.getByText('₹1,25,000')).toBeInTheDocument();
    expect(screen.getByText('₹1,00,000')).toBeInTheDocument();
  });

  it('changes preset and calls API on filter button click', async () => {
    render(<ConsultantsReportView />);

    await waitFor(() => {
      expect(screen.getAllByText('20')[0]).toBeInTheDocument();
    });

    const todayBtn = screen.getByRole('button', { name: 'Today' });
    fireEvent.click(todayBtn);

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/api/admin/reports/consultants', {
        params: { query: { preset: 'today' } },
      });
    });
  });

  it('renders empty state when there are 0 consultants', async () => {
    mockGet.mockResolvedValue({
      range: sampleConsultantsData.range,
      summary: {
        total: 0,
        active: 0,
        bookingsCount: 0,
        bookingRevenue: 0,
        averageRating: 0,
      },
      byVerificationStatus: [],
      consultants: [],
    });

    render(<ConsultantsReportView />);

    await waitFor(() => {
      expect(screen.getByText(/No consultants found/i)).toBeInTheDocument();
    });
  });
});
