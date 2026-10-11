import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PERMS, type AdminCategoryRow, type AdminServiceDetail, type AdminServiceRow } from '@biznexa/types';
import { ToastProvider } from '@biznexa/ui';
import { ApiProvider } from '@biznexa/api-client/react';
import { ServiceEditorView } from './service-editor';

const auth = vi.hoisted(() => ({ permissions: [] as string[] }));
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'Asha Admin', roles: ['ADMIN'], permissions: auth.permissions }, token: 'token', refresh: async () => 'token' }),
}));
const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const CAT = '11111111-1111-4111-8111-111111111111';
const SUB = '44444444-4444-4444-8444-444444444444';
const SVC = '33333333-3333-4333-8333-333333333333';
const OTHER = '55555555-5555-4555-8555-555555555555';
const PKG = '22222222-2222-4222-8222-222222222222';

const categories: AdminCategoryRow[] = [
  { id: CAT, slug: 'licenses', name: 'Licenses', isActive: true, sortOrder: 1, services: 2, activeServices: 2, subcategories: [{ id: SUB, name: 'Environment', isActive: true }] },
];
const rows: AdminServiceRow[] = [
  { id: SVC, slug: 'pollution-noc', name: 'Pollution NOC', isActive: true, isPopular: false, category: { id: CAT, name: 'Licenses' }, subcategory: null, startingPrice: 149900, activePackages: 1, applications: 0, updatedAt: '2026-10-10T00:00:00.000Z' },
  { id: OTHER, slug: 'fssai-registration', name: 'FSSAI Registration', isActive: true, isPopular: true, category: { id: CAT, name: 'Licenses' }, subcategory: null, startingPrice: 99900, activePackages: 1, applications: 3, updatedAt: '2026-10-10T00:00:00.000Z' },
];

let detail: AdminServiceDetail;
let sent: { method: string; path: string; body: unknown }[];
let fail: Record<string, { status: number; body: unknown }>;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  auth.permissions = [PERMS.ADMIN_ACCESS, PERMS.SERVICES_MANAGE];
  router.replace.mockReset();
  sent = [];
  fail = {};
  detail = {
    id: SVC,
    slug: 'pollution-noc',
    name: 'Pollution NOC',
    categoryId: CAT,
    category: { id: CAT, slug: 'licenses', name: 'Licenses' },
    subcategoryId: null,
    shortDescription: 'Consent to establish from the pollution board.',
    overview: null,
    icon: null,
    imageUrl: null,
    benefits: [],
    estimatedTime: null,
    estimatedDaysMin: null,
    estimatedDaysMax: null,
    sacCode: null,
    popularity: 0,
    isPopular: false,
    isActive: true,
    recurrence: null,
    reminderOffsets: [30, 15, 7, 1],
    seoTitle: null,
    metaDescription: null,
    updatedAt: '2026-10-10T00:00:00.000Z',
    packages: [
      { id: PKG, name: 'Basic', professionalFee: 149900, governmentFee: 0, gstRate: 18, inclusions: [], estimatedTime: null, isMostPopular: false, allowPartial: false, advancePercent: null, isActive: true, inUse: true },
    ],
    documents: [],
    stages: [
      { id: crypto.randomUUID(), name: 'Filed', description: null, sortOrder: 1, inUse: true },
      { id: crypto.randomUUID(), name: 'Done', description: null, sortOrder: 2, inUse: false },
    ],
    faqs: [],
    relatedServiceIds: [],
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (req: Request) => {
      const path = new URL(req.url).pathname.replace('/api/admin/catalogue', '');
      if (req.method === 'GET') {
        if (path === '/categories') return json(categories);
        if (path === '/services') return json(rows);
        if (path === `/services/${SVC}`) return json(detail);
        return json({ message: 'Service not found' }, 404);
      }
      const body = await req.json();
      sent.push({ method: req.method, path, body });
      const failure = fail[`${req.method} ${path}`];
      if (failure) return json(failure.body, failure.status);
      if (req.method === 'POST') return json({ ...detail, ...body, id: crypto.randomUUID(), category: detail.category }, 201);
      // Echo the saved section back like the API does.
      const section = path.split('/')[3];
      if (!section) detail = { ...detail, ...body };
      else if (section === 'related') detail = { ...detail, relatedServiceIds: body };
      else detail = { ...detail, [section]: body.map((x: object) => ({ id: crypto.randomUUID(), inUse: false, sortOrder: 0, ...x })) };
      return json(detail);
    }),
  );
});

