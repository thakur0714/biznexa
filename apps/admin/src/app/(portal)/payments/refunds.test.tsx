import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PERMS, type AdminPaymentDetail, type AdminPaymentRow, type RefundView } from '@biznexa/types';
import { ToastProvider } from '@biznexa/ui';
import { ApiProvider } from '@biznexa/api-client/react';
import { checkRefundForm, rupeesToPaise } from './refund-dialog';
import { PaymentsView } from './payments-view';

const auth = vi.hoisted(() => ({ permissions: [] as string[], refresh: vi.fn(async () => 'renewed-token') }));
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'Asha Admin', roles: ['ADMIN'], permissions: auth.permissions }, token: 'token', refresh: auth.refresh }),
}));

const PAYMENT_ID = '11111111-1111-4111-8111-111111111111';

const row: AdminPaymentRow = {
  id: PAYMENT_ID,
  gateway: 'RAZORPAY',
  gatewayOrderId: 'order_1',
  gatewayPaymentId: 'pay_1',
  amount: 568000,
  method: 'upi',
  status: 'PARTIALLY_REFUNDED',
  failureReason: null,
  paidAt: '2026-10-10T05:00:00.000Z',
  createdAt: '2026-10-10T05:00:00.000Z',
  orderCode: 'ORD-2026-000001',
  applicationCode: 'APP-1',
  customerName: 'Ravi Kumar',
  customerEmail: 'ravi@example.com',
};

const processed: RefundView = {
  id: '22222222-2222-4222-8222-222222222222',
  amount: 100000,
  reason: 'Late delivery',
  status: 'PROCESSED',
  gatewayRefundId: 'rfnd_1',
  failureReason: null,
  createdAt: '2026-10-12T05:00:00.000Z',
  processedAt: '2026-10-13T05:00:00.000Z',
  creditNote: { id: '33333333-3333-4333-8333-333333333333', number: 'CN/2627/000004', issuedAt: '2026-10-13T05:00:00.000Z', pdfReady: true },
};

let detail: AdminPaymentDetail;
let refundRequests: { body: unknown; key: string | null }[];
let refundResponses: { status: number; body: unknown }[];

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  auth.permissions = [PERMS.ADMIN_ACCESS, PERMS.PAYMENTS_VIEW, PERMS.PAYMENTS_REFUND];
  detail = {
    ...row,
    customerMobile: '9876543210',
    refundable: 468000,
    refunds: [processed, { ...processed, id: '44444444-4444-4444-8444-444444444444', amount: 5000, status: 'FAILED', failureReason: 'Bank account closed', processedAt: null, creditNote: null, gatewayRefundId: null }],
    invoice: null,
  };
  refundRequests = [];
  refundResponses = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (req: Request) => {
      const url = new URL(req.url);
      if (req.method === 'GET' && url.pathname === '/api/admin/payments') return json({ items: [row], total: 1, page: 1, limit: 25 });
      if (req.method === 'GET' && url.pathname === `/api/admin/payments/${PAYMENT_ID}`) return json(detail);
      if (req.method === 'POST' && url.pathname === `/api/admin/payments/${PAYMENT_ID}/refunds`) {
        refundRequests.push({ body: await req.json(), key: req.headers.get('idempotency-key') });
        const next = refundResponses.shift() ?? { status: 201, body: { ...processed, id: crypto.randomUUID(), status: 'INITIATED', processedAt: null, creditNote: null } };
        return json(next.body, next.status);
      }
      if (req.method === 'POST' && url.pathname.startsWith('/api/credit-notes/')) return json({ url: '/api/credit-notes/x/download?s=1', expiresAt: '2026-10-17T06:00:00.000Z' });
      return json({ message: 'Not found' }, 404);
    }),
  );
});

const renderView = () =>
  render(
    <ApiProvider token="token" refresh={auth.refresh}>
      <ToastProvider>
        <PaymentsView />
      </ToastProvider>
    </ApiProvider>,
  );

async function openDetail() {
  renderView();
  fireEvent.click(await screen.findByRole('button', { name: `View payment ${PAYMENT_ID}` }));
  return within(await screen.findByRole('dialog', { name: 'Payment Detail' }));
}

async function openRefund() {
  const d = await openDetail();
  fireEvent.click(await d.findByRole('button', { name: 'Refund' }));
  return within(await screen.findByRole('dialog', { name: 'Refund payment' }));
}

