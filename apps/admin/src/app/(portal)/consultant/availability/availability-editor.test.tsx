import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConsultantAvailability } from '@biznexa/types';
import { ConsultantAvailabilityEditor } from './availability-editor';

const calls: Array<{ method: string; path: string; body?: unknown }> = [];
let value: ConsultantAvailability = { sessionMinutes: 30, bufferMinutes: 0, minNoticeMinutes: 120, weekly: [], exceptions: [] };
const fakeClient = {
  GET: vi.fn(() => Promise.resolve().then(() => ({ data: value, response: new Response(null, { status: 200 }) }))),
  PUT: vi.fn((_path: string, options: { body?: unknown }) => Promise.resolve().then(() => {
    calls.push({ method: 'PUT', path: '/api/consultants/me/availability', body: options.body });
    value = { ...value, ...(options.body as object) } as ConsultantAvailability;
    return { data: value, response: new Response(null, { status: 200 }) };
  })),
  POST: vi.fn((_path: string, options: { body?: unknown }) => Promise.resolve().then(() => {
    calls.push({ method: 'POST', path: '/api/consultants/me/availability/exceptions', body: options.body });
    return { data: value, response: new Response(null, { status: 201 }) };
  })),
  DELETE: vi.fn(() => Promise.resolve().then(() => ({ data: value, response: new Response(null, { status: 200 }) }))),
};
const fakeApi = { call: async (send: (client: typeof fakeClient) => Promise<{ data: unknown }>) => (await send(fakeClient)).data };

vi.mock('@biznexa/api-client/react', () => ({ useApi: () => fakeApi }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { roles: ['CONSULTANT'], permissions: ['admin.access'] } }) }));

beforeEach(() => { calls.length = 0; value = { sessionMinutes: 30, bufferMinutes: 0, minNoticeMinutes: 120, weekly: [], exceptions: [] }; fakeClient.GET.mockClear(); fakeClient.PUT.mockClear(); fakeClient.POST.mockClear(); });

describe('ConsultantAvailabilityEditor', () => {
  it('saves weekly slots and settings through the own-availability API', async () => {
    render(<ConsultantAvailabilityEditor />);
    expect(await screen.findByRole('heading', { name: 'Weekly hours' })).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Add hours' })[1]!);
    fireEvent.click(screen.getByRole('button', { name: 'Save weekly hours' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ method: 'PUT', body: { weekly: [{ weekday: 1, startTime: '09:00', endTime: '12:00' }] } });
  });

  it('adds a full-day exception through the existing API', async () => {
    render(<ConsultantAvailabilityEditor />);
    await screen.findByText('No date exceptions yet.');
    fireEvent.click(screen.getByRole('button', { name: 'Add date exception' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ method: 'POST', body: { isBlocked: true } });
  });
});
