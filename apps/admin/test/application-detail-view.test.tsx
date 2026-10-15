import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ApplicationDetailView } from '../src/app/(portal)/applications/[id]/application-detail-view';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() })
}));

// Mock auth
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    user: {
      permissions: ['applications.view_all', 'documents.review']
    }
  })
}));

vi.mock('@biznexa/api-client/react', () => {
  const callMock = vi.fn().mockImplementation((fn) => {
    return fn({
      GET: vi.fn((path) => {
        if (path === '/api/admin/applications/{id}') {
          return Promise.resolve({
            id: 'app1',
            code: 'APP-1',
            status: 'draft',
            customer: { name: 'John', email: 'john@example.com', mobile: '9999999999' },
            service: { name: 'Service' },
            package: { name: 'Package' },
            priority: 'normal',
          });
        }
        return Promise.resolve([]);
      }),
      POST: vi.fn(() => Promise.resolve({})),
    });
  });

  return {
    useApi: () => ({ call: callMock }),
  };
});


describe('Admin Application Detail UI', () => {
  it('request-document form validation', async () => {
    render(<ApplicationDetailView id="app1" />);

    await waitFor(() => {
      expect(screen.getByText('Request document')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Request document'));

    await waitFor(() => {
      expect(screen.getAllByText('Request Document').length).toBeGreaterThan(0); // The dialog title
    });

    const submitBtn = screen.getByRole('button', { name: 'Request Document' });
    expect(submitBtn).toBeDisabled();

    const nameInput = screen.getByLabelText('Document Name') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Proof of address' } });

    expect(submitBtn).not.toBeDisabled();
  });
});
