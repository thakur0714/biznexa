import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ToastProvider } from '@biznexa/ui';
import { CustomerDetailView } from '../src/app/(portal)/customers/[id]/customer-detail-view';

const mockGet = vi.fn();
const mockPatch = vi.fn();
const mockCall = vi.fn((cb: unknown) => (cb as (api: { GET: typeof mockGet; PATCH: typeof mockPatch }) => unknown)({ GET: mockGet, PATCH: mockPatch }));

vi.mock('@biznexa/api-client/react', () => ({
  useApi: () => ({ call: mockCall }),
}));

let mockUser: { id: string; permissions: string[] } = {
  id: 'staff-1',
  permissions: ['customers.view'],
};

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: mockUser }),
}));

describe('Customer Detail View UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser = { id: 'staff-1', permissions: ['customers.view'] };
    mockGet.mockResolvedValue({
      profile: {
        id: 'c-1',
        name: 'Jane Doe',
        email: 'jane@example.com',
        mobile: '9876543210',
        status: 'ACTIVE',
        createdAt: new Date().toISOString(),
      },
      businessEntities: [],
      applications: [
        {
          id: 'app-1',
          code: 'APP-123',
          status: 'SUBMITTED',
          serviceName: 'Test Service',
          createdAt: new Date().toISOString(),
        },
      ],
      orders: [
        {
          id: 'ord-1',
          code: 'ORD-123',
          total: 10000,
          amountPaid: 10000,
          status: 'PAID',
          createdAt: new Date().toISOString(),
        },
      ],
      payments: [],
    });
  });

  it('renders profile, applications, orders in rupees', async () => {
    render(<ToastProvider><CustomerDetailView id="c-1" /></ToastProvider>);

    await waitFor(() => {
      expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    });

    expect(screen.getByText('jane@example.com')).toBeInTheDocument();

    // Application
    expect(screen.getByText('APP-123')).toBeInTheDocument();

    // Order in rupees (10000 paise = ₹100)
    const amounts = screen.getAllByText('₹100');
    expect(amounts.length).toBeGreaterThan(0);

    // Buttons hidden because no customers.manage
    expect(screen.queryByText('Block')).not.toBeInTheDocument();
  });

  it('dialog submit disabled until reason has 3+ chars and posts { status, reason }', async () => {
    mockUser.permissions = ['customers.view', 'customers.manage'];
    render(<ToastProvider><CustomerDetailView id="c-1" /></ToastProvider>);

    await waitFor(() => {
      expect(screen.getByText('Block')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Block'));

    // Dialog appears
    await waitFor(() => {
      expect(screen.getByLabelText('Reason')).toBeInTheDocument();
    });

    const submitBtn = screen.getByText('Save');
    expect(submitBtn).toBeDisabled();

    // Type 2 chars
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'ab' } });
    expect(submitBtn).toBeDisabled();

    // Type 3+ chars
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'abc' } });
    expect(submitBtn).not.toBeDisabled();

    mockPatch.mockResolvedValue({});
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockCall).toHaveBeenCalledWith(expect.any(Function));
      expect(mockPatch).toHaveBeenCalledWith('/api/admin/customers/{id}/status', {
        params: { path: { id: 'c-1' } },
        body: { status: 'BLOCKED', reason: 'abc' },
      });
    });
  });
});
