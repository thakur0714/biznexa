import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PERMS, type AdminCouponRow } from '@biznexa/types';
import { ToastProvider } from '@biznexa/ui';
import { ApiProvider } from '@biznexa/api-client/react';
import { CouponsView } from './coupons-view';

const auth = vi.hoisted(() => ({ permissions: [] as string[], refresh: vi.fn(async () => 'renewed-token') }));
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'Asha Admin', roles: ['ADMIN'], permissions: auth.permissions }, token: 'token', refresh: auth.refresh }),
}));

const GST = '11111111-1111-4111-8111-111111111111';

const coupon = (over: Partial<AdminCouponRow>): AdminCouponRow => ({
  id: crypto.randomUUID(),
  code: 'X',
  type: 'PERCENTAGE',
  value: 10,
  maxDiscount: null,
  minOrderValue: null,
  serviceIds: [],
  services: [],
  startsAt: null,
  expiresAt: null,
  usageLimit: null,
  perUserLimit: 1,
  isActive: true,
  createdAt: '2026-10-01T05:00:00.000Z',
  status: 'ACTIVE',
  usage: { redemptions: 0, customers: 0, discountGiven: 0, lastUsedAt: null },
  inUse: false,
  ...over,
});

let coupons: AdminCouponRow[];
let requests: { method: string; url: string; body: unknown }[];
let nextError: { status: number; body: unknown } | null;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  auth.permissions = [PERMS.ADMIN_ACCESS, PERMS.COUPONS_MANAGE];
  coupons = [
    coupon({
      code: 'DIWALI10',
      maxDiscount: 50000,
      serviceIds: [GST],
      services: [{ id: GST, name: 'GST Registration', removed: false }],
      expiresAt: '2026-11-30T18:30:00.000Z',
      usageLimit: 100,
      usage: { redemptions: 3, customers: 2, discountGiven: 150000, lastUsedAt: '2026-10-05T10:00:00.000Z' },
      inUse: true,
    }),
    coupon({ code: 'FLAT500', type: 'FIXED', value: 50000, minOrderValue: 200000, isActive: false, status: 'INACTIVE' }),
  ];
  requests = [];
  nextError = null;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (req: Request) => {
      const url = new URL(req.url);
      if (req.method === 'GET' && url.pathname === '/api/admin/coupons') return json(coupons);
      if (req.method === 'GET' && url.pathname === '/api/admin/coupons/services') return json([{ id: GST, name: 'GST Registration', isActive: true }]);
      const body = req.method === 'DELETE' ? undefined : await req.json();
      requests.push({ method: req.method, url: url.pathname, body });
      if (nextError) {
        const e = nextError;
        nextError = null;
        return json(e.body, e.status);
      }
      if (req.method === 'POST') return json(coupon({ ...(body as object), code: (body as { code: string }).code.toUpperCase() }), 201);
      if (req.method === 'PATCH') {
        const id = url.pathname.split('/').pop();
        const old = coupons.find((c) => c.id === id)!;
        const isActive = (body as { isActive?: boolean }).isActive;
        return json({ ...old, ...(body as object), status: isActive === false ? 'INACTIVE' : 'ACTIVE' });
      }
      if (req.method === 'DELETE') return json({ message: 'Coupon deleted' });
      return json({ message: 'Not found' }, 404);
    }),
  );
});

const renderView = () =>
  render(
    <ApiProvider token="token" refresh={auth.refresh}>
      <ToastProvider>
        <CouponsView />
      </ToastProvider>
    </ApiProvider>,
  );

const tableRows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1);
const rowFor = (code: string) => tableRows().find((r) => within(r).queryByText(code))!;

