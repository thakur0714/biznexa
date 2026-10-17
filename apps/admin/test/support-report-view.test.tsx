import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { SupportReportView } from '../src/app/(portal)/reports/support/support-view';

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
  usePathname: () => '/reports/support',
}));

const sampleSupportData = {
  range: {
    from: '2026-10-10T18:30:00.000Z',
    to: '2026-10-17T18:29:59.999Z',
    preset: 'last 7 days',
  },
  summary: {
    totalTickets: 25,
    openTickets: 5,
    resolvedTickets: 20,
    avgFirstResponseHours: 1.5,
    avgResolutionHours: 8.5,
  },
  byStatus: [
    { status: 'RESOLVED', label: 'Resolved', count: 18 },
    { status: 'IN_PROGRESS', label: 'In Progress', count: 4 },
    { status: 'CLOSED', label: 'Closed', count: 2 },
    { status: 'OPEN', label: 'Open', count: 1 },
  ],
  recentTickets: [
    {
      id: 't-1',
      code: 'TICK-101',
      subject: 'Delay in DIN approval',
      status: 'RESOLVED',
      priority: 'HIGH',
      customerName: 'Ananya Roy',
      assignedToName: 'Staff Mohan',
      createdAt: '2026-10-12T10:00:00.000Z',
      firstResponseAt: '2026-10-12T11:30:00.000Z',
      resolvedAt: '2026-10-12T18:30:00.000Z',
      firstResponseHours: 1.5,
      resolutionHours: 8.5,
    },
  ],
};

describe('Admin Support Report View (M10.7)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserPermissions = ['admin.access', 'reports.view'];
    mockGet.mockResolvedValue(sampleSupportData);
  });

  it('renders access denied notice if user lacks reports.view permission', () => {
    mockUserPermissions = ['admin.access'];
    render(<SupportReportView />);

    expect(screen.getByText(/Access Denied/i)).toBeInTheDocument();
    expect(screen.getByText(/reports.view/i)).toBeInTheDocument();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('fetches and renders summary KPI cards with exact numbers', async () => {
    render(<SupportReportView />);

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/api/admin/reports/support', {
        params: { query: { preset: 'last 7 days' } },
      });
    });

    expect(screen.getByText('Total Tickets')).toBeInTheDocument();
    expect(screen.getByText('25')).toBeInTheDocument();

    expect(screen.getByText('Open Tickets')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();

    expect(screen.getByText('Resolved Tickets')).toBeInTheDocument();
    expect(screen.getByText('20')).toBeInTheDocument();

    expect(screen.getByText('Avg First Response')).toBeInTheDocument();
    expect(screen.getAllByText('1.5h')[0]).toBeInTheDocument();

    expect(screen.getByText('Avg Resolution Time')).toBeInTheDocument();
    expect(screen.getAllByText('8.5h')[0]).toBeInTheDocument();
  });

  it('renders status breakdown and recent tickets list', async () => {
    render(<SupportReportView />);

    await waitFor(() => {
      expect(screen.getByText('Tickets by Status Breakdown')).toBeInTheDocument();
    });

    expect(screen.getByText('Delay in DIN approval')).toBeInTheDocument();
    expect(screen.getByText('Ananya Roy')).toBeInTheDocument();
    expect(screen.getByText('TICK-101')).toBeInTheDocument();
  });

  it('changes preset and calls API on filter button click', async () => {
    render(<SupportReportView />);

    await waitFor(() => {
      expect(screen.getByText('25')).toBeInTheDocument();
    });

    const todayBtn = screen.getByRole('button', { name: 'Today' });
    fireEvent.click(todayBtn);

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/api/admin/reports/support', {
        params: { query: { preset: 'today' } },
      });
    });
  });

  it('renders empty state when there are 0 tickets', async () => {
    mockGet.mockResolvedValue({
      range: sampleSupportData.range,
      summary: {
        totalTickets: 0,
        openTickets: 0,
        resolvedTickets: 0,
        avgFirstResponseHours: 0,
        avgResolutionHours: 0,
      },
      byStatus: [],
      recentTickets: [],
    });

    render(<SupportReportView />);

    await waitFor(() => {
      expect(screen.getByText(/No tickets found/i)).toBeInTheDocument();
    });
  });
});
