import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { adminConsultantDetailSchema, type AdminConsultantDetail } from '@biznexa/types';
import { ConsultantDetailView } from './consultant-detail-view';

const ID = '11111111-1111-4111-8111-111111111111';
const FILE_ID = '33333333-3333-4333-8333-333333333333';
const calls: Array<{ url: string; options?: { params?: { path?: { id?: string } }; body?: unknown } }> = [];
let detail: AdminConsultantDetail;
const fakeClient = {
  GET: vi.fn(async () => ({ data: detail, response: new Response(null, { status: 200 }) })),
  POST: vi.fn(async (url: string, options?: { params?: { path?: { id?: string } }; body?: unknown }) => {
    calls.push({ url, options });
    return { data: { id: ID, verificationStatus: 'APPROVED' }, response: new Response(null, { status: 201 }) };
  }),
  PATCH: vi.fn(async () => ({ data: detail, response: new Response(null, { status: 200 }) })),
};
const fakeApi = { call: async (send: (client: typeof fakeClient) => Promise<{ data: unknown }>) => (await send(fakeClient)).data };

vi.mock('@biznexa/api-client/react', () => ({
  useApi: () => fakeApi,
}));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { permissions: ['consultants.manage'] } }) }));

beforeEach(() => {
  calls.length = 0;
  fakeClient.GET.mockClear(); fakeClient.POST.mockClear(); fakeClient.PATCH.mockClear();
  detail = adminConsultantDetailSchema.parse({
    id: ID, userId: '22222222-2222-4222-8222-222222222222', name: 'Asha Rao', email: 'asha@example.com',
    category: 'CA', verificationStatus: 'PENDING', city: 'Pune', state: 'Maharashtra', experienceYears: 8,
    feePerSession: 120000, createdAt: '2026-10-17T08:00:00.000Z', updatedAt: '2026-10-17T08:00:00.000Z',
    slug: 'asha-rao', qualification: 'CA', membershipNo: 'ICAI-1', expertise: ['GST'], languages: ['English'],
    area: null, bio: null, consultationTypes: ['AUDIO'], rejectionReason: null,
    documents: [{ id: '44444444-4444-4444-8444-444444444444', kind: 'QUALIFICATION_PROOF', fileId: FILE_ID, fileName: 'degree.pdf', mimeType: 'application/pdf', scanStatus: 'CLEAN', createdAt: '2026-10-17T08:00:00.000Z' }],
  });
});

describe('ConsultantDetailView', () => {
  it('renders documents and posts approve for the selected consultant', async () => {
    render(<ConsultantDetailView id={ID} />);
    expect(await screen.findByText('degree.pdf · CLEAN')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(calls).toContainEqual({ url: '/api/admin/consultants/{id}/approve', options: { params: { path: { id: ID } } } }));
  });

  it('keeps rejection disabled until a reason is entered and posts the reason', async () => {
    render(<ConsultantDetailView id={ID} />);
    const reject = await screen.findByRole('button', { name: 'Reject application' }) as HTMLButtonElement;
    expect(reject.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Rejection reason'), { target: { value: 'Missing proof' } });
    expect(reject.disabled).toBe(false);
    fireEvent.click(reject);
    await waitFor(() => expect(calls).toContainEqual({ url: '/api/admin/consultants/{id}/reject', options: { params: { path: { id: ID } }, body: { reason: 'Missing proof' } } }));
  });
});
