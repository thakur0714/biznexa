/* eslint-disable @typescript-eslint/no-explicit-any */
import { render, screen, waitFor } from '@testing-library/react';

import { LeadsView } from './leads-view';
import * as auth from '@/lib/auth';
import { useApi } from '@biznexa/api-client/react';
import { describe, expect, it, vi } from 'vitest';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';

vi.mock('@biznexa/api-client/react', () => ({
  useApi: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  useAuth: vi.fn(),
}));

const mockRouter: any = {
  push: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  refresh: vi.fn(),
};

describe('LeadsView', () => {
  it('renders correctly for authorized users', async () => {
    vi.mocked(auth.useAuth).mockReturnValue({ user: { permissions: ['leads.view'] } } as unknown as any);

    const mockCall = vi.fn().mockResolvedValue({
      items: [
        {
          id: '1',
          name: 'John Doe',
          mobile: '9876543210',
          email: 'john@example.com',
          city: 'Mumbai',
          serviceName: 'GST Registration',
          message: 'Need help',
          source: 'contact',
          createdAt: new Date().toISOString(),
        }
      ],
      total: 1,
      page: 1,
      limit: 50,
    });

    vi.mocked(useApi).mockReturnValue({ call: mockCall } as unknown as any);

    render(
      <AppRouterContext.Provider value={mockRouter}>
        <LeadsView />
      </AppRouterContext.Provider>
    );

    await waitFor(() => {
      expect(screen.getByText('John Doe')).toBeInTheDocument();
      expect(screen.getByText('9876543210')).toBeInTheDocument();
      expect(screen.getByText('Mumbai')).toBeInTheDocument();
      expect(screen.getByText('GST Registration')).toBeInTheDocument();
    });
  });

  it('shows NotAllowed for unauthorized users', async () => {
    vi.mocked(auth.useAuth).mockReturnValue({ user: { permissions: [] } } as unknown as any);

    render(
      <AppRouterContext.Provider value={mockRouter}>
        <LeadsView />
      </AppRouterContext.Provider>
    );

    expect(screen.getByText('You’re not allowed to view this section')).toBeInTheDocument();
  });
});
