import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CustomersView } from '../src/app/(portal)/customers/customers-view';

const mockGet = vi.fn();

vi.mock('@biznexa/api-client/react', () => ({
  useApi: () => ({ call: (cb: unknown) => (cb as (api: { GET: typeof mockGet }) => unknown)({ GET: mockGet }) }),
}));

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    user: {
      id: 'staff-1',
      name: 'Admin User',
      email: 'admin@test.com',
      permissions: ['customers.view'],
    },
  }),
}));

describe('Customers View UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue({
      items: [
        {
          id: 'c-1',
          name: 'Jane Doe',
          email: 'jane@example.com',
          mobile: '9876543210',
          status: 'ACTIVE',
          applicationCount: 2,
          createdAt: new Date().toISOString(),
        },
        {
          id: 'c-2',
          name: 'John Smith',
          email: 'john@example.com',
          mobile: null,
          status: 'BLOCKED',
          applicationCount: 0,
          createdAt: new Date().toISOString(),
        },
      ],
      total: 2,
      page: 1,
      limit: 25,
    });
  });

  it('renders rows and status badges correctly', async () => {
    render(<CustomersView />);

    await waitFor(() => {
      expect(screen.getByText('Jane Doe')).toBeInTheDocument();
      expect(screen.getByText('John Smith')).toBeInTheDocument();
    });

    expect(screen.getByText('jane@example.com')).toBeInTheDocument();
    expect(screen.getByText('9876543210')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();

    expect(screen.getAllByText('Active')[0]).toBeInTheDocument();
    expect(screen.getAllByText('Blocked')[0]).toBeInTheDocument();
  });

  it('calls api with search query when typing in search', async () => {
    render(<CustomersView />);

    await waitFor(() => {
      expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    });

    const searchInput = screen.getByLabelText('Search');
    fireEvent.change(searchInput, { target: { value: 'Jane' } });

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/api/admin/customers', expect.objectContaining({
        params: { query: expect.objectContaining({ q: 'Jane' }) }
      }));
    });
  });
});
