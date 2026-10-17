import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PERMS, type AdminNotificationTemplate } from '@biznexa/types';
import { ToastProvider } from '@biznexa/ui';
import { ApiProvider } from '@biznexa/api-client/react';
import { NotificationsView } from './notifications-view';

const auth = vi.hoisted(() => ({
  permissions: [] as string[],
  refresh: vi.fn(async () => 'renewed-token'),
}));

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    user: { id: 'u1', name: 'Asha Admin', roles: ['ADMIN'], permissions: auth.permissions },
    token: 'token',
    refresh: auth.refresh,
  }),
}));

const mockTemplates: AdminNotificationTemplate[] = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    event: 'payment.succeeded',
    channel: 'EMAIL',
    subject: 'Payment Successful for Order #{{orderId}}',
    body: '<p>Hello {{customerName}}, payment of {{amount}} received.</p>',
    dltTemplateId: null,
    isActive: true,
    updatedAt: '2026-10-17T12:00:00.000Z',
    allowedVariables: ['customerName', 'orderId', 'orderCode', 'amount', 'link'],
  },
  {
    id: '22222222-2222-2222-2222-222222222222',
    event: 'payment.succeeded',
    channel: 'SMS',
    subject: null,
    body: 'Payment of {{amount}} received for Order {{orderId}}. Thanks!',
    dltTemplateId: 'DLT-98765',
    isActive: true,
    updatedAt: '2026-10-17T12:00:00.000Z',
    allowedVariables: ['customerName', 'orderId', 'orderCode', 'amount', 'link'],
  },
  {
    id: '33333333-3333-3333-3333-333333333333',
    event: 'document.requested',
    channel: 'EMAIL',
    subject: 'Document requested for {{applicationNumber}}',
    body: '<p>Hello {{customerName}}, please upload {{documentName}}.</p>',
    dltTemplateId: null,
    isActive: true,
    updatedAt: '2026-10-17T12:00:00.000Z',
    allowedVariables: ['customerName', 'documentName', 'applicationNumber', 'serviceName', 'link'],
  },
];

let templates: AdminNotificationTemplate[];
let puts: { id: string; body: unknown }[];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  auth.permissions = [PERMS.ADMIN_ACCESS, PERMS.SETTINGS_MANAGE];
  templates = JSON.parse(JSON.stringify(mockTemplates));
  puts = [];

  vi.stubGlobal(
    'fetch',
    vi.fn(async (req: Request) => {
      const url = new URL(req.url);
      if (url.pathname === '/api/admin/notifications/templates' && req.method === 'GET') {
        return json({ templates });
      }

      if (url.pathname.startsWith('/api/admin/notifications/templates/') && req.method === 'PUT') {
        const id = url.pathname.split('/').pop()!;
        const body = await req.json();
        puts.push({ id, body });
        const existing = templates.find((t) => t.id === id);
        if (!existing) return json({ message: 'Not found' }, 404);
        const updated = { ...existing, ...body, updatedAt: new Date().toISOString() };
        templates = templates.map((t) => (t.id === id ? updated : t));
        return json(updated);
      }

      return json({ message: 'Not found' }, 404);
    }),
  );
});

const renderView = () =>
  render(
    <ApiProvider token="token" refresh={auth.refresh}>
      <ToastProvider>
        <NotificationsView />
      </ToastProvider>
    </ApiProvider>,
  );

describe('NotificationsView', () => {
  it('guards on settings.manage permission', () => {
    auth.permissions = [PERMS.DOCUMENTS_REVIEW];
    renderView();
    expect(screen.getByRole('heading', { name: /not allowed/i })).toBeInTheDocument();
  });

  it('renders templates, channel tabs, and preview', async () => {
    renderView();
    expect(screen.getByRole('status')).toHaveTextContent(/loading notification templates/i);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /notification templates/i })).toBeInTheDocument();
    });

    // Check fields for default selected template (payment.succeeded, EMAIL)
    expect(screen.getByLabelText(/email subject/i)).toHaveValue('Payment Successful for Order #{{orderId}}');
    expect(screen.getByLabelText(/html \/ text body/i)).toHaveValue(
      '<p>Hello {{customerName}}, payment of {{amount}} received.</p>',
    );

    // Live preview contains rendered sample values
    expect(screen.getByText(/Payment Successful for Order #ORD-2026-000123/i)).toBeInTheDocument();
    expect(screen.getByText(/Hello Rajesh Sharma, payment of ₹4,999 received./i)).toBeInTheDocument();

    // Variable chips are shown
    expect(screen.getByRole('button', { name: '{{customerName}}' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '{{amount}}' })).toBeInTheDocument();
  });

  it('switches channel and updates fields', async () => {
    renderView();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /notification templates/i })).toBeInTheDocument();
    });

    // Click SMS channel
    fireEvent.click(screen.getByRole('button', { name: /sms/i }));

    await waitFor(() => {
      expect(screen.getByLabelText(/message body/i)).toHaveValue(
        'Payment of {{amount}} received for Order {{orderId}}. Thanks!',
      );
      expect(screen.getByLabelText(/dlt template id/i)).toHaveValue('DLT-98765');
    });

    // Character counter is displayed for SMS
    expect(screen.getByText(/characters/i)).toBeInTheDocument();
  });

  it('updates live preview as user types and warns on unknown variables', async () => {
    renderView();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /notification templates/i })).toBeInTheDocument();
    });

    const bodyInput = screen.getByLabelText(/html \/ text body/i);
    fireEvent.change(bodyInput, {
      target: { value: 'Hi {{customerName}}, order is {{orderCode}} with {{mysteryVar}}.' },
    });

    // Warning appears
    expect(screen.getByText(/unknown variable\(s\) detected/i)).toBeInTheDocument();
    expect(screen.getAllByText(/{{mysteryVar}}/i).length).toBeGreaterThanOrEqual(1);

    // Preview updates live
    expect(screen.getByText(/Hi Rajesh Sharma, order is ORD-2026-000123 with {{mysteryVar}}./i)).toBeInTheDocument();
  });

  it('clicking variable chip inserts variable tag into the active input', async () => {
    renderView();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /notification templates/i })).toBeInTheDocument();
    });

    const subjectInput = screen.getByLabelText(/email subject/i);
    fireEvent.focus(subjectInput);

    const linkChip = screen.getByRole('button', { name: '{{link}}' });
    fireEvent.click(linkChip);

    expect(subjectInput).toHaveValue('Payment Successful for Order #{{orderId}} {{link}}');
  });

  it('saves template changes via useApi and displays toast', async () => {
    renderView();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /notification templates/i })).toBeInTheDocument();
    });

    const bodyInput = screen.getByLabelText(/html \/ text body/i);
    fireEvent.change(bodyInput, {
      target: { value: '<p>Updated notification for {{customerName}}.</p>' },
    });

    const saveButton = screen.getByRole('button', { name: /save changes/i });
    expect(saveButton).not.toBeDisabled();
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(puts).toHaveLength(1);
      expect(puts[0].id).toBe('11111111-1111-1111-1111-111111111111');
      expect((puts[0].body as { body: string }).body).toBe('<p>Updated notification for {{customerName}}.</p>');
      expect(screen.getByText(/notification template saved successfully/i)).toBeInTheDocument();
    });
  });
});