const renderEditor = (id?: string) =>
  render(
    <ApiProvider token="token" refresh={async () => 'token'}>
      <ToastProvider>
        <ServiceEditorView id={id} />
      </ToastProvider>
    </ApiProvider>,
  );

// Hidden tab panels stay in the DOM, so look inside the visible one.
const panel = () => screen.getByRole('tabpanel');
const type = (label: string | RegExp, value: string) => fireEvent.change(within(panel()).getByLabelText(label), { target: { value } });
const openTab = (name: RegExp) => fireEvent.click(screen.getByRole('tab', { name }));

describe('new service', () => {
  it('creates a service from every tab in one request and opens it', async () => {
    renderEditor();
    await screen.findByRole('heading', { name: 'New service' });

    type('Name', 'Pollution NOC (Delhi)');
    expect(within(panel()).getByLabelText<HTMLInputElement>('Web address').value).toBe('pollution-noc-delhi'); // follows the name
    type('Category', CAT);
    type('Subcategory', SUB);
    type('Short description', 'Consent to establish and operate from the state board.');
    type('Benefits', 'Done online\nExpert review');
    type('Page title', 'Pollution NOC in Delhi | BizNexa');

    openTab(/^Packages/);
    type('Professional fee (₹)', '4,999');
    type('Government fee (₹)', '1000');
    expect(within(panel()).getByText(/Customer pays ₹6,898\.82 including GST/)).toBeTruthy(); // 4,999 + 18% GST + 1,000

    openTab(/^Documents/);
    fireEvent.click(screen.getByRole('button', { name: 'Add document' }));
    type('Name', 'Site plan');

    openTab(/^FAQs/);
    fireEvent.click(screen.getByRole('button', { name: 'Add question' }));
    type('Question', 'How long is it valid?');
    type('Answer', 'Usually five years.');

    openTab(/^Related/);
    fireEvent.click(screen.getByRole('button', { name: 'Add FSSAI Registration to related services' }));

    fireEvent.click(screen.getByRole('button', { name: 'Create service' }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith(expect.stringMatching(/^\/services\/[0-9a-f-]{36}$/)));

    expect(sent).toHaveLength(1);
    const { method, path, body } = sent[0] as { method: string; path: string; body: Record<string, unknown> };
    expect([method, path]).toEqual(['POST', '/services']);
    expect(body).toMatchObject({
      name: 'Pollution NOC (Delhi)',
      slug: 'pollution-noc-delhi',
      categoryId: CAT,
      subcategoryId: SUB,
      benefits: ['Done online', 'Expert review'],
      seoTitle: 'Pollution NOC in Delhi | BizNexa',
      metaDescription: null,
      isActive: true,
      packages: [expect.objectContaining({ name: 'Basic', professionalFee: 499900, governmentFee: 100000, gstRate: 18 })],
      documents: [expect.objectContaining({ name: 'Site plan', isMandatory: true, packageIds: [] })],
      stages: [{ name: 'Application received' }, { name: 'Filed with the department' }, { name: 'Completed' }].map((s) => expect.objectContaining(s)),
      faqs: [{ question: 'How long is it valid?', answer: 'Usually five years.' }],
      relatedServiceIds: [OTHER],
    });
    expect(await screen.findByText('Pollution NOC (Delhi) is live on the website.')).toBeTruthy();
  });

  it('marks the tabs with problems and sends nothing until they are fixed', async () => {
    renderEditor();
    await screen.findByRole('heading', { name: 'New service' });
    openTab(/^Packages/);
    fireEvent.click(screen.getByRole('button', { name: 'Create service' }));

    expect(await screen.findByText(/Please fix the highlighted fields in Basic info & SEO, Packages/)).toBeTruthy();
    // jumps to the first tab with problems
    expect(screen.getByRole('tab', { name: /Basic info & SEO/ }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: /Packages 1 problem/ })).toBeTruthy();
    expect(screen.getByText('Enter the service name')).toBeTruthy();
    expect(document.getElementById('svc-category-err')?.textContent).toBe('Choose a category');
    expect(within(panel()).getByLabelText('Name').getAttribute('aria-invalid')).toBe('true');
    openTab(/^Packages/);
    expect(within(panel()).getByText('Enter an amount')).toBeTruthy();
    expect(sent).toEqual([]);
  });

  it('shows the API’s refusal on the field it is about', async () => {
    fail['POST /services'] = { status: 409, body: { message: 'Another service already uses this URL', errors: [{ field: 'slug', message: 'Another service already uses this URL' }] } };
    renderEditor();
    await screen.findByRole('heading', { name: 'New service' });
    type('Name', 'Pollution NOC');
    type('Category', CAT);
    type('Short description', 'Consent to establish and operate.');
    openTab(/^Packages/);
    type('Professional fee (₹)', '999');
    fireEvent.click(screen.getByRole('button', { name: 'Create service' }));

    await waitFor(() => expect(screen.getByRole('tab', { name: /Basic info/ }).getAttribute('aria-selected')).toBe('true'));
    expect(within(panel()).getByLabelText('Web address').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getAllByText('Another service already uses this URL')).toHaveLength(2); // notice + field
    expect(router.replace).not.toHaveBeenCalled();
  });
});

