import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PERMS, type AdminCategoryRow, type AdminServiceRow } from '@biznexa/types';
import { ToastProvider } from '@biznexa/ui';
import { ApiProvider } from '@biznexa/api-client/react';
import { CatalogueView } from './catalogue-view';

const auth = vi.hoisted(() => ({ permissions: [] as string[], refresh: vi.fn(() => Promise.resolve('renewed-token')) }));
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'Asha Admin', roles: ['ADMIN'], permissions: auth.permissions }, token: 'token', refresh: auth.refresh }),
}));

const CAT_LICENCES = '11111111-1111-4111-8111-111111111111';
const CAT_TAX = '22222222-2222-4222-8222-222222222222';

const service = (over: Partial<AdminServiceRow>): AdminServiceRow => ({
  id: crypto.randomUUID(),
  slug: 'x',
  name: 'X',
  isActive: true,
  isPopular: false,
  category: { id: CAT_LICENCES, name: 'Licences' },
  subcategory: null,
  startingPrice: 99900,
  activePackages: 1,
  applications: 0,
  updatedAt: '2026-10-10T00:00:00.000Z',
  ...over,
});

let services: AdminServiceRow[];
let categories: AdminCategoryRow[];
let patches: { url: string; body: unknown; auth: string | null }[];
let failNextPatch: boolean;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  auth.permissions = [PERMS.ADMIN_ACCESS, PERMS.SERVICES_MANAGE];
  services = [
    service({ slug: 'fssai-registration', name: 'FSSAI Registration', isPopular: true, applications: 4 }),
    service({ slug: 'pollution-noc', name: 'Pollution NOC', subcategory: 'Environment' }),
    service({ slug: 'gst-registration', name: 'GST Registration', category: { id: CAT_TAX, name: 'Tax' } }),
    service({ slug: 'old-service', name: 'Old Service', isActive: false, startingPrice: null, activePackages: 0 }),
  ];
  categories = [
    { id: CAT_LICENCES, slug: 'licences', name: 'Licences', isActive: true, sortOrder: 1, services: 3, activeServices: 2, subcategories: [] },
    { id: CAT_TAX, slug: 'tax', name: 'Tax', isActive: true, sortOrder: 2, services: 1, activeServices: 1, subcategories: [] },
  ];
  patches = [];
  failNextPatch = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (req: Request) => {
      const url = new URL(req.url);
      if (req.method === 'GET' && url.pathname === '/api/admin/catalogue/services') {
        expect(url.searchParams.get('includeInactive')).toBe('true');
        return json(services);
      }
      if (req.method === 'GET' && url.pathname === '/api/admin/catalogue/categories') return json(categories);
      if (req.method === 'PATCH') {
        if (failNextPatch) {
          failNextPatch = false;
          return json({ message: 'Slug already in use' }, 409);
        }
        patches.push({ url: url.pathname, body: await req.json(), auth: req.headers.get('authorization') });
        return json({});
      }
      return json({ message: 'Not found' }, 404);
    }),
  );
});

const renderView = () =>
  render(
    <ApiProvider token="token" refresh={auth.refresh}>
      <ToastProvider>
        <CatalogueView />
      </ToastProvider>
    </ApiProvider>,
  );

const tableRows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1);
const rowFor = (name: string) => tableRows().find((r) => within(r).queryByText(name))!;