describe('refund form rules', () => {
  it('reads rupees into paise', () => {
    expect(rupeesToPaise('1,500.50')).toBe(150050);
    expect(rupeesToPaise('₹ 99')).toBe(9900);
    expect(rupeesToPaise('1.234')).toBeNaN();
    expect(rupeesToPaise('abc')).toBeNaN();
  });

  it('full refunds take what is left; partial ones are checked against it', () => {
    expect(checkRefundForm({ mode: 'full', amount: '', reason: 'Cancelled' }, 468000)).toEqual({ amount: 468000, errors: {} });
    expect(checkRefundForm({ mode: 'partial', amount: '', reason: 'Cancelled' }, 468000).errors.amount).toBe('Enter the amount to refund');
    expect(checkRefundForm({ mode: 'partial', amount: '0.50', reason: 'Cancelled' }, 468000).errors.amount).toBe('The smallest refund is ₹1');
    expect(checkRefundForm({ mode: 'partial', amount: '4680.01', reason: 'Cancelled' }, 468000).errors.amount).toBe('At most ₹4,680 can be refunded');
    expect(checkRefundForm({ mode: 'partial', amount: '4680', reason: 'Cancelled' }, 468000)).toEqual({ amount: 468000, errors: {} });
    expect(checkRefundForm({ mode: 'full', amount: '', reason: ' a ' }, 468000).errors.reason).toMatch(/reason/);
  });
});

describe('Payment detail refunds (M4.13)', () => {
  it('lists refunds with status, failure reason and credit note download', async () => {
    const d = await openDetail();
    const list = within(await d.findByRole('list', { name: 'Refunds' }));
    expect(list.getByText('Processed')).toBeTruthy();
    expect(list.getByText('Failed')).toBeTruthy();
    expect(list.getByText('Bank account closed')).toBeTruthy();
    expect(list.getByText('CN/2627/000004')).toBeTruthy();
    const open = vi.fn();
    vi.stubGlobal('open', open);
    fireEvent.click(list.getByRole('button', { name: 'Download credit note CN/2627/000004' }));
    await waitFor(() => expect(open).toHaveBeenCalledWith('/api/credit-notes/x/download?s=1', '_blank'));
  });

  it('hides the Refund button without payments.refund', async () => {
    auth.permissions = [PERMS.ADMIN_ACCESS, PERMS.PAYMENTS_VIEW];
    const d = await openDetail();
    await d.findByText('CN/2627/000004');
    expect(d.queryByRole('button', { name: 'Refund' })).toBeNull();
  });

  it('hides the Refund button when nothing is left to refund', async () => {
    detail = { ...detail, refundable: 0, status: 'REFUNDED' };
    const d = await openDetail();
    await d.findByText('CN/2627/000004');
    expect(d.queryByRole('button', { name: 'Refund' })).toBeNull();
  });

  it('full refund sends what is left with a reason and an Idempotency-Key', async () => {
    const dialog = await openRefund();
    fireEvent.click(dialog.getByRole('button', { name: 'Refund ₹4,680' }));
    expect(await dialog.findByText(/at least 3 characters/)).toBeTruthy();
    expect(refundRequests).toHaveLength(0);

    fireEvent.change(dialog.getByLabelText('Reason'), { target: { value: '  Service cancelled  ' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Refund ₹4,680' }));
    await waitFor(() => expect(refundRequests).toHaveLength(1));
    expect(refundRequests[0].body).toEqual({ amount: 468000, reason: 'Service cancelled' });
    expect(refundRequests[0].key).toMatch(/^[0-9a-f-]{36}$/);
    expect(await screen.findByText(/Refund of ₹1,000 started/)).toBeTruthy();
  });

  it('partial refund: checks the amount first; a retry after an error reuses the same key', async () => {
    refundResponses.push({ status: 502, body: { message: 'The payment gateway refused the refund: try later' } });
    const dialog = await openRefund();
    fireEvent.click(dialog.getByLabelText('Partial refund'));
    fireEvent.change(dialog.getByLabelText('Amount to refund (₹)'), { target: { value: '5000' } });
    fireEvent.change(dialog.getByLabelText('Reason'), { target: { value: 'Partly delivered' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Refund ₹5,000' }));
    expect(await dialog.findByText('At most ₹4,680 can be refunded')).toBeTruthy();
    expect(refundRequests).toHaveLength(0);

    fireEvent.change(dialog.getByLabelText('Amount to refund (₹)'), { target: { value: '1,250.50' } });
    fireEvent.click(dialog.getByRole('button', { name: /^Refund ₹1,250\.5/ }));
    expect(await dialog.findByText(/refused the refund/)).toBeTruthy();
    fireEvent.click(dialog.getByRole('button', { name: /^Refund ₹1,250\.5/ }));
    await waitFor(() => expect(refundRequests).toHaveLength(2));
    expect(refundRequests.map((r) => r.body)).toEqual([
      { amount: 125050, reason: 'Partly delivered' },
      { amount: 125050, reason: 'Partly delivered' },
    ]);
    expect(refundRequests[1].key).toBe(refundRequests[0].key);
  });
});
