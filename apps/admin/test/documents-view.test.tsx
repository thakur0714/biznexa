import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DocumentsView } from '../src/app/(portal)/documents/documents-view';
import { ToastProvider } from '@biznexa/ui';

// Mocking @biznexa/api-client/react
vi.mock('@biznexa/api-client/react', () => {
  const callMock = vi.fn().mockImplementation((fn) => {
    return fn({
      GET: vi.fn((path) => {
        if (path === '/api/admin/documents/review-queue') {
          return Promise.resolve({
            items: [
              {
                id: 'doc1',
                name: 'Test Document',
                application: { id: 'app1', code: 'APP-1', customerName: 'John', customerEmail: 'john@example.com' },
                fileName: 'test.pdf',
                size: 1024,
                uploadedAt: new Date().toISOString(),
                fileId: 'file1',
              },
            ],
            total: 1,
          });
        }
        if (path === '/api/admin/settings/rejection-presets') {
          return Promise.resolve(['Blurry image', 'Missing signature']);
        }
        return Promise.resolve({});
      }),
      POST: vi.fn(() => Promise.resolve({ url: 'http://example.com', mimeType: 'application/pdf' })),
    });
  });

  return {
    useApi: () => ({ call: callMock }),
  };
});

describe('Admin Document Review UI', () => {
  it('reject needs a reason', async () => {
    render(
      <ToastProvider>
        <DocumentsView />
      </ToastProvider>
    );

    // Wait for the table to load and the reject button to appear
    await waitFor(() => {
      expect(screen.getAllByText('Reject').length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getAllByText('Reject')[0]);

    await waitFor(() => {
      expect(screen.getAllByText('Reject Document').length).toBeGreaterThan(0);
    });

    const submitBtn = screen.getByRole('button', { name: 'Reject Document' });
    expect(submitBtn).toBeDisabled();

    const reasonInput = screen.getByLabelText('Reason');
    fireEvent.change(reasonInput, { target: { value: 'Incomplete document' } });

    expect(submitBtn).not.toBeDisabled();
  });

  it('clicking a preset fills the reason', async () => {
    render(
      <ToastProvider>
        <DocumentsView />
      </ToastProvider>
    );

    await waitFor(() => {
      expect(screen.getAllByText('Reject').length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getAllByText('Reject')[0]);

    await waitFor(() => {
      expect(screen.getByText('Blurry image')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Blurry image'));

    const reasonInput = screen.getByLabelText('Reason') as HTMLInputElement | HTMLTextAreaElement;
    expect(reasonInput.value).toBe('Blurry image');
  });
});
