import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { vi } from 'vitest';
import { conditionMet, formSchema, GENERIC_SERVICE_FORM, SERVICE_FORMS, type FormField, type FormSchema, type FormSchemaInput } from '@biznexa/types';
import { ApplicationForm, issueLabel } from './application-form';
import { capitalsOnly, fieldLabel } from './fields';

const TODAY = '2026-10-10';
const parse = (input: FormSchemaInput): FormSchema => formSchema.parse(input);
const GROUPS = new Set<FormField['type']>(['multi-select', 'address', 'repeater']);

/** The control (or group) a field renders, found by its accessible name. */
function controlsFor(f: FormField, scope: HTMLElement = document.body) {
  const w = within(scope);
  return GROUPS.has(f.type) ? w.getAllByRole('group', { name: fieldLabel(f) }) : w.getAllByLabelText(fieldLabel(f));
}

const COMPANY: FormSchemaInput = {
  steps: [
    {
      title: 'Company',
      description: 'About the company you are registering.',
      fields: [
        { type: 'text', name: 'companyName', label: 'Proposed name', required: true },
        { type: 'text', name: 'pan', label: 'PAN', pattern: String.raw`[A-Z]{5}[0-9]{4}[A-Z]`, patternMessage: 'Enter a PAN like ABCDE1234F' },
        { type: 'number', name: 'capital', label: 'Authorised capital', required: true, integer: true, min: 100000 },
        { type: 'select', name: 'hasGst', label: 'Registered under GST?', required: true, options: ['Yes', 'No'] },
        { type: 'text', name: 'gstin', label: 'GSTIN', required: true, showIf: { field: 'hasGst', equals: 'Yes' } },
      ],
    },
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
          maxItems: 3,
          fields: [
            { type: 'text', name: 'fullName', label: 'Full name', required: true },
            { type: 'select', name: 'hasDin', label: 'Has a DIN?', required: true, options: ['Yes', 'No'] },
            { type: 'text', name: 'din', label: 'DIN', required: true, pattern: String.raw`\d{8}`, showIf: { field: 'hasDin', equals: 'Yes' } },
          ],
        },
      ],
    },
    {
      title: 'Office',
      fields: [
        { type: 'address', name: 'office', label: 'Registered office', required: true },
        { type: 'date', name: 'startDate', label: 'Start date', min: 'today' },
        { type: 'multi-select', name: 'services', label: 'Also interested in', options: ['GST filing', 'Accounting', 'Trademark'], maxItems: 2 },
        { type: 'textarea', name: 'notes', label: 'Anything else' },
        { type: 'email', name: 'email', label: 'Email', required: true },
        { type: 'tel', name: 'phone', label: 'Phone' },
        { type: 'file', name: 'logo', label: 'Logo', accept: ['image/png'], maxSizeMb: 1 },
      ],
    },
  ],
};

const type = (label: string | RegExp, value: string, scope: HTMLElement = document.body) => fireEvent.change(within(scope).getByLabelText(label), { target: { value } });
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const heading = () => screen.getByRole('heading', { level: 2 });
const summary = () => screen.getByRole('alert');

describe('ApplicationForm renders every seeded form', () => {
  const forms = [...Object.entries(SERVICE_FORMS), ['generic', GENERIC_SERVICE_FORM] as const];

  const checkField = (f: FormField, scope: HTMLElement = document.body) => {
    if (f.showIf && !conditionMet(f.showIf, {})) {
      expect(screen.queryByLabelText(fieldLabel(f))).toBeNull();
      return;
    }
    const [control] = controlsFor(f, scope);
    expect(control).toBeTruthy();
    if (f.type === 'repeater') {
      fireEvent.click(within(control).getByRole('button', { name: `Add ${f.itemLabel.toLowerCase()}` }));
      const row = within(control).getAllByRole('listitem')[0];
      for (const sub of f.fields) {
        if (!sub.showIf || conditionMet(sub.showIf, {})) {
          expect(controlsFor(sub, row).length).toBeGreaterThan(0);
        }
      }
    }
  };

  it.each(forms)('%s: every step, field and repeater row', (_slug, input) => {
    const form = parse(input);
    for (const [i, step] of form.steps.entries()) {
      const { unmount } = render(<ApplicationForm form={form} initialStep={i} onSubmit={() => {}} today={TODAY} />);
      expect(screen.getByText(`Step ${i + 1} of ${form.steps.length}`)).toBeTruthy();
      expect(heading().textContent).toBe(step.title);
      for (const f of step.fields) {
        checkField(f);
      }
      unmount();
    }
  });

  it('walks the generic form from start to submit and gets the cleaned answers', async () => {
    const onSubmit = vi.fn();
    render(<ApplicationForm form={parse(GENERIC_SERVICE_FORM)} onSubmit={onSubmit} today={TODAY} />);
    type('Full name', 'Asha Verma');
    type('Email', 'asha@example.com');
    type('Mobile number', '9876543210');
    type('State', 'Punjab');
    click('Next');
    expect(heading().textContent).toBe('Business');
    type('PAN of the business (optional)', 'abcde1234f');
    click('Next');
    type('What do you need help with?', '  Need a partnership deed.  ');
    type('Best way to reach you', 'WhatsApp');
    click('Submit');
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][0]).toEqual({
      contactName: 'Asha Verma',
      contactEmail: 'asha@example.com',
      contactMobile: '9876543210',
      state: 'Punjab',
      businessPan: 'ABCDE1234F',
      requirement: 'Need a partnership deed.',
      preferredContact: 'WhatsApp',
    });
  });
});

