import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConsultationsView } from './consultations-view';
import { BOOKING_CHANGE_WINDOW_HOURS } from '@biznexa/types';

const CANCEL_WINDOW = BOOKING_CHANGE_WINDOW_HOURS * 60 * 60 * 1000;
const now = new Date('2026-10-15T10:00:00.000Z').getTime();

const booking = {
  id: '11111111-1111-4111-8111-111111111111',
  code: 'BKG-2026-000001',
  status: 'CONFIRMED',
  type: 'VIDEO',
  startAt: new Date(now + CANCEL_WINDOW + 2 * 60 * 60 * 1000).toISOString(),
  endAt: new Date(now + CANCEL_WINDOW + 3 * 60 * 60 * 1000).toISOString(),
  fee: 10000,
  holdExpiresAt: null,
  meetingLink: null,
  consultant: { slug: 'asha', name: 'Asha Rao' },
  payment: null,
  createdAt: '2026-10-01T10:00:00.000Z',
};

const requests: Array<{ method: string; path: string; body?: unknown }> = [];
const fakeClient = {
  GET: vi.fn(async (path: string) => {
    requests.push({ method: 'GET', path });
    return { items: [booking] };
  }),
  POST: vi.fn(async (path: string, options: { body?: unknown }) => {
    requests.push({ method: 'POST', path, body: options.body });
    return {};
  }),
};

// Return fakeClient's return value when `client` parameter is invoked
const fakeApi = { call: async (send: (client: typeof fakeClient) => Promise<{ items: unknown[] }>) => await send(fakeClient) };
vi.mock('@biznexa/api-client/react', () => ({ useApi: () => fakeApi }));

vi.mock('@biznexa/ui', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@biznexa/ui')>();
  return {
    ...mod,
    Dialog: ({ open, title, children, footer, description }: { open: boolean; title: string; children?: React.ReactNode; footer?: React.ReactNode; description?: React.ReactNode }) => open ? <dialog open><h2>{title}</h2><p>{description}</p>{children}{footer}</dialog> : null,
  };
});

beforeEach(() => {
  requests.length = 0;
  fakeClient.GET.mockClear();
  fakeClient.POST.mockClear();
});

describe('ConsultationsView', () => {
  it('clicking Cancel opens the dialog without calling the API', async () => {
    const origNow = Date.now;
    Date.now = () => now;

    render(<ConsultationsView />);
    await waitFor(() => expect(screen.getAllByText(/Asha Rao/)[0]).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Cancel consultation?')).toBeInTheDocument();
    expect(screen.getByText('The booking fee is not refunded automatically.')).toBeInTheDocument();

    const postRequests = requests.filter(r => r.method === 'POST');
    expect(postRequests.length).toBe(0);

    Date.now = origNow;
  });

  it('in the dialog, clicking Keep booking closes it without calling the API', async () => {
    const origNow = Date.now;
    Date.now = () => now;

    render(<ConsultationsView />);
    await waitFor(() => expect(screen.getAllByText(/Asha Rao/)[0]).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Keep booking' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    const postRequests = requests.filter(r => r.method === 'POST');
    expect(postRequests.length).toBe(0);

    Date.now = origNow;
  });

  it('in the dialog, clicking Cancel consultation calls POST /api/bookings/{id}/cancel once', async () => {
    const origNow = Date.now;
    Date.now = () => now;

    render(<ConsultationsView />);
    await waitFor(() => expect(screen.getAllByText(/Asha Rao/)[0]).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel consultation' }));

    await waitFor(() => {
      const postRequests = requests.filter(r => r.method === 'POST');
      expect(postRequests).toContainEqual({ method: 'POST', path: '/api/bookings/{id}/cancel', body: {} });
    });

    Date.now = origNow;
  });
});
