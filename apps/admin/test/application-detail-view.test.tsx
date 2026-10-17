import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ApplicationDetailView } from '../src/app/(portal)/applications/[id]/application-detail-view';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() })
}));

import type { ApplicationStatus } from '@biznexa/types';

let mockPermissions = ['applications.view_all', 'documents.review'];
let mockAppStatus: ApplicationStatus = 'DRAFT';

// Mock auth
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    user: {
      permissions: mockPermissions,
    },
  }),
}));

vi.mock('@biznexa/api-client/react', () => {
  const callMock = vi.fn().mockImplementation((fn) => {
    return fn({
      GET: vi.fn((path) => {
        if (path === '/api/admin/applications/{id}') {
          return Promise.resolve({
            id: 'app1',
            code: 'APP-1',
            status: mockAppStatus,
            customer: { name: 'John', email: 'john@example.com', mobile: '9999999999' },
            businessEntity: { id: 'ent-1', legalName: 'Acme Pvt Ltd', maskedPan: 'ABCDE****F' },
            service: { name: 'Service' },
            package: { name: 'Package' },
            priority: 'normal',
            documents: [
              {
                id: 'doc-1',
                requirementId: null,
                description: 'A utility bill from the last 3 months',
                name: 'Address proof',
                status: 'REQUIRED',
                fileKey: '',
                fileName: '',
                fileSize: 0,
                mimeType: '',
              }
            ],
          });
        }
        if (path === '/api/admin/applications/{applicationId}/messages') {
          return Promise.resolve({ items: [], page: 1, limit: 50, total: 0 });
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
  beforeEach(() => {
    mockPermissions = ['applications.view_all', 'documents.review'];
    mockAppStatus = 'DRAFT';
  });

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

  it('renders document description when available', async () => {
    render(<ApplicationDetailView id="app1" />);

    await waitFor(() => {
      expect(screen.getByText('Address proof')).toBeInTheDocument();
      expect(screen.getByText('A utility bill from the last 3 months')).toBeInTheDocument();
    });
  });

  it('does not show "Issue certificate" button when application is DRAFT', async () => {
    mockPermissions = ['applications.view_all', 'certificates.manage'];
    mockAppStatus = 'DRAFT';
    render(<ApplicationDetailView id="app1" />);

    await waitFor(() => {
      expect(screen.getByText('Application APP-1')).toBeInTheDocument();
    });

    expect(screen.queryByText('Issue certificate')).not.toBeInTheDocument();
  });

  it('shows "Issue certificate" button when application is COMPLETED and user has certificates.manage', async () => {
    mockPermissions = ['applications.view_all', 'certificates.manage'];
    mockAppStatus = 'COMPLETED';
    render(<ApplicationDetailView id="app1" />);

    await waitFor(() => {
      expect(screen.getByText('Issue certificate')).toBeInTheDocument();
    });

    const link = screen.getByText('Issue certificate').closest('a');
    expect(link).toHaveAttribute('href', expect.stringContaining('/certificates/new?applicationId=app1'));
    expect(link).toHaveAttribute('href', expect.stringContaining('organizationName=Acme%20Pvt%20Ltd'));
    expect(link).toHaveAttribute('href', expect.stringContaining('entityId=ent-1'));
  });

  it('does not show "Issue certificate" button when user lacks certificates.manage permission', async () => {
    mockPermissions = ['applications.view_all'];
    mockAppStatus = 'COMPLETED';
    render(<ApplicationDetailView id="app1" />);

    await waitFor(() => {
      expect(screen.getByText('Application APP-1')).toBeInTheDocument();
    });

    expect(screen.queryByText('Issue certificate')).not.toBeInTheDocument();
  });
});