describe('Catalogue services list', () => {
  it('lists active and inactive services with price, category and status', async () => {
    renderView();
    await screen.findByText('FSSAI Registration');
    expect(tableRows()).toHaveLength(4);
    expect(within(rowFor('FSSAI Registration')).getByText('Popular')).toBeTruthy();
    expect(within(rowFor('FSSAI Registration')).getByText('₹999')).toBeTruthy();
    expect(within(rowFor('Pollution NOC')).getByText('Environment')).toBeTruthy();
    expect(within(rowFor('Old Service')).getByText('Inactive')).toBeTruthy();
    expect(within(rowFor('Old Service')).getByText('No active package')).toBeTruthy();
    expect(screen.getByText('Showing 1–4 of 4')).toBeTruthy();
  });

  it('links each service to its editor and offers a new one', async () => {
    renderView();
    await screen.findByText('FSSAI Registration');
    const id = services[0].id;
    expect(screen.getByRole('link', { name: 'Edit FSSAI Registration' }).getAttribute('href')).toBe(`/services/${id}`);
    expect(within(rowFor('FSSAI Registration')).getByRole('link', { name: 'FSSAI Registration' }).getAttribute('href')).toBe(`/services/${id}`);
    expect(screen.getByRole('link', { name: 'New service' }).getAttribute('href')).toBe('/services/new');
  });

  it('finds services by search, category and status', async () => {
    renderView();
    await screen.findByText('FSSAI Registration');

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'pollution' } });
    expect(tableRows().map((r) => r.textContent)).toEqual([expect.stringContaining('Pollution NOC')]);

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'TAX' } }); // category name, any case
    expect(tableRows()).toHaveLength(1);
    expect(rowFor('GST Registration')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: CAT_LICENCES } });
    expect(tableRows()).toHaveLength(3);
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'inactive' } });
    expect(tableRows()).toHaveLength(1);
    expect(rowFor('Old Service')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'nothing like this' } });
    expect(screen.getByText('Nothing matches these filters')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(tableRows()).toHaveLength(4);
  });

  it('deactivates a service after confirming, then reactivates it', async () => {
    renderView();
    await screen.findByText('FSSAI Registration');

    fireEvent.click(screen.getByRole('button', { name: 'Deactivate FSSAI Registration' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toMatch(/hidden from the website/);
    expect(dialog.textContent).toMatch(/4 existing applications are not changed/);
    await act(() => fireEvent.click(within(dialog).getByRole('button', { name: 'Deactivate' })));

    const id = services[0].id;
    expect(patches).toEqual([{ url: `/api/admin/catalogue/services/${id}`, body: { isActive: false }, auth: 'Bearer token' }]);
    await waitFor(() => expect(within(rowFor('FSSAI Registration')).getByText('Inactive')).toBeTruthy());
    expect(screen.getByText('FSSAI Registration is hidden from the website.')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();

    await act(() => fireEvent.click(screen.getByRole('button', { name: 'Reactivate FSSAI Registration' })));
    expect(patches[1]).toMatchObject({ body: { isActive: true } });
    await waitFor(() => expect(within(rowFor('FSSAI Registration')).getByText('Active')).toBeTruthy());
    expect(screen.getByText('FSSAI Registration is live on the website again.')).toBeTruthy();
  });

  it('keeps the row unchanged and shows the API message when saving fails', async () => {
    renderView();
    await screen.findByText('Old Service');
    failNextPatch = true;
    await act(() => fireEvent.click(screen.getByRole('button', { name: 'Reactivate Old Service' })));
    expect(await screen.findByText('Slug already in use')).toBeTruthy();
    expect(within(rowFor('Old Service')).getByText('Inactive')).toBeTruthy();
  });

  it('cancelling the confirmation changes nothing', async () => {
    renderView();
    await screen.findByText('Pollution NOC');
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate Pollution NOC' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(patches).toEqual([]);
    expect(within(rowFor('Pollution NOC')).getByText('Active')).toBeTruthy();
  });
});

describe('Catalogue paging', () => {
  it('shows 25 per page, stays on the page after a change, and a new search starts from page 1', async () => {
    services = Array.from({ length: 30 }, (_, i) => service({ slug: `svc-${i}`, name: `Service ${String(i + 1).padStart(2, '0')}` }));
    renderView();
    await screen.findByText('Service 01');
    expect(tableRows()).toHaveLength(25);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Showing 26–30 of 30')).toBeTruthy();

    await act(() => fireEvent.click(screen.getByRole('button', { name: 'Deactivate Service 27' })));
    await act(() => fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Deactivate' })));
    await waitFor(() => expect(within(rowFor('Service 27')).getByText('Inactive')).toBeTruthy());
    expect(screen.getByText('Showing 26–30 of 30')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'service' } });
    expect(screen.getByText('Showing 1–25 of 30')).toBeTruthy();
  });
});

describe('Catalogue categories list', () => {
  it('shows service counts, deactivates a category and jumps to its services', async () => {
    renderView();
    await screen.findByText('FSSAI Registration');
    fireEvent.click(screen.getByRole('button', { name: 'Categories (2)' }));
    expect(within(rowFor('Licences')).getByText('2 of 3 active')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Deactivate Tax category' }));
    expect(screen.getByRole('dialog').textContent).toMatch(/Its services stay live/);
    await act(() => fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Deactivate' })));
    expect(patches).toEqual([{ url: `/api/admin/catalogue/categories/${CAT_TAX}`, body: { isActive: false }, auth: 'Bearer token' }]);
    await waitFor(() => expect(within(rowFor('Tax')).getByText('Inactive')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: '2 of 3 active' }));
    expect((screen.getByLabelText('Category') as HTMLSelectElement).value).toBe(CAT_LICENCES);
    expect(tableRows()).toHaveLength(3);
  });
});

describe('access and errors', () => {
  it('shows "not allowed" without services.manage', () => {
    auth.permissions = [PERMS.ADMIN_ACCESS];
    renderView();
    expect(screen.getByRole('alert').textContent).toMatch(/not allowed/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('renews an expired session once and retries', async () => {
    const real = fetch as unknown as (r: Request) => Promise<Response>;
    let first = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (req: Request) => {
        if (first) {
          first = false;
          return json({ message: 'Unauthorized' }, 401);
        }
        return real(req);
      }),
    );
    renderView();
    await screen.findByText('FSSAI Registration');
    expect(auth.refresh).toHaveBeenCalled();
  });

  it('offers a retry when the catalogue cannot be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('offline'))));
    renderView();
    expect(await screen.findByText(/Could not reach BizNexa/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});