describe('Coupons list', () => {
  it('shows each coupon with its rules, validity and usage', async () => {
    renderView();
    await screen.findByText('DIWALI10');
    const diwali = within(rowFor('DIWALI10'));
    expect(diwali.getByText('10% off (up to ₹500)')).toBeTruthy();
    expect(diwali.getByText('GST Registration')).toBeTruthy();
    expect(diwali.getByText('Now – 30-Nov-2026')).toBeTruthy();
    expect(diwali.getByText('/ 100')).toBeTruthy();
    expect(diwali.getByText('₹1,500')).toBeTruthy();
    expect(diwali.getByText('05-Oct-2026')).toBeTruthy();
    // Used by orders: no delete.
    expect(diwali.queryByRole('button', { name: 'Delete DIWALI10' })).toBeNull();

    const flat = within(rowFor('FLAT500'));
    expect(flat.getByText('₹500 off')).toBeTruthy();
    expect(flat.getByText(/Min\. ₹2,000/)).toBeTruthy();
    expect(flat.getByText('Inactive')).toBeTruthy();
    expect(flat.getByText('Never')).toBeTruthy();
    expect(flat.getByRole('button', { name: 'Delete FLAT500' })).toBeTruthy();

    expect(screen.getByText('Usable now').nextElementSibling?.textContent).toBe('1');
    expect(screen.getByText('Times used').nextElementSibling?.textContent).toBe('3');
  });

  it('finds coupons by code or service and by status', async () => {
    renderView();
    await screen.findByText('DIWALI10');
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'gst' } });
    expect(tableRows()).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'INACTIVE' } });
    expect(tableRows()).toHaveLength(1);
    expect(rowFor('FLAT500')).toBeTruthy();
  });

  it('creates a coupon, checking the form with the API rules first', async () => {
    renderView();
    await screen.findByText('DIWALI10');
    fireEvent.click(screen.getByRole('button', { name: 'New coupon' }));
    const dialog = within(screen.getByRole('dialog', { name: 'New coupon' }));

    fireEvent.change(dialog.getByLabelText('Code'), { target: { value: 'new year' } });
    fireEvent.change(dialog.getByLabelText('Discount (%)'), { target: { value: '120' } });
    await act(async () => fireEvent.click(dialog.getByRole('button', { name: 'Create coupon' })));
    expect(dialog.getByText('Coupon codes use only letters, numbers, - and _')).toBeTruthy();
    expect(dialog.getByText('A percentage is at most 100')).toBeTruthy();
    expect(requests).toEqual([]);

    fireEvent.change(dialog.getByLabelText('Code'), { target: { value: 'newyear' } });
    fireEvent.change(dialog.getByLabelText('Discount (%)'), { target: { value: '15' } });
    fireEvent.change(dialog.getByLabelText('Maximum discount (₹)'), { target: { value: '750' } });
    fireEvent.change(dialog.getByLabelText('Last day'), { target: { value: '2027-01-31' } });
    await act(async () => fireEvent.click(dialog.getByRole('button', { name: 'Create coupon' })));

    expect(requests).toEqual([
      {
        method: 'POST',
        url: '/api/admin/coupons',
        body: expect.objectContaining({ code: 'NEWYEAR', type: 'PERCENTAGE', value: 15, maxDiscount: 75000, expiresAt: '2027-02-01T00:00:00+05:30', perUserLimit: 1 }),
      },
    ]);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New coupon' })).toBeNull());
    expect(rowFor('NEWYEAR')).toBeTruthy();
  });

  it("shows the API's field errors in the form", async () => {
    renderView();
    await screen.findByText('DIWALI10');
    fireEvent.click(screen.getByRole('button', { name: 'New coupon' }));
    const dialog = within(screen.getByRole('dialog', { name: 'New coupon' }));
    fireEvent.change(dialog.getByLabelText('Code'), { target: { value: 'DIWALI10' } });
    fireEvent.change(dialog.getByLabelText('Discount (%)'), { target: { value: '10' } });
    nextError = { status: 409, body: { message: 'Another coupon already uses this code', errors: [{ field: 'code', message: 'Another coupon already uses this code' }] } };
    await act(async () => fireEvent.click(dialog.getByRole('button', { name: 'Create coupon' })));
    expect(await dialog.findByText('Another coupon already uses this code')).toBeTruthy();
    expect(dialog.getByLabelText('Code').getAttribute('aria-invalid')).toBe('true');
  });

  it('edits a coupon; a used code cannot change', async () => {
    renderView();
    await screen.findByText('DIWALI10');
    fireEvent.click(screen.getByRole('button', { name: 'Edit DIWALI10' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Edit DIWALI10' }));
    expect((dialog.getByLabelText('Code') as HTMLInputElement).disabled).toBe(true);
    expect((dialog.getByLabelText('Last day') as HTMLInputElement).value).toBe('2026-11-30');
    expect((dialog.getByLabelText('GST Registration') as HTMLInputElement).checked).toBe(true);
    fireEvent.change(dialog.getByLabelText('Discount (%)'), { target: { value: '12' } });
    await act(async () => fireEvent.click(dialog.getByRole('button', { name: 'Save changes' })));
    expect(requests[0]).toMatchObject({
      method: 'PATCH',
      url: `/api/admin/coupons/${coupons[0].id}`,
      body: { code: 'DIWALI10', value: 12, serviceIds: [GST], expiresAt: '2026-12-01T00:00:00+05:30' },
    });
    await waitFor(() => expect(within(rowFor('DIWALI10')).getByText('12% off (up to ₹500)')).toBeTruthy());
  });

  it('deactivates after confirming, and deletes an unused coupon', async () => {
    renderView();
    await screen.findByText('DIWALI10');
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate DIWALI10' }));
    await act(async () => fireEvent.click(within(screen.getByRole('dialog', { name: 'Deactivate DIWALI10?' })).getByRole('button', { name: 'Deactivate' })));
    expect(requests[0]).toEqual({ method: 'PATCH', url: `/api/admin/coupons/${coupons[0].id}`, body: { isActive: false } });
    await waitFor(() => expect(within(rowFor('DIWALI10')).getByText('Inactive')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Delete FLAT500' }));
    await act(async () => fireEvent.click(within(screen.getByRole('dialog', { name: 'Delete FLAT500?' })).getByRole('button', { name: 'Delete' })));
    expect(requests[1]).toMatchObject({ method: 'DELETE', url: `/api/admin/coupons/${coupons[1].id}` });
    await waitFor(() => expect(screen.queryByText('FLAT500')).toBeNull());
  });

  it('is not shown without coupons.manage', () => {
    auth.permissions = [PERMS.ADMIN_ACCESS];
    renderView();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText(/not allowed|don.t have access/i)).toBeTruthy();
  });
});
