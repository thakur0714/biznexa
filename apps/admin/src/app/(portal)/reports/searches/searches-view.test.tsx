import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchesReportView } from './searches-view';

const range = { from: '2026-10-16T18:30:00.000Z', to: '2026-10-23T18:29:59.999Z', preset: 'last 7 days' };
const twoSearches = [
  { query: 'GST Refund', count: 3, lastSearchedAt: '2026-10-22T10:00:00.000Z' },
  { query: 'trademark renewal', count: 1, lastSearchedAt: '2026-10-21T09:00:00.000Z' },
];
let searches = twoSearches;
let permissions = ['reports.view'];
const requests: Array<{ path: string; query: unknown }> = [];
const fakeClient = {
  GET: vi.fn((path: string, options: { params: { query: unknown } }) => {
    requests.push({ path, query: options.params.query });
    return Promise.resolve({ data: { range, searches } });
  }),
};
const fakeApi = { call: async (send: (client: typeof fakeClient) => Promise<{ data: unknown }>) => (await send(fakeClient)).data };
vi.mock('@biznexa/api-client/react', () => ({ useApi: () => fakeApi }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { permissions } }) }));
vi.mock('next/navigation', () => ({ usePathname: () => '/reports/searches' }));

beforeEach(() => {
  requests.length = 0;
  fakeClient.GET.mockClear();
  permissions = ['reports.view'];
  searches = twoSearches;
});

describe('SearchesReportView', () => {
  it('lists unanswered searches with their counts, most searched first', async () => {
    render(<SearchesReportView />);
    expect(await screen.findByText('GST Refund')).toBeInTheDocument();
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('GST Refund');
    expect(rows[0]).toHaveTextContent('3');
    expect(rows[1]).toHaveTextContent('trademark renewal');
    expect(requests).toContainEqual({ path: '/api/admin/reports/searches', query: { preset: 'last 7 days' } });
  });

  it('reloads for the chosen date range', async () => {
    render(<SearchesReportView />);
    await screen.findByText('GST Refund');
    fireEvent.click(screen.getByRole('button', { name: 'This Month' }));
    await waitFor(() => expect(requests).toContainEqual({ path: '/api/admin/reports/searches', query: { preset: 'this month' } }));
  });

  it('shows the empty state when nothing went unanswered', async () => {
    searches = [];
    render(<SearchesReportView />);
    expect(await screen.findByText('No unanswered searches in this period')).toBeInTheDocument();
  });

  it('denies access without reports.view and does not call the API', () => {
    permissions = [];
    render(<SearchesReportView />);
    expect(screen.getByText(/You need the reports.view permission/)).toBeInTheDocument();
    expect(fakeClient.GET).not.toHaveBeenCalled();
  });
});