describe('ApplicationForm steps and validation', () => {
  it('shows progress, blocks Next with a linked error summary and moves focus', () => {
    render(<ApplicationForm form={parse(COMPANY)} onSubmit={() => {}} today={TODAY} />);
    expect(screen.getByText('Step 1 of 3')).toBeTruthy();
    const steps = within(screen.getByRole('list', { name: 'Steps' }));
    expect(steps.getByText('Company').closest('[aria-current]')?.getAttribute('aria-current')).toBe('step');
    expect(steps.queryAllByRole('button')).toHaveLength(0); // later steps cannot be skipped to
    expect(screen.getByText('About the company you are registering.')).toBeTruthy();

    click('Next');
    expect(heading().textContent).toBe('Company');
    expect(document.activeElement).toBe(summary());
    expect(within(summary()).getByText('3 answers need attention')).toBeTruthy();
    const name = screen.getByLabelText('Proposed name');
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(name.getAttribute('aria-describedby')!)?.textContent).toBe('This field is required');

    fireEvent.click(within(summary()).getByText('Proposed name: This field is required'));
    expect(document.activeElement).toBe(name);

    // Fixing a field clears its message only.
    type('Proposed name', 'Acme Tech');
    expect(name.getAttribute('aria-invalid')).toBe('false');
    expect(within(summary()).getByText('2 answers need attention')).toBeTruthy();

    type('Authorised capital', '5000');
    type('Registered under GST?', 'No');
    click('Next');
    expect(within(summary()).getByText('Authorised capital: Enter 100000 or more')).toBeTruthy();
    type('Authorised capital', '100000');
    click('Next');

    expect(heading().textContent).toBe('Directors');
    expect(document.activeElement).toBe(heading());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Step 2 of 3')).toBeTruthy();

    // A visited step can be reopened from the step list, keeping its answers.
    fireEvent.click(within(screen.getByRole('list', { name: 'Steps' })).getByRole('button', { name: /Company/ }));
    expect(screen.getByLabelText<HTMLInputElement>('Proposed name').value).toBe('Acme Tech');
    click('Next');
    click('Back');
    expect(heading().textContent).toBe('Company');
  });

  it('shows conditional fields, upper-cases capital-only formats and drops hidden answers', async () => {
    const onSubmit = vi.fn();
    const onChange = vi.fn();
    render(
      <ApplicationForm
        form={parse(COMPANY)}
        onSubmit={onSubmit}
        onChange={onChange}
        today={TODAY}
        initialStep={2}
        initialValues={{
          companyName: 'Acme',
          capital: '200000',
          directors: [
            { fullName: 'Ravi', hasDin: 'No' },
            { fullName: 'Meena', hasDin: 'No' },
          ],
          office: { line1: '1 MG Road', city: 'Pune', state: 'Maharashtra', pincode: '411001' },
          email: 'a@b.co',
        }}
      />,
    );
    click('Back');
    click('Back');
    expect(screen.queryByLabelText('GSTIN')).toBeNull();
    type('Registered under GST?', 'Yes');
    type('GSTIN', '03ABCDE1234F1Z5');
    type('PAN (optional)', 'abcde1234f');
    expect(screen.getByLabelText<HTMLInputElement>('PAN (optional)').value).toBe('ABCDE1234F');
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ pan: 'ABCDE1234F', gstin: '03ABCDE1234F1Z5' }));
    // Turning GST off hides GSTIN; its answer is kept while editing but not submitted.
    type('Registered under GST?', 'No');
    expect(screen.queryByLabelText('GSTIN')).toBeNull();
    click('Next');
    click('Next');
    click('Submit');
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    const data = onSubmit.mock.calls[0][0];
    expect(data).toMatchObject({ pan: 'ABCDE1234F', capital: 200000, hasGst: 'No' });
    expect(data).not.toHaveProperty('gstin');
  });

  it('adds and removes repeater rows with per-row conditions and limits', async () => {
    render(<ApplicationForm form={parse(COMPANY)} initialStep={1} onSubmit={() => {}} today={TODAY} />);
    const group = () => screen.getByRole('group', { name: 'Directors' });
    expect(within(group()).getByText('Add at least 2. Up to 3.')).toBeTruthy();
    click('Next');
    expect(within(group()).getByText('Add at least one director')).toBeTruthy();

    vi.useFakeTimers();
    click('Add director');
    await act(() => vi.runAllTimers());
    vi.useRealTimers();
    expect(document.activeElement?.textContent).toBe('Director 1');
    click('Add director');
    click('Add director');
    expect(screen.getByRole('button', { name: 'Add director' }).hasAttribute('disabled')).toBe(true);
    click('Remove director 3');

    const [first, second] = within(group()).getAllByRole('listitem');
    type('Full name', 'Ravi Kumar', first);
    type('Has a DIN?', 'Yes', first);
    type('Full name', 'Meena Iyer', second);
    type('Has a DIN?', 'No', second);
    expect(within(second).queryByLabelText('DIN')).toBeNull();
    await act(() => click('Next'));
    expect(within(summary()).getByText('Directors › Director 1 › DIN: This field is required')).toBeTruthy();
    expect(within(first).getByLabelText('DIN').getAttribute('aria-invalid')).toBe('true');
    type('DIN', '01234567', first);
    click('Next');
    expect(heading().textContent).toBe('Office');
  });

  it('labels address parts and validates them; submit returns to the first step with a problem', async () => {
    const onSubmit = vi.fn();
    render(<ApplicationForm form={parse(COMPANY)} initialStep={2} onSubmit={onSubmit} today={TODAY} />);
    const office = screen.getByRole('group', { name: 'Registered office' });
    type('Address line 1', '12 MG Road', office);
    type('City', 'Bengaluru', office);
    type('State', 'Karnataka', office);
    type('PIN code', '56000', office);
    type('Email', 'hello@acme.in');
    type('Start date (optional)', '2026-10-01');
    fireEvent.click(screen.getByLabelText('GST filing'));
    fireEvent.click(screen.getByLabelText('Accounting'));
    fireEvent.click(screen.getByLabelText('Trademark'));
    click('Submit');
    // Step 1 is unanswered, so it opens with only its own messages.
    expect(heading().textContent).toBe('Company');
    expect(within(summary()).getByText('Proposed name: This field is required')).toBeTruthy();

    type('Proposed name', 'Acme');
    type('Authorised capital', '100000');
    type('Registered under GST?', 'No');
    click('Next');
    const rows = () => within(screen.getByRole('group', { name: 'Directors' }));
    click('Add director');
    click('Add director');
    for (const [i, row] of rows().getAllByRole('listitem').entries()) {
      type('Full name', `Director ${i}`, row);
      type('Has a DIN?', 'No', row);
    }
    click('Next');
    click('Submit');
    const s = within(summary());
    expect(s.getByText('Registered office › PIN code: Enter a valid 6-digit PIN code')).toBeTruthy();
    expect(s.getByText('Start date: Choose today or a later date')).toBeTruthy();
    expect(s.getByText('Also interested in: Choose at most 2')).toBeTruthy();
    expect(screen.getByLabelText('PIN code').getAttribute('aria-invalid')).toBe('true');

    type('PIN code', '560001');
    type('Start date (optional)', '2026-10-12');
    fireEvent.click(screen.getByLabelText('Trademark'));
    click('Submit');
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ office: { line1: '12 MG Road', city: 'Bengaluru', state: 'Karnataka', pincode: '560001' }, services: ['GST filing', 'Accounting'] });
  });

  it('disables Submit while saving', async () => {
    let finish!: () => void;
    const onSubmit = vi.fn(() => new Promise<void>((r) => (finish = r)));
    const form = parse({ steps: [{ title: 'One', fields: [{ type: 'text', name: 'a', label: 'A' }] }] });
    render(<ApplicationForm form={form} onSubmit={onSubmit} submitLabel="Continue" />);
    expect(screen.queryByRole('list', { name: 'Steps' })).toBeNull(); // one step: no step list
    click('Continue');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Submitting…' }).hasAttribute('disabled')).toBe(true));
    await act(() => finish());
    expect(screen.getByRole('button', { name: 'Continue' }).hasAttribute('disabled')).toBe(false);
  });
});

