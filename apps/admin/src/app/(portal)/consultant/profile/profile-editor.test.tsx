import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { consultantOwnProfileSchema, type ConsultantOwnProfile } from '@biznexa/types';
import { ConsultantProfileEditor } from './profile-editor';

const calls: Array<{ path: string; body?: unknown }> = [];
let profile: ConsultantOwnProfile;
const fakeClient = {
  GET: vi.fn(async () => ({ data: profile, response: new Response(null, { status: 200 }) })), // NOSONAR: API test double preserves rejected-call behavior
  PUT: vi.fn(async (_path: string, options: { body?: unknown }) => { // NOSONAR: API test double preserves rejected-call behavior
    calls.push({ path: '/api/consultants/me/profile', body: options.body });
    const body = options.body as { city?: string; feePerSession?: number };
    const hasFeeChange = body.feePerSession !== undefined && body.feePerSession !== profile.feePerSession;
    profile = consultantOwnProfileSchema.parse({
      ...profile,
      ...body,
      feePerSession: profile.feePerSession,
      pendingFeeRequest: hasFeeChange ? {
        id: '22222222-2222-4222-8222-222222222222', consultantId: profile.id, requestedFee: body.feePerSession!,
        status: 'PENDING', decisionReason: null, createdAt: '2026-10-17T00:00:00.000Z', decidedAt: null,
      } : profile.pendingFeeRequest,
    });
    return { data: profile, response: new Response(null, { status: 200 }) };
  }),
};
const fakeApi = { call: async (send: (client: typeof fakeClient) => Promise<{ data: unknown }>) => (await send(fakeClient)).data };

vi.mock('@biznexa/api-client/react', () => ({ useApi: () => fakeApi }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { roles: ['CONSULTANT'], permissions: ['admin.access'] } }) }));

beforeEach(() => {
  calls.length = 0; fakeClient.GET.mockClear(); fakeClient.PUT.mockClear();
  profile = consultantOwnProfileSchema.parse({
    id: '11111111-1111-4111-8111-111111111111', slug: 'asha-rao', category: 'CA', qualification: 'CA', membershipNo: null,
    experienceYears: 8, expertise: ['GST'], languages: ['English'], city: 'Pune', state: 'Maharashtra', area: null,
    bio: null, feePerSession: 120000, consultationTypes: ['VIDEO'], pendingFeeRequest: null,
  });
});

describe('ConsultantProfileEditor', () => {
  it('edits profile details and sends a fee change for review without changing the approved fee', async () => {
    render(<ConsultantProfileEditor />);
    expect(await screen.findByLabelText('City')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Mumbai' } });
    fireEvent.change(screen.getByLabelText('Fee per session (₹)'), { target: { value: '1500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.body).toMatchObject({ city: 'Mumbai', feePerSession: 150000 });
    expect(await screen.findByText(/waiting for admin approval/)).toBeTruthy();
    expect(profile.feePerSession).toBe(120000);
  });

  it('locks the fee field while a request is pending', async () => {
    profile = consultantOwnProfileSchema.parse({ ...profile, pendingFeeRequest: { id: '22222222-2222-4222-8222-222222222222', consultantId: profile.id, requestedFee: 150000, status: 'PENDING', decisionReason: null, createdAt: '2026-10-17T00:00:00.000Z', decidedAt: null } });
    render(<ConsultantProfileEditor />);
    expect(await screen.findByText('Fee change awaiting approval')).toBeTruthy();
    expect((screen.getByLabelText('Fee per session (₹)') as HTMLInputElement).disabled).toBe(true);
  });

  it('shows the verified identity fields as read-only with support guidance', async () => {
    render(<ConsultantProfileEditor />);
    expect(await screen.findByText('Contact support to change your category, qualification or membership number.')).toBeTruthy();
    expect((screen.getByLabelText('Category') as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText('Qualification') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('Professional membership number') as HTMLInputElement).disabled).toBe(true);
  });
});
