import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { adminConsultantDetailSchema, type AdminConsultantDetail } from '@biznexa/types';
import { ConsultantDetailView } from './consultant-detail-view';

const ID = '11111111-1111-4111-8111-111111111111';
const FILE_ID = '33333333-3333-4333-8333-333333333333';
const calls: Array<{ url: string; options?: { params?: { path?: { id?: string; requestId?: string } }; body?: unknown } }> = [];
const featuredCalls: Array<{ url: string; body?: unknown }> = [];
let detail: AdminConsultantDetail;
const fakeClient = {
  GET: vi.fn(async () => ({ data: detail, response: new Response(null, { status: 200 }) })), // NOSONAR: API test double preserves rejected-call behavior
  POST: vi.fn(async (url: string, options?: { params?: { path?: { id?: string; requestId?: string } }; body?: unknown }) => { // NOSONAR: API test double preserves rejected-call behavior
    calls.push({ url, options });
    return { data: { id: ID, verificationStatus: 'APPROVED' }, response: new Response(null, { status: 201 }) };
  }),
  PATCH: vi.fn(async (url: string, options?: { body?: unknown }) => { // NOSONAR: API test double preserves rejected-call behavior
    featuredCalls.push({ url, body: options?.body });
    return { data: detail, response: new Response(null, { status: 200 }) };
  }),
};
const fakeApi = { call: async (send: (client: typeof fakeClient) => Promise<{ data: unknown }>) => (await send(fakeClient)).data };

vi.mock('@biznexa/api-client/react', () => ({
  useApi: () => fakeApi,
}));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { permissions: ['consultants.manage'] } }) }));

beforeEach(() => {
  calls.length = 0;
  featuredCalls.length = 0;
  fakeClient.GET.mockClear(); fakeClient.POST.mockClear(); fakeClient.PATCH.mockClear();
  detail = adminConsultantDetailSchema.parse({
    id: ID, userId: '22222222-2222-4222-8222-222222222222', name: 'Asha Rao', email: 'asha@example.com',
    category: 'CA', verificationStatus: 'PENDING', city: 'Pune', state: 'Maharashtra', experienceYears: 8,
    feePerSession: 120000, isFeatured: false, createdAt: '2026-10-17T08:00:00.000Z', updatedAt: '2026-10-17T08:00:00.000Z',
    slug: 'asha-rao', qualification: 'CA', membershipNo: 'ICAI-1', expertise: ['GST'], languages: ['English'],
    area: null, bio: null, consultationTypes: ['AUDIO'], rejectionReason: null,
    documents: [{ id: '44444444-4444-4444-8444-444444444444', kind: 'QUALIFICATION_PROOF', fileId: FILE_ID, fileName: 'degree.pdf', mimeType: 'application/pdf', scanStatus: 'CLEAN', createdAt: '2026-10-17T08:00:00.000Z' }],
    feeChangeRequests: [],
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

  it('approves a pending consultant fee change from the detail page', async () => {
    detail = adminConsultantDetailSchema.parse({ ...detail, feeChangeRequests: [{
      id: '55555555-5555-4555-8555-555555555555', requestedFee: 150000, status: 'PENDING', decisionReason: null,
      createdAt: '2026-10-17T08:00:00.000Z', decidedAt: null, decidedBy: null,
    }] });
    render(<ConsultantDetailView id={ID} />);
    expect(await screen.findByText('₹1,500 requested · PENDING')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Approve fee' }));
    await waitFor(() => expect(calls).toContainEqual({ url: '/api/admin/consultants/{id}/fee-requests/{requestId}/approve', options: { params: { path: { id: ID, requestId: '55555555-5555-4555-8555-555555555555' } } } }));
  });

  it('lets staff feature an approved consultant from the detail page', async () => {
    detail = adminConsultantDetailSchema.parse({ ...detail, verificationStatus: 'APPROVED' });
    render(<ConsultantDetailView id={ID} />);
    const toggle = await screen.findByRole('checkbox', { name: 'Featured consultant' });
    expect((toggle as HTMLInputElement).checked).toBe(false);
    fireEvent.click(toggle);
    await waitFor(() => expect(featuredCalls).toContainEqual({ url: '/api/admin/consultants/{id}/featured', body: { isFeatured: true } }));
    await waitFor(() => expect((screen.getByRole('checkbox', { name: 'Featured consultant' }) as HTMLInputElement).checked).toBe(true));
  });
});
