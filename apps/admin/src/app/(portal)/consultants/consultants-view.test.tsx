import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { adminConsultantListSchema, type AdminConsultantList } from '@biznexa/types';
import { ConsultantsView } from './consultants-view';

const CONSULTANT_ID = '11111111-1111-4111-8111-111111111111';
let list: AdminConsultantList;
const calls: Array<{ url: string; options: { params?: { query?: Record<string, unknown> } } | undefined }> = [];
const fakeClient = {
  GET: vi.fn(async (url: string, options?: { params?: { query?: Record<string, unknown> } }) => {
    calls.push({ url, options });
    return { data: adminConsultantListSchema.parse(list), response: new Response(null, { status: 200 }) };
  }),
};
const fakeApi = { call: async (send: (client: typeof fakeClient) => Promise<{ data: unknown }>) => (await send(fakeClient)).data };

vi.mock('@biznexa/api-client/react', () => ({
  useApi: () => fakeApi,
}));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { permissions: ['consultants.manage'] } }) }));

beforeEach(() => {
  calls.length = 0;
  fakeClient.GET.mockClear();
  list = adminConsultantListSchema.parse({
    items: [{
      id: CONSULTANT_ID, userId: '22222222-2222-4222-8222-222222222222', name: 'Asha Rao', email: 'asha@example.com',
      category: 'CA', verificationStatus: 'PENDING', city: 'Pune', state: 'Maharashtra', experienceYears: 8,
      feePerSession: 120000, createdAt: '2026-10-17T08:00:00.000Z',
    }], total: 1, page: 1, limit: 25,
  });
});

describe('ConsultantsView', () => {
  it('lists applications and filters by status with pagination parameters', async () => {
    render(<ConsultantsView />);
    expect(await screen.findByText('Asha Rao')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open review' }).getAttribute('href')).toBe(`/consultants/${CONSULTANT_ID}`);
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'APPROVED' } });
    await waitFor(() => expect(calls.some((call) => call.options?.params?.query?.status === 'APPROVED')).toBe(true));
    expect(calls.at(-1)?.options?.params?.query).toEqual({ status: 'APPROVED', page: 1, limit: 25 });
  });
});
