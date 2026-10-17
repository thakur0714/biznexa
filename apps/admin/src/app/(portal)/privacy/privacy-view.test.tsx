import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { adminDataRequestListSchema, PERMS, type AdminDataRequestList } from '@biznexa/types';
import { PrivacyRequestsView } from './privacy-view';

const REQ_BLOCKED_ID = '11111111-1111-4111-8111-111111111111';
const REQ_CLEAN_ID = '22222222-2222-4222-8222-222222222222';
const REQ_EXPORT_ID = '33333333-3333-4333-8333-333333333333';

let list: AdminDataRequestList;
const calls: Array<{
  method: string;
  url: string;
  options?: { params?: { query?: Record<string, unknown>; path?: Record<string, unknown> }; body?: unknown };
}> = [];

const fakeClient = {
  GET: vi.fn(async (url: string, options?: { params?: { query?: Record<string, unknown> } }) => {
    calls.push({ method: 'GET', url, options });
    return { data: adminDataRequestListSchema.parse(list), response: new Response(null, { status: 200 }) };
  }),
  POST: vi.fn(async (url: string, options?: { params?: { path?: Record<string, unknown> }; body?: unknown }) => {
    calls.push({ method: 'POST', url, options });
    return { data: {}, response: new Response(null, { status: 200 }) };
  }),
};

const fakeApi = {
  call: async (send: (client: typeof fakeClient) => Promise<{ data: unknown }>) => (await send(fakeClient)).data,
};

vi.mock('@biznexa/api-client/react', () => ({
  useApi: () => fakeApi,
}));

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: { permissions: [PERMS.PRIVACY_MANAGE] } }),
}));

beforeEach(() => {
  calls.length = 0;
  fakeClient.GET.mockClear();
  fakeClient.POST.mockClear();

  list = adminDataRequestListSchema.parse({
    items: [
      {
        id: REQ_BLOCKED_ID,
        type: 'DELETION',
        status: 'PENDING',
        reason: 'Leaving platform',
        rejectionReason: null,
        createdAt: '2026-10-17T08:00:00.000Z',
        handledAt: null,
        completedAt: null,
        expiresAt: null,
        user: {
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          name: 'Blocked User',
          email: 'blocked@example.com',
          mobile: '9876543210',
          deleted: false,
        },
        handledBy: null,
        blockers: ['1 application is still in progress'],
      },
      {
        id: REQ_CLEAN_ID,
        type: 'DELETION',
        status: 'PENDING',
        reason: 'Close my account',
        rejectionReason: null,
        createdAt: '2026-10-17T09:00:00.000Z',
        handledAt: null,
        completedAt: null,
        expiresAt: null,
        user: {
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          name: 'Clean User',
          email: 'clean@example.com',
          mobile: '9876543211',
          deleted: false,
        },
        handledBy: null,
        blockers: [],
      },
      {
        id: REQ_EXPORT_ID,
        type: 'EXPORT',
        status: 'PENDING',
        reason: 'Annual audit',
        rejectionReason: null,
        createdAt: '2026-10-17T10:00:00.000Z',
        handledAt: null,
        completedAt: null,
        expiresAt: null,
        user: {
          id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          name: 'Export User',
          email: 'export@example.com',
          mobile: '9876543212',
          deleted: false,
        },
        handledBy: null,
        blockers: [],
      },
    ],
    total: 3,
    page: 1,
    limit: 25,
  });
});

describe('PrivacyRequestsView', () => {
  it('lists privacy requests and filters by type and status', async () => {
    render(<PrivacyRequestsView />);

    expect(await screen.findByText('Blocked User')).toBeTruthy();
    expect(screen.getByText('Clean User')).toBeTruthy();
    expect(screen.getByText('Export User')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'DELETION' } });
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.method === 'GET' &&
            c.options?.params?.query?.type === 'DELETION' &&
            c.options?.params?.query?.status === 'PENDING',
        ),
      ).toBe(true),
    );
    expect(calls.at(-1)?.options?.params?.query).toMatchObject({ type: 'DELETION', status: 'PENDING', page: 1, limit: 25 });

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'COMPLETED' } });
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.method === 'GET' &&
            c.options?.params?.query?.type === 'DELETION' &&
            c.options?.params?.query?.status === 'COMPLETED',
        ),
      ).toBe(true),
    );
    expect(calls.at(-1)?.options?.params?.query).toMatchObject({ type: 'DELETION', status: 'COMPLETED', page: 1, limit: 25 });
  });

  it('disables "Approve deletion" when blockers are present and enables when no blockers', async () => {
    render(<PrivacyRequestsView />);

    await screen.findByText('Blocked User');

    const blockedRow = screen.getByText('Blocked User').closest('tr')!;
    const blockedButton = within(blockedRow).getByRole('button', { name: 'Approve deletion' });
    expect(blockedButton).toBeDisabled();
    expect(within(blockedRow).getByText('1 application is still in progress')).toBeTruthy();

    const cleanRow = screen.getByText('Clean User').closest('tr')!;
    const cleanButton = within(cleanRow).getByRole('button', { name: 'Approve deletion' });
    expect(cleanButton).not.toBeDisabled();
  });

  it('approves a deletion request via POST /api/admin/privacy/requests/{id}/approve', async () => {
    render(<PrivacyRequestsView />);

    await screen.findByText('Clean User');

    const cleanRow = screen.getByText('Clean User').closest('tr')!;
    fireEvent.click(within(cleanRow).getByRole('button', { name: 'Approve deletion' }));

    const dialog = within(await screen.findByRole('dialog', { name: 'Delete this account?' }));
    expect(dialog.getByText(/Clean User · Account deletion/)).toBeTruthy();

    fireEvent.click(dialog.getByRole('button', { name: 'Delete account' }));

    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.method === 'POST' &&
            c.url === '/api/admin/privacy/requests/{id}/approve' &&
            c.options?.params?.path?.id === REQ_CLEAN_ID,
        ),
      ).toBe(true),
    );

    expect(await screen.findByText(/The account was deleted \(anonymised\)/)).toBeTruthy();
  });

  it('validates rejection reason (≤5 chars error) and rejects with reason via POST body', async () => {
    render(<PrivacyRequestsView />);

    await screen.findByText('Clean User');

    const cleanRow = screen.getByText('Clean User').closest('tr')!;
    fireEvent.click(within(cleanRow).getByRole('button', { name: 'Reject' }));

    const dialog = within(await screen.findByRole('dialog', { name: 'Reject this request?' }));

    // Empty reason
    fireEvent.click(dialog.getByRole('button', { name: 'Reject request' }));
    expect(await dialog.findByText('Give the customer a reason (at least 5 characters)')).toBeTruthy();
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);

    // Short reason (4 chars)
    const input = dialog.getByLabelText('Reason (the customer sees this)');
    fireEvent.change(input, { target: { value: 'Nope' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Reject request' }));
    expect(await dialog.findByText('Give the customer a reason (at least 5 characters)')).toBeTruthy();
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);

    // Valid reason (>= 5 chars)
    fireEvent.change(input, { target: { value: 'Account verification required before deletion' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Reject request' }));

    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.method === 'POST' &&
            c.url === '/api/admin/privacy/requests/{id}/reject' &&
            c.options?.params?.path?.id === REQ_CLEAN_ID &&
            (c.options?.body as { reason?: string })?.reason === 'Account verification required before deletion',
        ),
      ).toBe(true),
    );

    expect(await screen.findByText(/The request was rejected\. The customer has been told why\./)).toBeTruthy();
  });
});
