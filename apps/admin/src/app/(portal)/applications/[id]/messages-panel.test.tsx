import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  formatDate,
  markMessagesReadResponseSchema,
  messageSchema,
  messageThreadPageSchema,
  type MarkMessagesReadResponse,
  type Message,
  type MessageThreadPage,
} from '@biznexa/types';
import { MessagesPanel } from './messages-panel';

const APP_ID = '11111111-1111-4111-8111-111111111111';
const CUST_ID = '22222222-2222-4222-8222-222222222222';
const STAFF_ID = '33333333-3333-4333-8333-333333333333';

interface RecordedCall {
  method: 'GET' | 'POST';
  url: string;
  options?: unknown;
}

let calls: RecordedCall[] = [];
let initialPage: MessageThreadPage;
let createdMessage: Message;

const fakeClient = {
  GET: vi.fn(async (url: string, options?: unknown) => {
    calls.push({ method: 'GET', url, options });
    return {
      data: initialPage,
      response: new Response(null, { status: 200 }),
    };
  }),
  POST: vi.fn(async (url: string, options?: { body?: { body?: string; fileIds?: string[] } | FormData | unknown }) => {
    calls.push({ method: 'POST', url, options });
    if (url.endsWith('/read')) {
      const readRes: MarkMessagesReadResponse = markMessagesReadResponseSchema.parse({ count: 1 });
      return {
        data: readRes,
        response: new Response(null, { status: 200 }),
      };
    }
    if (url === '/api/files') {
      return {
        data: { id: '77777777-7777-4777-8777-777777777777' },
        response: new Response(null, { status: 201 }),
      };
    }
    const bodyData = options?.body && !(options.body instanceof FormData) ? (options.body as { body?: string; fileIds?: string[] }) : undefined;
    const nextMsg: Message = messageSchema.parse({
      ...createdMessage,
      body: bodyData?.body !== undefined ? bodyData.body : createdMessage.body,
      attachments: bodyData?.fileIds ? [{ id: bodyData.fileIds[0], fileName: 'attached.pdf', mimeType: 'application/pdf', sizeBytes: 1024 }] : [],
    });
    return {
      data: nextMsg,
      response: new Response(null, { status: 201 }),
    };
  }),
};

vi.mock('@biznexa/api-client/react', () => {
  // One stable object, like the real hook: a new one each render would re-run the panel's load effect.
  const api = {
    call: async (fn: (c: typeof fakeClient) => Promise<{ data: unknown }>) => {
      const res = await fn(fakeClient);
      return res.data;
    },
  };
  return { useApi: () => api };
});

beforeEach(() => {
  calls = [];
  fakeClient.GET.mockClear();
  fakeClient.POST.mockClear();

  initialPage = messageThreadPageSchema.parse({
    items: [
      {
        id: '44444444-4444-4444-8444-444444444444',
        body: 'Customer question about GST certificate',
        sender: { id: CUST_ID, name: 'Riya Sharma', isStaff: false },
        createdAt: '2026-10-15T06:30:00.000Z',
        readAt: null,
      },
      {
        id: '55555555-5555-4555-8555-555555555555',
        body: 'We have submitted your GST application.',
        sender: { id: STAFF_ID, name: 'Arjun Ops', isStaff: true },
        createdAt: '2026-10-16T08:00:00.000Z',
        readAt: '2026-10-16T08:15:00.000Z',
      },
    ],
    total: 2,
    page: 1,
    limit: 50,
  });

  createdMessage = messageSchema.parse({
    id: '66666666-6666-4666-8666-666666666666',
    body: 'Your ARN has been generated.',
    sender: { id: STAFF_ID, name: 'Arjun Ops', isStaff: true },
    createdAt: '2026-10-16T09:00:00.000Z',
    readAt: null,
  });
});

describe('MessagesPanel (M4.11)', () => {
  it('renders the thread oldest first with staff vs customer styling, IST dates, and marks read on open', async () => {
    render(<MessagesPanel applicationId={APP_ID} />);

    await screen.findByText('Customer question about GST certificate');
    expect(screen.getByText('We have submitted your GST application.')).toBeTruthy();
    expect(screen.getByText('Riya Sharma (Customer)')).toBeTruthy();
    expect(screen.getByText('Arjun Ops (Staff)')).toBeTruthy();
    expect(screen.getByText(formatDate('2026-10-15T06:30:00.000Z'))).toBeTruthy();
    expect(screen.getByText(formatDate('2026-10-16T08:00:00.000Z'))).toBeTruthy();

    expect(calls.some((c) => c.method === 'GET' && c.url === '/api/admin/applications/{applicationId}/messages')).toBe(true);
    expect(calls.some((c) => c.method === 'POST' && c.url === '/api/admin/applications/{applicationId}/messages/read')).toBe(true);
  });

  it('keeps Send disabled when empty or whitespace, then posts and displays the new message', async () => {
    render(<MessagesPanel applicationId={APP_ID} />);
    await screen.findByText('Customer question about GST certificate');

    const sendButton = screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement;
    const textarea = screen.getByLabelText('Message') as HTMLTextAreaElement;

    expect(sendButton.disabled).toBe(true);

    fireEvent.change(textarea, { target: { value: '   ' } });
    expect(sendButton.disabled).toBe(true);

    fireEvent.change(textarea, { target: { value: '  Your ARN has been generated.  ' } });
    expect(sendButton.disabled).toBe(false);

    fireEvent.click(sendButton);

    await screen.findByText('Your ARN has been generated.');
    await waitFor(() => {
      expect(textarea.value).toBe('');
    });
    expect(sendButton.disabled).toBe(true);
  });

  it('renders a message with an attachment and a null body', async () => {
    initialPage = messageThreadPageSchema.parse({
      items: [
        {
          id: '44444444-4444-4444-8444-444444444444',
          body: null,
          sender: { id: CUST_ID, name: 'Riya Sharma', isStaff: false },
          createdAt: '2026-10-15T06:30:00.000Z',
          readAt: null,
          attachments: [
            { id: '88888888-8888-4888-8888-888888888888', fileName: 'document.pdf', mimeType: 'application/pdf', sizeBytes: 2048 },
          ],
        },
      ],
      total: 1,
      page: 1,
      limit: 50,
    });

    render(<MessagesPanel applicationId={APP_ID} />);
    await screen.findByText('document.pdf');
    expect(screen.getByText('2.0 KB')).toBeTruthy();
    expect(screen.queryByText('null')).toBeNull();
  });

  it('allows sending a message with one file attached (collects fileId)', async () => {
    render(<MessagesPanel applicationId={APP_ID} />);
    await screen.findByText('Customer question about GST certificate');

    const sendButton = screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement;
    // Querying for the specific file input using the ID or type.
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;

    expect(sendButton.disabled).toBe(true);

    const file = new File(['content'], 'test-upload.pdf', { type: 'application/pdf' });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(sendButton.disabled).toBe(false);
    });

    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(calls.some(c => c.url === '/api/files' && c.method === 'POST')).toBe(true);
      expect(calls.some(c => c.url.includes('/messages') && c.method === 'POST' && ((c.options as { body?: { fileIds?: string[] } })?.body?.fileIds?.includes('77777777-7777-4777-8777-777777777777')))).toBe(true);
    });

    await screen.findByText('attached.pdf');
  });
});
