import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { consultantPortalBookingsSchema, consultantPortalEarningsSchema } from '@biznexa/types';
import { ConsultantPortalView } from './consultant-portal-view';

const calls: Array<{ method: string; path: string; body?: unknown }> = [];
let mockRoles = ['CONSULTANT'];

const mockBookingsData = consultantPortalBookingsSchema.parse({
  items: [
    {
      id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      code: 'B-123',
      status: 'CONFIRMED',
      type: 'Meeting',
      upcoming: false,
      startAt: '2026-10-09T10:00:00Z',
      endAt: '2026-10-09T11:00:00Z',
      meetingLink: 'https://meet.example.com',
      fee: 100000,
      customerName: 'Alice',
    }
  ]
});

const mockEarningsData = consultantPortalEarningsSchema.parse({
  commissionPercent: 80,
  items: [],
  monthlyTotals: [
    {
      month: '2026-10',
      fee: 100000,
      commission: 20000,
      net: 80000,
      bookings: 1
    }
  ]
});

const fakeClient = {
  GET: vi.fn(async (path: string) => { // NOSONAR: API test double preserves rejected-call behavior
    if (path === '/api/consultants/me/portal/bookings') {
      return { data: mockBookingsData, response: new Response(null, { status: 200 }) };
    }
    if (path === '/api/consultants/me/portal/earnings') {
      return { data: mockEarningsData, response: new Response(null, { status: 200 }) };
    }
    return { data: null, response: new Response(null, { status: 404 }) };
  }),
  POST: vi.fn(async (path: string, options: { body?: unknown }) => { // NOSONAR: API test double preserves rejected-call behavior
    calls.push({ method: 'POST', path, body: options.body });
    return { data: {}, response: new Response(null, { status: 200 }) };
  }),
};

const fakeApi = { call: async (send: (client: typeof fakeClient) => Promise<{ data: unknown }>) => (await send(fakeClient)).data };

vi.mock('@biznexa/api-client/react', () => ({ useApi: () => fakeApi }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { roles: mockRoles, permissions: [] } }) }));

beforeEach(() => {
  calls.length = 0;
  mockRoles = ['CONSULTANT'];
  fakeClient.GET.mockClear();
  fakeClient.POST.mockClear();
});

describe('ConsultantPortalView', () => {
  it('earnings section shows "Oct-2026", ₹ amounts and "Your earnings" column', async () => {
    render(<ConsultantPortalView section="earnings" />);
    expect(await screen.findByRole('heading', { name: 'Earnings' })).toBeTruthy();
    expect(await screen.findByText('Oct-2026')).toBeTruthy();
    expect(await screen.findByText('Your earnings')).toBeTruthy();
    // ₹1,000 for 100000 paise
    expect(await screen.findByText('₹1,000.00')).toBeTruthy();
    // ₹200 for 20000 paise commission
    expect(await screen.findByText('₹200.00')).toBeTruthy();
    // ₹800 for 80000 paise net
    expect(await screen.findByText('₹800.00')).toBeTruthy();
  });

  it('bookings section: a CONFIRMED past booking shows "Mark completed" and "Mark no-show"; clicking "Mark completed" POSTs to outcome API', async () => {
    render(<ConsultantPortalView section="bookings" />);
    expect(await screen.findByRole('heading', { name: 'My bookings' })).toBeTruthy();

    const completedBtn = await screen.findByRole('button', { name: 'Mark completed' });
    const noShowBtn = await screen.findByRole('button', { name: 'Mark no-show' });

    expect(completedBtn).toBeTruthy();
    expect(noShowBtn).toBeTruthy();

    fireEvent.click(completedBtn);

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({
      method: 'POST',
      path: '/api/bookings/{id}/outcome',
      body: { status: 'COMPLETED' }
    });
  });

  it('a user without the CONSULTANT role sees the not-allowed message', async () => {
    mockRoles = ['CUSTOMER'];
    render(<ConsultantPortalView section="earnings" />);
    expect(await screen.findByText('You’re not allowed to view this section')).toBeTruthy();
  });
});
