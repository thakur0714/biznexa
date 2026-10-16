import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deliverableListSchema,
  deliverableSchema,
  storedFileSchema,
  type Deliverable,
  type StoredFileResult,
} from '@biznexa/types';
import { DeliverablesPanel } from './deliverables-panel';

const APP_ID = '11111111-1111-4111-8111-111111111111';
const FILE_ID = '22222222-2222-4222-8222-222222222222';
const DELIVERABLE_ID = '33333333-3333-4333-8333-333333333333';
const NEW_DELIVERABLE_ID = '44444444-4444-4444-8444-444444444444';

interface RecordedPost {
  url: string;
  options?: {
    params?: { path?: { applicationId?: string } };
    body?: { title?: string; fileId?: string } | FormData;
  };
}

let calls: RecordedPost[] = [];
let items: Deliverable[] = [];

const uploadedFile: StoredFileResult = storedFileSchema.parse({
  id: FILE_ID,
  fileName: 'final.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 120,
  sha256: 'abc123',
  requirementId: null,
  scanStatus: 'PENDING',
  createdAt: '2026-10-16T08:00:00.000Z',
});

const fakeClient = {
  GET: vi.fn(async () => ({ data: deliverableListSchema.parse(items), response: new Response(null, { status: 200 }) })),
  POST: vi.fn(async (url: string, options?: RecordedPost['options']) => {
    calls.push({ url, options });
    if (url === '/api/files') {
      return { data: uploadedFile, response: new Response(null, { status: 201 }) };
    }
    const body = options?.body;
    if (!body || body instanceof FormData || !body.title || !body.fileId) throw new Error('Expected a deliverable body');
    const created = deliverableSchema.parse({
      id: NEW_DELIVERABLE_ID,
      title: body.title,
      fileId: body.fileId,
      fileName: 'final.pdf',
      createdAt: '2026-10-16T08:00:00.000Z',
    });
    items = [created, ...items];
    return { data: created, response: new Response(null, { status: 201 }) };
  }),
};

vi.mock('@biznexa/api-client/react', () => ({
  useApi: (() => {
    let api: { call: (send: (client: typeof fakeClient) => Promise<{ data: unknown }>) => Promise<unknown> } | undefined;
    return () => {
      api ??= { call: async (send) => (await send(fakeClient)).data };
      return api;
    };
  })(),
}));

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: { permissions: ['applications.update'] } }),
}));

beforeEach(() => {
  calls = [];
  items = deliverableListSchema.parse([{
    id: DELIVERABLE_ID,
    title: 'Final report',
    fileId: FILE_ID,
    fileName: 'final.pdf',
    createdAt: '2026-10-16T08:00:00.000Z',
  }]);
  fakeClient.GET.mockClear();
  fakeClient.POST.mockClear();
});

describe('DeliverablesPanel', () => {
  it('renders the deliverable list with its file name and date', async () => {
    render(<DeliverablesPanel applicationId={APP_ID} status="COMPLETED" />);

    expect(await screen.findByText('Final report')).toBeTruthy();
    expect(screen.getByText('final.pdf · 16-Oct-2026')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open' })).toBeTruthy();
  });

  it('keeps submit disabled until title and file are present, then uploads and posts the right body', async () => {
    render(<DeliverablesPanel applicationId={APP_ID} status="IN_PROGRESS" />);
    const submit = await screen.findByRole('button', { name: 'Add deliverable' }) as HTMLButtonElement;
    const title = screen.getByLabelText('Title');
    const fileInput = screen.getByLabelText('File') as HTMLInputElement;

    expect(submit.disabled).toBe(true);
    fireEvent.change(title, { target: { value: 'Certificate' } });
    expect(submit.disabled).toBe(true);

    fireEvent.change(fileInput, { target: { files: [new File(['pdf'], 'certificate.pdf', { type: 'application/pdf' })] } });
    expect(submit.disabled).toBe(false);
    fireEvent.submit(submit.closest('form')!);

    await waitFor(() => expect(calls.some((call) => call.url === '/api/admin/applications/{applicationId}/deliverables')).toBe(true));
    const addCall = calls.find((call) => call.url === '/api/admin/applications/{applicationId}/deliverables');
    expect(addCall?.options).toEqual({
      params: { path: { applicationId: APP_ID } },
      body: { title: 'Certificate', fileId: FILE_ID },
    });
    const uploadCall = calls.find((call) => call.url === '/api/files');
    const uploadBody = uploadCall?.options?.body;
    expect(uploadBody instanceof FormData).toBe(true);
    if (uploadBody instanceof FormData) expect(uploadBody.get('file')).toBeInstanceOf(File);
  });
});
