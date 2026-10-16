import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SupportView, formatDuration, getSlaInfo } from '../src/app/(portal)/support/support-view';

const mockGet = vi.fn();
const mockPatch = vi.fn();
const mockPost = vi.fn();

let mockPermissions = ['tickets.manage'];

vi.mock('@biznexa/api-client/react', () => ({
  useApi: () => ({
    call: (cb: (api: { GET: typeof mockGet; PATCH: typeof mockPatch; POST: typeof mockPost }) => unknown) =>
      cb({ GET: mockGet, PATCH: mockPatch, POST: mockPost }),
  }),
}));

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    user: {
      id: 'staff-1',
      name: 'Support Agent',
      email: 'support@biznexa.in',
      permissions: mockPermissions,
    },
  }),
}));

describe('Support View SLA helper', () => {
  it('formats durations accurately', () => {
    const t0 = new Date('2026-10-16T10:00:00Z');
    const t1 = new Date('2026-10-16T10:45:00Z');
    expect(formatDuration(t0, t1)).toBe('45m');

    const t2 = new Date('2026-10-16T12:30:00Z');
    expect(formatDuration(t0, t2)).toBe('2h 30m');

    const t3 = new Date('2026-10-18T14:00:00Z');
    expect(formatDuration(t0, t3)).toBe('2d 4h');
  });

  it('calculates SLA info for responded vs unresponded tickets', () => {
    const created = '2026-10-16T10:00:00Z';
    const replied = '2026-10-16T10:30:00Z';

    const slaResponded = getSlaInfo(created, replied, 'IN_PROGRESS');
    expect(slaResponded.tone).toBe('success');
    expect(slaResponded.label).toContain('First reply: 30m');

    const slaClosedNoReply = getSlaInfo(created, null, 'CLOSED');
    expect(slaClosedNoReply.tone).toBe('neutral');
  });
});

describe('Support View UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPermissions = ['tickets.manage'];

    mockGet.mockImplementation((path: string) => {
      if (path === '/api/admin/tickets/staff') {
        return Promise.resolve([
          { id: 'staff-1', name: 'Agent Smith', role: 'SUPPORT' },
          { id: 'staff-2', name: 'Agent Jones', role: 'ADMIN' },
        ]);
      }
      if (path === '/api/admin/tickets') {
        return Promise.resolve({
          items: [
            {
              id: 'tkt-1',
              code: 'TKT-2026-000001',
              subject: 'Issue with GST application filing',
              description: 'Customer needs help verifying their electricity bill.',
              priority: 'HIGH',
              status: 'OPEN',
              applicationId: 'app-1',
              applicationCode: 'BN10001',
              applicationService: 'GST Registration',
              assignedToId: 'staff-1',
              assignedTo: { id: 'staff-1', name: 'Agent Smith' },
              customerId: 'cust-1',
              customer: { id: 'cust-1', name: 'Rahul Sharma', email: 'rahul@example.com', mobile: '9876543210' },
              firstResponseAt: null,
              resolvedAt: null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
          total: 1,
          page: 1,
          limit: 25,
        });
      }
      if (path === '/api/admin/tickets/{id}') {
        return Promise.resolve({
          id: 'tkt-1',
          code: 'TKT-2026-000001',
          subject: 'Issue with GST application filing',
          description: 'Customer needs help verifying their electricity bill.',
          priority: 'HIGH',
          status: 'OPEN',
          applicationId: 'app-1',
          applicationCode: 'BN10001',
          applicationService: 'GST Registration',
          assignedToId: 'staff-1',
          assignedTo: { id: 'staff-1', name: 'Agent Smith' },
          customerId: 'cust-1',
          customer: { id: 'cust-1', name: 'Rahul Sharma', email: 'rahul@example.com', mobile: '9876543210' },
          firstResponseAt: null,
          resolvedAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          thread: { items: [], total: 0, page: 1, limit: 50 },
          messages: [
            {
              id: 'msg-1',
              body: 'Customer initial query message',
              sender: { id: 'cust-1', name: 'Rahul Sharma', isStaff: false },
              createdAt: new Date().toISOString(),
              readAt: null,
            },
          ],
        });
      }
      return Promise.reject(new Error(`Unexpected GET ${path}`));
    });

    mockPatch.mockResolvedValue({});
    mockPost.mockResolvedValue({});
  });

  it('renders queue tickets and allows opening details', async () => {
    render(<SupportView />);

    await waitFor(() => {
      expect(screen.getByText('Issue with GST application filing')).toBeInTheDocument();
      expect(screen.getByText('TKT-2026-000001')).toBeInTheDocument();
      expect(screen.getByText('Rahul Sharma')).toBeInTheDocument();
      expect(screen.getByText(/Awaiting response/)).toBeInTheDocument();
    });

    // Click ticket to open detail
    fireEvent.click(screen.getByText('Issue with GST application filing'));

    await waitFor(() => {
      expect(screen.getByText('Customer Description')).toBeInTheDocument();
      expect(screen.getByText('Customer initial query message')).toBeInTheDocument();
      expect(screen.getByText('Send Staff Reply')).toBeInTheDocument();
      expect(screen.getByText('← Back to support queue')).toBeInTheDocument();
    });
  });

  it('denies access if user lacks tickets.manage permission', async () => {
    mockPermissions = ['applications.view_all'];
    render(<SupportView />);

    await waitFor(() => {
      expect(screen.getByText(/not allowed to view this section/i)).toBeInTheDocument();
    });
  });
});
