import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ExportButton } from '../src/app/(portal)/reports/export-button';

const mockPost = vi.fn();
const mockCall = vi.fn((cb: unknown) =>
  (cb as (api: { POST: typeof mockPost }) => unknown)({ POST: mockPost }),
);

vi.mock('@biznexa/api-client/react', () => ({
  useApi: () => ({
    call: mockCall,
  }),
}));

describe('ExportButton component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders Export button', () => {
    render(<ExportButton type="sales" preset="last 7 days" />);
    expect(screen.getByRole('button', { name: /export/i })).toBeDefined();
  });

  it('triggers export queue job and polls link', async () => {
    mockPost.mockImplementation((path: string) => {
      if (path === '/api/admin/reports/export') {
        return Promise.resolve({ id: 'exp-123' });
      }
      if (path === '/api/admin/reports/export/{id}/link') {
        return Promise.resolve({ url: '/api/admin/reports/export/exp-123/download?e=123&s=abc' });
      }
      return Promise.resolve({});
    });

    const assignMock = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { assign: assignMock },
      writable: true,
    });

    render(<ExportButton type="sales" preset="today" />);
    const button = screen.getByRole('button', { name: /export/i });
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/api/admin/reports/export', {
        body: { type: 'sales', preset: 'today' },
      });
      expect(mockPost).toHaveBeenCalledWith('/api/admin/reports/export/{id}/link', {
        params: { path: { id: 'exp-123' } },
      });
      expect(assignMock).toHaveBeenCalledWith('/api/admin/reports/export/exp-123/download?e=123&s=abc');
    });
  });
});
