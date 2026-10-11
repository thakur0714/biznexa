import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { formSchema, PERMS, type AdminServiceDetail, type FormSchemaInput, type FormSchemaVersion } from '@biznexa/types';
import { ToastProvider } from '@biznexa/ui';
import { ApiProvider } from '@biznexa/api-client/react';
import { FormBuilderView } from './form-builder';
import { toJson } from './builder';

const auth = vi.hoisted(() => ({ permissions: [] as string[] }));
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'Asha Admin', roles: ['ADMIN'], permissions: auth.permissions }, token: 'token', refresh: async () => 'token' }),
}));

const SVC = '33333333-3333-4333-8333-333333333333';
const service = { id: SVC, name: 'Private Limited Company' } as AdminServiceDetail;

let versions: FormSchemaVersion[];
let posted: { path: string; body: unknown }[];
let saveFailure: { status: number; body: unknown } | null;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function addVersion(input: FormSchemaInput, isCurrent: boolean, applications = 0) {
  if (isCurrent) for (const v of versions) v.isCurrent = false;
  const v: FormSchemaVersion = {
    id: crypto.randomUUID(),
    serviceId: SVC,
    version: versions.length + 1,
    isCurrent,
    createdAt: '2026-10-10T10:00:00.000Z',
    applications,
    schema: formSchema.parse(input),
  };
  versions.push(v);
  return v;
}

const listBody = () => {
  const sorted = [...versions].sort((a, b) => b.version - a.version);
  return {
    latest: sorted[0]?.version ?? null,
    current: versions.find((v) => v.isCurrent)?.version ?? null,
    versions: sorted.map(({ schema, ...v }) => ({ ...v, steps: schema.steps.length, fields: 0 })),
  };
};

beforeEach(() => {
  auth.permissions = [PERMS.ADMIN_ACCESS, PERMS.SERVICES_MANAGE];
  versions = [];
  posted = [];
  saveFailure = null;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (req: Request) => {
      const path = new URL(req.url).pathname.replace(`/api/admin/catalogue/services/${SVC}`, '');
      if (req.method === 'GET') {
        if (path === '') return json(service);
        if (path === '/form-schemas') return json(listBody());
        const v = versions.find((x) => `/form-schemas/${x.version}` === path);
        return v ? json(v) : json({ message: 'Form version not found' }, 404);
      }
      const body = req.headers.get('content-type')?.includes('json') ? await req.json() : undefined;
      posted.push({ path, body });
      if (path === '/form-schemas') {
        if (saveFailure) return json(saveFailure.body, saveFailure.status);
        return json(addVersion(body.schema, body.activate ?? true), 201);
      }
      const m = /^\/form-schemas\/(\d+)\/activate$/.exec(path);
      if (m) {
        const v = versions.find((x) => x.version === Number(m[1]))!;
        for (const x of versions) x.isCurrent = x === v;
        return json(v);
      }
      return json({ message: 'Not found' }, 404);
    }),
  );
});

const renderBuilder = () =>
  render(
    <ApiProvider token="token" refresh={async () => 'token'}>
      <ToastProvider>
        <FormBuilderView serviceId={SVC} />
      </ToastProvider>
    </ApiProvider>,
  );

const editor = () => screen.getByLabelText<HTMLTextAreaElement>('Form JSON');
const setJson = (value: unknown) => fireEvent.change(editor(), { target: { value: typeof value === 'string' ? value : toJson(value) } });
const preview = () => screen.getByRole('region', { name: 'Preview' });
const outline = () => {
  fireEvent.click(screen.getByRole('tab', { name: 'Steps & fields' }));
  return screen.getByRole('tabpanel', { name: 'Steps & fields' });
};
const steps = () => within(within(preview()).getByRole('list', { name: 'Steps' })).getAllByRole('button').map((b) => b.textContent);