describe('File field', () => {
  const form = parse(COMPANY);
  const id1 = '6f1c4f0e-1111-4c7b-9a51-0d2b8a0f0001';
  const png = (name: string, size = 10) => new File([new Uint8Array(size)], name, { type: 'image/png' });

  it('checks type and size, uploads through the callback and stores the ids', async () => {
    const uploadFiles = vi.fn((files: File[]) => Promise.resolve(files.map(() => id1)));
    const onChange = vi.fn();
    render(<ApplicationForm form={form} initialStep={2} onSubmit={() => {}} onChange={onChange} uploadFiles={uploadFiles} today={TODAY} />);
    const input = screen.getByLabelText('Logo (optional)');
    expect(input.getAttribute('accept')).toContain('image/png');
    expect(screen.getByText('PNG, up to 1 MB.')).toBeTruthy();

    fireEvent.change(input, { target: { files: [new File(['x'], 'logo.pdf', { type: 'application/pdf' })] } });
    expect(screen.getByText('logo.pdf is not a PNG file')).toBeTruthy();
    fireEvent.change(input, { target: { files: [png('big.png', 2 * 1024 * 1024)] } });
    expect(screen.getByText('big.png is larger than 1 MB')).toBeTruthy();
    expect(uploadFiles).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { files: [png('logo.png')] } });
    await waitFor(() => expect(screen.getByText('logo.png')).toBeTruthy());
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ logo: [id1] }));
    click('Remove logo.png');
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ logo: [] }));
  });

  it('shows an upload failure and files saved earlier', async () => {
    const uploadFiles = vi.fn(() => Promise.reject(new Error('The file could not be uploaded')));
    render(<ApplicationForm form={form} initialStep={2} initialValues={{ logo: [id1] }} onSubmit={() => {}} uploadFiles={uploadFiles} today={TODAY} />);
    expect(screen.getByText('File 1 attached')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Logo (optional)'), { target: { files: [png('logo.png')] } });
    await waitFor(() => expect(screen.getByText('The file could not be uploaded')).toBeTruthy());
    expect(screen.getByLabelText('Logo (optional)').getAttribute('aria-invalid')).toBe('true');
  });
});

