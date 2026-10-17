import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataRequest, DataRequestList } from '@biznexa/types';
import { PrivacyView } from './privacy-view';

const REQUEST: DataRequest = {
  id: '11111111-1111-4111-8111-111111111111', type: 'EXPORT', status: 'COMPLETED', reason: null, rejectionReason: null,
  createdAt: '2026-10-10T08:00:00.000Z', handledAt: null, completedAt: '2026-10-10T08:01:00.000Z', expiresAt: '2026-10-17T08:01:00.000Z', downloadable: false,
};
let list: DataRequestList;
const posts: Array<{ url: string; body: unknown }> = [];
let postError: Error | null = null;

const fakeClient = {
  GET: vi.fn(async () => ({ data: list, response: new Response(null, { status: 200 }) })),
  POST: vi.fn(async (url: string, options?: { body?: unknown; params?: unknown }) => {
    posts.push({ url, body: options?.body ?? options?.params });
    if (postError) throw postError;
    if (url === '/api/privacy/requests/{id}/link') return { data: { url: '/api/data-exports/x/download?e=1&d=attachment&s=sig', expiresAt: '2026-10-17T08:06:00.000Z' }, response: new Response() };
    if (url === '/api/privacy/otp') return { data: { channel: 'MOBILE', sentTo: '98******10', expiresIn: 300, resendAfter: 30 }, response: new Response() };
    return { data: { ...REQUEST, status: 'PENDING' }, response: new Response(null, { status: 201 }) };
  }),
};
const fakeApi = { call: async (send: (client: typeof fakeClient) => Promise<{ data: unknown }>) => (await send(fakeClient)).data };
vi.mock('@biznexa/api-client/react', () => ({ useApi: () => fakeApi }));

beforeEach(() => {
  posts.length = 0;
  postError = null;
  list = { items: [], reauth: { password: true, otpChannel: 'MOBILE' } };
});

describe('PrivacyView', () => {
  it('asks for a data export', async () => {
    render(<PrivacyView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Download my data' }));
    await waitFor(() => expect(posts).toEqual([{ url: '/api/privacy/requests', body: { type: 'EXPORT' } }]));
    expect(await screen.findByText(/We are preparing your file/)).toBeInTheDocument();
  });

  it('downloads a ready export through a signed link', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    list = { ...list, items: [{ ...REQUEST, downloadable: true }] };
    render(<PrivacyView />);
    expect(await screen.findByText(/can be downloaded until 17 Oct 2026/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Prepare a new copy' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Download ZIP' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/api/data-exports/x/download?e=1&d=attachment&s=sig'));
    expect(posts).toEqual([{ url: '/api/privacy/requests/{id}/link', body: { path: { id: REQUEST.id } } }]);
    vi.unstubAllGlobals();
  });

  it('shows an open export as being prepared and lists past requests', async () => {
    list = { ...list, items: [{ ...REQUEST, id: '22222222-2222-4222-8222-222222222222', status: 'PROCESSING' }, { ...REQUEST, type: 'DELETION', status: 'REJECTED', rejectionReason: 'Balance due' }] };
    render(<PrivacyView />);
    expect(await screen.findByRole('button', { name: 'Preparing your file…' })).toBeDisabled();
    expect(screen.getByText('Processing')).toBeInTheDocument();
    expect(screen.getByText(/Reason: Balance due/)).toBeInTheDocument();
  });

  it('needs the confirmation and the password before asking for a deletion', async () => {
    render(<PrivacyView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete my account' }));
    const dialog = screen.getByRole('dialog', { hidden: true });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Request deletion', hidden: true }));
    expect(within(dialog).getByText(/Please confirm you understand/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByLabelText(/I understand that my account/));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Request deletion', hidden: true }));
    expect(within(dialog).getByText('Enter your password')).toBeInTheDocument();
    expect(posts).toEqual([]);

    fireEvent.change(within(dialog).getByLabelText('Your password'), { target: { value: 'secret123' } });
    fireEvent.change(within(dialog).getByLabelText('Reason (optional)'), { target: { value: 'Moving on' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Request deletion', hidden: true }));
    await waitFor(() =>
      expect(posts).toEqual([{ url: '/api/privacy/requests', body: { type: 'DELETION', confirm: true, reason: 'Moving on', password: 'secret123' } }]),
    );
    expect(await screen.findByText(/Your request has been received/)).toBeInTheDocument();
  });

  it('uses a one-time code when the account has no password, and shows API errors', async () => {
    list = { ...list, reauth: { password: false, otpChannel: 'MOBILE' } };
    render(<PrivacyView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete my account' }));
    const dialog = screen.getByRole('dialog', { hidden: true });
    expect(within(dialog).queryByLabelText('Your password')).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send me a code', hidden: true }));
    const code = await within(dialog).findByLabelText('Code');
    expect(within(dialog).getByText(/98\*{6}10/)).toBeInTheDocument();
    fireEvent.change(code, { target: { value: '123456' } });
    fireEvent.click(within(dialog).getByLabelText(/I understand that my account/));
    postError = new Error('Incorrect code. 4 attempts left.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Request deletion', hidden: true }));
    expect(await within(dialog).findByText('Incorrect code. 4 attempts left.')).toBeInTheDocument();
    expect(posts.at(-1)).toEqual({ url: '/api/privacy/requests', body: { type: 'DELETION', confirm: true, otp: '123456' } });
  });
});
