import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReviewForm } from './review-form';

const booking = { id: '11111111-1111-4111-8111-111111111111', code: 'BKG-2026-000001', status: 'COMPLETED', type: 'VIDEO', startAt: '2026-10-17T10:00:00.000Z', endAt: '2026-10-17T10:30:00.000Z', fee: 10000, holdExpiresAt: null, meetingLink: null, consultant: { slug: 'asha', name: 'Asha Rao' }, payment: null, createdAt: '2026-10-01T10:00:00.000Z' };
const requests: Array<{ method: string; path: string; body?: unknown }> = [];
const fakeClient = {
  GET: vi.fn((path: string) => { requests.push({ method: 'GET', path }); return Promise.resolve({ data: path.endsWith('/review') ? null : booking }); }),
  POST: vi.fn((path: string, options: { body?: unknown }) => { requests.push({ method: 'POST', path, body: options.body }); return Promise.resolve({ data: { id: '22222222-2222-4222-8222-222222222222', bookingId: booking.id, rating: 5, text: 'Great', status: 'PENDING', moderationReason: null, createdAt: '2026-10-18T10:00:00.000Z' } }); }),
};
const fakeApi = { call: async (send: (client: typeof fakeClient) => Promise<{ data: unknown }>) => (await send(fakeClient)).data };
vi.mock('@biznexa/api-client/react', () => ({ useApi: () => fakeApi }));

beforeEach(() => { requests.length = 0; fakeClient.GET.mockClear(); fakeClient.POST.mockClear(); });

describe('ReviewForm', () => {
  it('submits one review for the completed booking and explains moderation', async () => {
    render(<ReviewForm bookingId={booking.id} />);
    fireEvent.change(await screen.findByLabelText('Comment (optional)'), { target: { value: 'Great' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit review' }));
    await waitFor(() => expect(requests).toContainEqual({ method: 'POST', path: '/api/bookings/{id}/review', body: { rating: 5, text: 'Great' } }));
    expect(await screen.findByText('Your review was submitted for moderation.')).toBeInTheDocument();
  });
});