describe('editing a service', () => {
  it('saves only the sections that changed', async () => {
    renderEditor(SVC);
    await screen.findByRole('heading', { name: 'Pollution NOC' });
    expect(screen.getByRole('button', { name: 'Save changes' })).toHaveProperty('disabled', true);
    expect(screen.getByText('Ordered by customers — switch it off instead', { exact: false })).toBeTruthy();

    openTab(/^Packages/);
    type('Professional fee (₹)', '1799');
    openTab(/^FAQs/);
    fireEvent.click(screen.getByRole('button', { name: 'Add question' }));
    type('Question', 'Is it online?');
    type('Answer', 'Yes.');
    expect(screen.getByText('Unsaved changes')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Changes saved.')).toBeTruthy();
    expect(sent.map((s) => `${s.method} ${s.path}`)).toEqual([`PUT /services/${SVC}/packages`, `PUT /services/${SVC}/faqs`]);
    expect(sent[0].body).toEqual([expect.objectContaining({ id: PKG, professionalFee: 179900 })]);
    expect(screen.getByText('All changes saved')).toBeTruthy();
  });

  it('keeps what was saved and what was not when one section fails', async () => {
    fail[`PUT /services/${SVC}/stages`] = { status: 400, body: { message: 'Please check the highlighted fields', errors: [{ field: '1.name', message: 'Stage name taken' }] } };
    renderEditor(SVC);
    await screen.findByRole('heading', { name: 'Pollution NOC' });
    type('Name', 'Pollution NOC (Delhi)');
    openTab(/^Stages/);
    expect(within(panel()).queryByRole('button', { name: 'Remove Filed' })).toBeNull(); // on application timelines
    fireEvent.change(within(panel()).getAllByLabelText('Name')[1], { target: { value: 'Completed' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Stage name taken')).toBeTruthy();
    expect(sent.map((s) => s.method + ' ' + s.path)).toEqual([`PATCH /services/${SVC}`, `PUT /services/${SVC}/stages`]);
    expect(sent[0].body).toMatchObject({ name: 'Pollution NOC (Delhi)' });
    expect(screen.getByRole('tab', { name: /Stages 1 problem/ }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('heading', { name: 'Pollution NOC (Delhi)' })).toBeTruthy(); // the details were saved
    expect(screen.getByText('Unsaved changes')).toBeTruthy();

    delete fail[`PUT /services/${SVC}/stages`];
    sent = [];
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Changes saved.')).toBeTruthy();
    expect(sent.map((s) => s.method + ' ' + s.path)).toEqual([`PUT /services/${SVC}/stages`]);
  });

  it('picks related services, never the service itself', async () => {
    renderEditor(SVC);
    await screen.findByRole('heading', { name: 'Pollution NOC' });
    openTab(/^Related/);
    expect(within(panel()).queryByRole('button', { name: 'Add Pollution NOC to related services' })).toBeNull();
    type('Find services', 'fssai');
    fireEvent.click(within(panel()).getByRole('button', { name: 'Add FSSAI Registration to related services' }));
    expect(within(panel()).getByRole('heading', { name: 'Selected (1)' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Changes saved.')).toBeTruthy();
    expect(sent).toEqual([{ method: 'PUT', path: `/services/${SVC}/related`, body: [OTHER] }]);
  });

  it('says so when the service does not exist', async () => {
    renderEditor('66666666-6666-4666-8666-666666666666');
    expect(await screen.findByText('This service does not exist or was removed.')).toBeTruthy();
  });

  it('turns away staff who cannot manage services', () => {
    auth.permissions = [PERMS.ADMIN_ACCESS];
    renderEditor(SVC);
    expect(screen.getByRole('alert').textContent).toMatch(/not allowed|permission/i);
  });
});