/** What an admin types for a Pvt Ltd form: 3 steps, a "directors" repeater with a conditional DIN. */
const PVT_LTD: FormSchemaInput = {
  steps: [
    { title: 'Company', fields: [{ type: 'text', name: 'companyName', label: 'Proposed name', required: true }] },
    {
      title: 'Directors',
      fields: [
        {
          type: 'repeater',
          name: 'directors',
          label: 'Directors',
          itemLabel: 'Director',
          required: true,
          minItems: 2,
          fields: [
            { type: 'text', name: 'fullName', label: 'Full name', required: true },
            { type: 'select', name: 'hasDin', label: 'Has a DIN?', options: ['Yes', 'No'], required: true },
            { type: 'text', name: 'din', label: 'DIN', required: true, showIf: { field: 'hasDin', equals: 'Yes' } },
          ],
        },
      ],
    },
    { title: 'Office', fields: [{ type: 'address', name: 'office', label: 'Registered office', required: true }] },
  ],
};

describe('form builder', () => {
  it('builds a 3-step form with a directors repeater; the preview matches and it saves as version 1', async () => {
    renderBuilder();
    expect(await screen.findByText(/has no application form yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Start blank' }));
    fireEvent.click(screen.getByRole('tab', { name: 'JSON' }));
    setJson(PVT_LTD);

    expect(screen.getByText('No problems found.')).toBeTruthy();
    expect(steps()).toEqual(['1. Company', '2. Directors', '3. Office']);
    // The outline lists the same steps and the repeater's sub-fields.
    const o = within(outline());
    expect(o.getAllByRole('heading').map((h) => h.textContent)).toEqual(['Step 1: Company', 'Step 2: Directors', 'Step 3: Office']);
    expect(o.getByText('Has a DIN?')).toBeTruthy();
    expect(o.getByText(/shown if hasDin is "Yes"/)).toBeTruthy();

    // Step 1 → Next is blocked until the required field is answered.
    const p = () => within(preview());
    fireEvent.click(p().getByRole('button', { name: 'Next' }));
    expect(p().getByText('This field is required')).toBeTruthy();
    fireEvent.change(p().getByLabelText('Proposed name'), { target: { value: 'Acme Tech' } });
    fireEvent.click(p().getByRole('button', { name: 'Next' }));

    // Step 2: the repeater needs two directors; DIN appears only when "Yes" is chosen.
    expect(p().getByRole('heading', { name: 'Directors' })).toBeTruthy();
    fireEvent.click(p().getByRole('button', { name: 'Next' }));
    expect(p().getByText('Add at least one director')).toBeTruthy();
    fireEvent.click(p().getByRole('button', { name: 'Add director' }));
    fireEvent.click(p().getByRole('button', { name: 'Add director' }));
    expect(p().getAllByRole('heading', { level: 4 }).map((h) => h.textContent)).toEqual(['Director 1', 'Director 2']);
    expect(p().queryByLabelText('DIN')).toBeNull();
    const [first, second] = p().getAllByRole('listitem').filter((li) => /Director \d/.test(li.textContent ?? ''));
    fireEvent.change(within(first).getByLabelText('Full name'), { target: { value: 'Ravi Kumar' } });
    fireEvent.change(within(first).getByLabelText('Has a DIN?'), { target: { value: 'Yes' } });
    fireEvent.change(within(second).getByLabelText('Full name'), { target: { value: 'Meena Iyer' } });
    fireEvent.change(within(second).getByLabelText('Has a DIN?'), { target: { value: 'No' } });
    expect(within(first).getByLabelText('DIN')).toBeTruthy();
    expect(within(second).queryByLabelText('DIN')).toBeNull();
    fireEvent.click(p().getByRole('button', { name: 'Next' }));
    expect(within(first).getByText('This field is required')).toBeTruthy(); // DIN of director 1
    fireEvent.change(within(first).getByLabelText('DIN'), { target: { value: '01234567' } });
    fireEvent.click(p().getByRole('button', { name: 'Next' }));

    // Step 3: the address, then a full check shows what would be stored.
    expect(p().getByRole('heading', { name: 'Office' })).toBeTruthy();
    fireEvent.change(p().getByLabelText('Address line 1'), { target: { value: '12 MG Road' } });
    fireEvent.change(p().getByLabelText('City'), { target: { value: 'Bengaluru' } });
    fireEvent.change(p().getByLabelText('State'), { target: { value: 'Karnataka' } });
    fireEvent.change(p().getByLabelText('PIN code'), { target: { value: '56000' } });
    fireEvent.click(p().getByRole('button', { name: 'Check answers' }));
    expect(p().getByText('Enter a valid 6-digit PIN code')).toBeTruthy();
    fireEvent.change(p().getByLabelText('PIN code'), { target: { value: '560001' } });
    fireEvent.click(p().getByRole('button', { name: 'Check answers' }));
    const stored = JSON.parse(p().getByText(/All answers pass/).querySelector('pre')!.textContent!);
    expect(stored).toEqual({
      companyName: 'Acme Tech',
      directors: [
        { fullName: 'Ravi Kumar', hasDin: 'Yes', din: '01234567' },
        { fullName: 'Meena Iyer', hasDin: 'No' },
      ],
      office: { line1: '12 MG Road', city: 'Bengaluru', state: 'Karnataka', pincode: '560001' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save as version 1' }));
    await screen.findByText('Version 1 saved. New applications use it from now on.');
    expect(posted).toEqual([{ path: '/form-schemas', body: { schema: PVT_LTD, activate: true } }]);
    const row = within(screen.getByRole('table', { name: 'Form versions' })).getAllByRole('row')[1];
    expect(within(row).getByText('In use')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save as version 2' }).hasAttribute('disabled')).toBe(true); // nothing changed
  });

  it('opens the current version without the defaults the API filled in', async () => {
    addVersion(PVT_LTD, true, 4);
    renderBuilder();
    await screen.findByText(/Editing a copy of version 1 \(in use\)/);
    expect(JSON.parse(editor().value)).toEqual(PVT_LTD);
    expect(steps()).toEqual(['1. Company', '2. Directors', '3. Office']);
  });

  it('starts from the example form', async () => {
    renderBuilder();
    fireEvent.click(await screen.findByRole('button', { name: 'Start from the example' }));
    expect(steps()).toEqual(['1. Company details', '2. Directors', '3. Registered office']);
    expect(screen.getByRole('button', { name: 'Save as version 1' }).hasAttribute('disabled')).toBe(false);
  });

  it('shows syntax and schema problems with their line, blocks saving and keeps the last good preview', async () => {
    addVersion(PVT_LTD, true);
    renderBuilder();
    await screen.findByText(/Editing a copy of version 1/);
    const save = () => screen.getByRole('button', { name: 'Save as version 2' });

    setJson(editor().value.replace('"title": "Company",', '"title": "Company"'));
    expect(screen.getByRole('button', { name: /^Line 5, column \d+:/ })).toBeTruthy();
    expect(screen.getByText('The JSON has a syntax error')).toBeTruthy();
    expect(save().hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('Showing the last version without problems.')).toBeTruthy();
    expect(steps()).toEqual(['1. Company', '2. Directors', '3. Office']);
    expect(within(outline()).getByText(/Fix the JSON/)).toBeTruthy();

    const bad = structuredClone(PVT_LTD) as { steps: { fields: Record<string, unknown>[] }[] };
    bad.steps[2].fields[0].showIf = { field: 'later', filled: true };
    bad.steps[0].fields[0].requried = true;
    setJson(bad);
    const problems = screen.getByText(/2 problems to fix before saving/).parentElement!;
    expect(within(problems).getByText(/Step 1 “Company” › “Proposed name”/)).toBeTruthy();
    expect(within(problems).getByText(/"later" is not a field declared before this one/)).toBeTruthy();
    expect(save().hasAttribute('disabled')).toBe(true);
    // The outline marks the fields with problems.
    expect(within(outline()).getAllByText('1 problem')).toHaveLength(2);
  });

  it('reorders fields and steps from the outline, and the JSON and preview follow', async () => {
    addVersion(PVT_LTD, true);
    renderBuilder();
    await screen.findByText(/Editing a copy of version 1/);
    const o = () => within(outline());

    fireEvent.click(o().getByRole('button', { name: 'Move Office up' }));
    expect(steps()).toEqual(['1. Company', '2. Office', '3. Directors']);
    fireEvent.click(o().getByRole('button', { name: 'Move Full name down' }));
    const directors = JSON.parse(editor().value).steps[2].fields[0];
    expect(directors.fields.map((f: { name: string }) => f.name)).toEqual(['hasDin', 'fullName', 'din']);

    // Moving the first field of a step up puts it at the end of the step before.
    fireEvent.click(o().getByRole('button', { name: 'Move Registered office up' }));
    expect(JSON.parse(editor().value).steps.map((s: { fields: unknown[] }) => s.fields.length)).toEqual([2, 0, 1]);
    expect(screen.getByText(/A step needs at least one field/)).toBeTruthy();

    fireEvent.click(o().getByRole('button', { name: 'Remove Office' }));
    fireEvent.change(o().getAllByLabelText('New field type')[0], { target: { value: 'email' } });
    fireEvent.click(o().getAllByRole('button', { name: 'Add field' })[0]);
    expect(JSON.parse(editor().value).steps[0].fields[2]).toEqual({ type: 'email', name: 'email', label: 'New email' });
    expect(screen.getByText('No problems found.')).toBeTruthy();
    expect(within(preview()).getByLabelText('New email (optional)')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(JSON.parse(editor().value)).toEqual(PVT_LTD);
  });

  it('"Edit" jumps to the field in the JSON', async () => {
    addVersion(PVT_LTD, true);
    renderBuilder();
    await screen.findByText(/Editing a copy of version 1/);
    fireEvent.click(within(outline()).getByRole('button', { name: 'Edit DIN in JSON' }));
    expect(screen.getByRole('tab', { name: 'JSON' }).getAttribute('aria-selected')).toBe('true');
    const el = editor();
    expect(document.activeElement).toBe(el);
    expect(el.value.slice(el.selectionStart)).toMatch(/^\{\s+"type": "text",\s+"name": "din"/);
  });

  it('saves a draft without switching versions, and puts API errors on their line', async () => {
    addVersion(PVT_LTD, true, 3);
    renderBuilder();
    await screen.findByText(/Editing a copy of version 1/);
    setJson({ ...PVT_LTD, steps: PVT_LTD.steps.slice(0, 2) });

    saveFailure = { status: 400, body: { message: 'Please check the highlighted fields', errors: [{ field: 'schema.steps.1.fields.0.name', message: 'Name clash' }] } };
    fireEvent.click(screen.getByRole('button', { name: 'Save as version 2' }));
    expect(await screen.findByText('Please check the highlighted fields')).toBeTruthy();
    expect(screen.getByText(/Step 2 “Directors” › “Directors” › name: Name clash/)).toBeTruthy();

    saveFailure = null;
    fireEvent.click(screen.getByLabelText('Use for new applications straight away'));
    fireEvent.click(screen.getByRole('button', { name: 'Save as version 2' }));
    await screen.findByText('Version 2 saved as a draft. New applications still use version 1.');
    expect(posted.at(-1)!.body).toMatchObject({ activate: false });
    expect(versions.find((v) => v.isCurrent)!.version).toBe(1);
  });

  it('opens an older version (asking first if there are unsaved edits) and makes it current', async () => {
    addVersion(PVT_LTD, false);
    addVersion({ steps: [PVT_LTD.steps[0]] }, true);
    renderBuilder();
    await screen.findByText(/Editing a copy of version 2 \(in use\)/);
    expect(steps()).toEqual(['1. Company']);

    setJson({ steps: [{ ...PVT_LTD.steps[0], title: 'Changed' }] });
    fireEvent.click(screen.getByRole('button', { name: 'Open version 1' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Discard and open' }));
    await screen.findByText(/Editing a copy of version 1\./);
    expect(steps()).toEqual(['1. Company', '2. Directors', '3. Office']);

    fireEvent.click(screen.getByRole('button', { name: 'Use version 1 for new applications' }));
    await screen.findByText('New applications now use version 1.');
    expect(posted.at(-1)!.path).toBe('/form-schemas/1/activate');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Use version 1 for new applications' })).toBeNull());
    expect(screen.getByRole('button', { name: 'Use version 2 for new applications' })).toBeTruthy();
  });

  it('is not available without services.manage', async () => {
    auth.permissions = [PERMS.ADMIN_ACCESS];
    renderBuilder();
    expect(screen.queryByText('Application form')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reports an unknown service', async () => {
    vi.mocked(fetch).mockImplementation(async () => json({ message: 'Service not found' }, 404));
    renderBuilder();
    expect(await screen.findByText('This service does not exist or was removed.')).toBeTruthy();
  });
});
