import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReviewsView } from './reviews-view';

const REVIEW_ID = '11111111-1111-4111-8111-111111111111';
const BOOKING_ID = '22222222-2222-4222-8222-222222222222';
const row = { id: REVIEW_ID, bookingId: BOOKING_ID, rating: 4, text: 'Helpful advice', status: 'PENDING', moderationReason: null, createdAt: '2026-10-18T10:00:00.000Z', bookingCode: 'BKG-2026-000001', customerName: 'Maya', consultantName: 'Asha' };
const requests: Array<{ method: string; path: string; body?: unknown }> = [];
const fakeClient = {
  GET: vi.fn(async (path: string) => { requests.push({ method: 'GET', path }); return { data: { items: [row] } }; }),
  POST: vi.fn(async (path: string, options: { body?: unknown }) => { requests.push({ method: 'POST', path, body: options.body }); return { data: { ...row, status: 'APPROVED' } }; }),
};
const fakeApi = { call: async (send: (client: typeof fakeClient) => Promise<{ data: unknown }>) => (await send(fakeClient)).data };
vi.mock('@biznexa/api-client/react', () => ({ useApi: () => fakeApi }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { permissions: ['consultants.manage'] } }) }));

beforeEach(() => { requests.length = 0; fakeClient.GET.mockClear(); fakeClient.POST.mockClear(); });

describe('ReviewsView', () => {
  it('shows pending reviews and submits an approval to the moderation API', async () => {
    render(<ReviewsView />);
    expect(await screen.findByText('Helpful advice')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(requests).toContainEqual({ method: 'POST', path: '/api/admin/reviews/{id}/moderate', body: { status: 'APPROVED', reason: undefined } }));
  });

  it('requires a rejection reason before enabling reject', async () => {
    render(<ReviewsView />);
    const reject = await screen.findByRole('button', { name: 'Reject' });
    expect(reject).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Rejection reason'), { target: { value: 'Policy violation' } });
    expect(reject).toBeEnabled();
  });
});
