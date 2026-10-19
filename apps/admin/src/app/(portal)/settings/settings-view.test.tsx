import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PERMS, gstinCheckChar, type SellerSettings } from '@biznexa/types';
import { ToastProvider } from '@biznexa/ui';
import { ApiProvider } from '@biznexa/api-client/react';
import { SettingsView } from './settings-view';
import { formFieldOf, sellerFormErrors, toSellerForm, toSellerRequest } from './seller-form';

const auth = vi.hoisted(() => ({ permissions: [] as string[], refresh: vi.fn(async () => 'renewed-token') }));
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'Asha Admin', roles: ['ADMIN'], permissions: auth.permissions }, token: 'token', refresh: auth.refresh }),
}));

const PUNJAB_GSTIN = '03AABCB1234F1Z' + gstinCheckChar('03AABCB1234F1Z');
const address = { line1: '12 Mall Road', city: 'Ludhiana', state: 'Punjab', pincode: '141001' };

/** As seeded: no address yet, the state stored as a code. */
const seeded: SellerSettings = {
  name: 'BizNexa',
  legalName: 'BizNexa (legal entity name to be added)',
  gstin: null,
  email: 'support@biznexa.com',
  phone: null,
  address: null,
  state: 'Punjab',
  invoicePrefix: 'BN',
  updatedAt: '2026-10-01T05:00:00.000Z',
};

let settings: SellerSettings;
let puts: unknown[];
let nextError: { status: number; body: unknown } | null;
let mobileVersion = { minSupportedVersion: '1.0.0', updatedAt: '2026-10-01T05:00:00.000Z' };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  auth.permissions = [PERMS.ADMIN_ACCESS, PERMS.SETTINGS_MANAGE];
  settings = seeded;
  mobileVersion = { minSupportedVersion: '1.0.0', updatedAt: '2026-10-01T05:00:00.000Z' };
  puts = [];
  nextError = null;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (req: Request) => {
      const url = new URL(req.url);

      if (url.pathname === '/api/admin/settings/mobile-version') {
        if (req.method === 'GET') return json(mobileVersion);
        const body = await req.json();
        mobileVersion = { minSupportedVersion: body.minSupportedVersion, updatedAt: new Date().toISOString() };
        return json(mobileVersion);
      }

      if (url.pathname === '/api/admin/settings/rejection-presets') {
        if (req.method === 'GET') return json({ presets: [], updatedAt: '2026-10-01T05:00:00.000Z' });
        return json({ presets: await req.json(), updatedAt: new Date().toISOString() });
      }

      if (url.pathname !== '/api/admin/settings/seller') return json({ message: 'Not found' }, 404);
      if (req.method === 'GET') return json(settings);
      const body = (await req.json()) as { address: typeof address; gstin: string; invoicePrefix: string };
      puts.push(body);
      if (nextError) return json(nextError.body, nextError.status);
      settings = { ...settings, ...body, gstin: body.gstin || null, state: body.address.state, updatedAt: '2026-10-11T06:00:00.000Z' };
      return json(settings);
    }),
  );
});

const renderView = () =>
  render(
    <ApiProvider token="token" refresh={auth.refresh}>
      <ToastProvider>
        <SettingsView />
      </ToastProvider>
    </ApiProvider>,
  );

const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save details' }));

describe('Seller settings page', () => {
  it('needs settings.manage', () => {
    auth.permissions = [PERMS.ADMIN_ACCESS];
    renderView();
    expect(screen.queryByText('Seller details for GST and invoices.')).toBeNull();
  });

  it('loads the seeded details, preselects the stored state and warns that the address is missing', async () => {
    renderView();
    expect(await screen.findByDisplayValue('BizNexa')).toBeTruthy();
    expect((screen.getByLabelText('State') as HTMLSelectElement).value).toBe('Punjab');
    expect((screen.getByLabelText('Invoice number prefix') as HTMLInputElement).value).toBe('BN');
    expect(screen.getByText(/registered address is not set yet/)).toBeTruthy();
  });

  it('checks the fields before sending', async () => {
    renderView();
    await screen.findByDisplayValue('BizNexa');
    type('Invoice number prefix', 'bn/');
    save();
    expect(await screen.findByText('Enter the address')).toBeTruthy();
    expect(screen.getByText('Enter the city')).toBeTruthy();
    expect(screen.getByText('Enter a valid 6-digit PIN code')).toBeTruthy();
    expect(screen.getByText('Use letters and digits only')).toBeTruthy();
    expect(puts).toHaveLength(0);
  });

  it('saves the details and shows the API field errors on the right inputs', async () => {
    renderView();
    await screen.findByDisplayValue('BizNexa');
    type('Legal name', 'BizNexa Private Limited');
    type('GSTIN', PUNJAB_GSTIN.toLowerCase());
    type('Address line 1', address.line1);
    type('City', address.city);
    type('PIN code', address.pincode);

    nextError = { status: 400, body: { message: 'Please check the highlighted fields', errors: [{ field: 'address.pincode', message: 'PIN code not found' }] } };
    save();
    expect(await screen.findByText('PIN code not found')).toBeTruthy();

    nextError = null;
    save();
    await waitFor(() => expect(screen.queryByText(/registered address is not set yet/)).toBeNull());
    expect(puts.at(-1)).toMatchObject({ legalName: 'BizNexa Private Limited', gstin: PUNJAB_GSTIN, address, invoicePrefix: 'BN' });
    expect(screen.getByText('Last changed 11-Oct-2026')).toBeTruthy();
  });

  it('loads and saves the mobile app version', async () => {
    renderView();
    const versionInput = await screen.findByLabelText('Minimum supported version');
    fireEvent.change(versionInput, { target: { value: '1.5.0' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]);
    expect(await screen.findByText('Mobile app version saved')).toBeTruthy();
    expect(mobileVersion.minSupportedVersion).toBe('1.5.0');
  });
});

describe('seller form helpers', () => {
  it('maps the API fields to inputs', () => {
    expect(formFieldOf('address.pincode')).toBe('pincode');
    expect(formFieldOf('gstin')).toBe('gstin');
  });

  it('round-trips saved settings and checks with the API schema', () => {
    const saved = { ...seeded, address, gstin: PUNJAB_GSTIN };
    const form = toSellerForm(saved);
    expect(sellerFormErrors(form)).toEqual({});
    expect(toSellerRequest(form)).toMatchObject({ gstin: PUNJAB_GSTIN, address: { ...address, line2: '' } });
    expect(sellerFormErrors({ ...form, state: 'Delhi' })).toEqual({ gstin: 'This GSTIN is registered in Punjab, not Delhi' });
  });
});