describe('helpers', () => {
  it('capitalsOnly spots formats that only accept capitals', () => {
    expect(capitalsOnly(String.raw`[A-Z]{5}[0-9]{4}[A-Z]`)).toBe(true);
    expect(capitalsOnly(String.raw`\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]`)).toBe(true);
    expect(capitalsOnly('[A-Za-z ]+')).toBe(false);
    expect(capitalsOnly(String.raw`\d{8}`)).toBe(false);
    expect(capitalsOnly()).toBe(false);
  });

  it('issueLabel names nested fields', () => {
    const form = parse(COMPANY);
    expect(issueLabel(form, ['directors', 1, 'din'])).toBe('Directors › Director 2 › DIN');
    expect(issueLabel(form, ['office', 'pincode'])).toBe('Registered office › PIN code');
    expect(issueLabel(form, ['services'])).toBe('Also interested in');
  });
});

describe('ApplicationForm: problems found by the server (M3.9)', () => {
  const TWO_STEPS = parse({
    steps: [
      { title: 'About you', fields: [{ type: 'text', name: 'name', label: 'Name', required: true }] },
      {
        title: 'Partners',
        fields: [{ type: 'repeater', name: 'partners', label: 'Partners', itemLabel: 'Partner', required: true, fields: [{ type: 'text', name: 'pan', label: 'PAN', required: true }] }],
      },
    ],
  });
  const answers = { name: 'Asha', partners: [{ pan: 'AAAPA1234F' }] };

  it('shows returned field problems on the first step that has one, ignoring fields the form lacks', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ 'partners.0.pan': 'PAN does not match the partner', name: 'Name is already used', unknown: 'not shown' });
    render(<ApplicationForm form={TWO_STEPS} initialStep={1} initialValues={answers} onSubmit={onSubmit} today={TODAY} />);
    await act(() => click('Submit'));
    expect(onSubmit).toHaveBeenCalledWith(answers);
    expect(heading().textContent).toBe('About you');
    expect(within(summary()).getByText('Name: Name is already used')).toBeTruthy();
    expect(screen.queryByText(/not shown/)).toBeNull();
    expect(screen.getByLabelText('Name').getAttribute('aria-invalid')).toBe('true');

    // The other step's problem is shown when the customer gets there and submits again.
    onSubmit.mockResolvedValueOnce({ 'partners.0.pan': 'PAN does not match the partner' });
    click('Next');
    await act(() => click('Submit'));
    expect(within(summary()).getByText('Partners › Partner 1 › PAN: PAN does not match the partner')).toBeTruthy();
  });

  it('shows nothing when the server accepts the answers', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ApplicationForm form={TWO_STEPS} initialStep={1} initialValues={answers} onSubmit={onSubmit} today={TODAY} />);
    await act(() => click('Submit'));
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(heading().textContent).toBe('Partners');
  });
});
