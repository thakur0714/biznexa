import { describe, expect, it } from 'vitest';
import { fieldOptions, formSchema, OPTION_SOURCES, type FormSchemaInput } from './index';

/** Field-level issue messages keyed by dotted path, for compact assertions. */
function issues(input: unknown): Record<string, string> {
  const res = formSchema.safeParse(input);
  if (res.success) return {};
  const out: Record<string, string> = {};
  for (const i of res.error.issues) out[i.path.join('.')] ??= i.message;
  return out;
}

const oneStep = (...fields: unknown[]) => ({ steps: [{ title: 'Details', fields }] });

/** The shape `apps/api/prisma/seed.ts` stores as version 1 for every service. */
const seedForm = {
  steps: [
    {
      title: 'Applicant details',
      fields: [
        { name: 'fullName', label: 'Full name', type: 'text', required: true },
        { name: 'email', label: 'Email', type: 'email', required: true },
        { name: 'mobile', label: 'Mobile number', type: 'tel', required: true },
        { name: 'state', label: 'State', type: 'select', optionsSource: 'states', required: true },
      ],
    },
    {
      title: 'Business details',
      fields: [
        { name: 'businessName', label: 'Business / proposed name', type: 'text', required: true },
        { name: 'businessType', label: 'Business type', type: 'select', options: ['Proprietorship', 'Partnership', 'LLP', 'Private Limited', 'OPC', 'Public Limited', 'Other'], required: true },
        { name: 'address', label: 'Business address', type: 'address', required: true },
        { name: 'notes', label: 'Anything else we should know?', type: 'textarea', required: false },
      ],
    },
  ],
};

const pvtLtd: FormSchemaInput = {
  steps: [
    {
      title: 'Company',
      fields: [
        { type: 'text', name: 'proposedName', label: 'Proposed name', required: true, maxLength: 120 },
        { type: 'number', name: 'authorisedCapital', label: 'Authorised capital (₹)', min: 100000, integer: true },
        { type: 'select', name: 'office', label: 'Registered office', options: [{ value: 'owned', label: 'Owned' }, { value: 'rented', label: 'Rented' }] },
        { type: 'file', name: 'rentAgreement', label: 'Rent agreement', showIf: { field: 'office', equals: 'rented' }, required: true },
        { type: 'multi-select', name: 'objects', label: 'Main objects', options: ['Trading', 'Manufacturing', 'Services'], minItems: 1, maxItems: 2 },
      ],
    },
    {
      title: 'Directors',
      description: 'At least two directors.',
      fields: [
        {
          type: 'repeater',
          name: 'directors',
          label: 'Directors',
          itemLabel: 'Director',
          minItems: 2,
          maxItems: 15,
          fields: [
            { type: 'text', name: 'name', label: 'Full name', required: true },
            { type: 'text', name: 'pan', label: 'PAN', pattern: '[A-Z]{5}[0-9]{4}[A-Z]', patternMessage: 'Enter a valid PAN', required: true },
            { type: 'date', name: 'dob', label: 'Date of birth', max: 'today' },
            { type: 'select', name: 'hasDin', label: 'Already has a DIN?', options: ['Yes', 'No'] },
            { type: 'text', name: 'din', label: 'DIN', showIf: { field: 'hasDin', equals: 'Yes' } },
            { type: 'address', name: 'address', label: 'Residential address' },
            { type: 'file', name: 'photo', label: 'Photograph', accept: ['image/jpeg', 'image/png'], maxSizeMb: 2 },
          ],
        },
      ],
    },
    {
      title: 'Declaration',
      fields: [{ type: 'number', name: 'shareholders', label: 'Number of shareholders', showIf: { field: 'authorisedCapital', filled: true }, min: 1, max: 200 }],
    },
  ],
};

describe('formSchema: valid forms', () => {
  it('accepts the form the seed already stores for every service', () => {
    expect(formSchema.safeParse(seedForm).success).toBe(true);
  });

  it('accepts a multi-step form with a "directors" repeater and conditions', () => {
    expect(issues(pvtLtd)).toEqual({});
  });

  it('normalises option shorthands and fills defaults', () => {
    const form = formSchema.parse(pvtLtd);
    const [company, directors] = form.steps;
    const objects = company.fields[4];
    expect(objects.type === 'multi-select' && objects.options).toEqual([
      { value: 'Trading', label: 'Trading' },
      { value: 'Manufacturing', label: 'Manufacturing' },
      { value: 'Services', label: 'Services' },
    ]);
    expect(company.fields[0].required).toBe(true);
    expect(company.fields[1].required).toBe(false);
    expect(company.fields[3]).toMatchObject({ type: 'file', accept: ['application/pdf', 'image/jpeg', 'image/png'], maxSizeMb: 10, maxFiles: 1 });
    expect(directors.fields[0]).toMatchObject({ type: 'repeater', itemLabel: 'Director' });
    expect(formSchema.parse(oneStep({ type: 'repeater', name: 'r', label: 'R', fields: [{ type: 'text', name: 'a', label: 'A' }] })).steps[0].fields[0]).toMatchObject({ itemLabel: 'Item' });
  });

  it('expands an options source', () => {
    const form = formSchema.parse(seedForm);
    const state = form.steps[0].fields[3];
    if (state.type !== 'select') throw new Error('expected a select');
    expect(fieldOptions(state)).toHaveLength(OPTION_SOURCES.states.length);
    expect(fieldOptions(state)).toContainEqual({ value: 'Delhi', label: 'Delhi' });
  });

  it('lets a repeater field depend on a top-level field declared before the repeater', () => {
    const form = oneStep(
      { type: 'select', name: 'kind', label: 'Kind', options: ['LLP', 'Company'] },
      { type: 'repeater', name: 'partners', label: 'Partners', fields: [{ type: 'text', name: 'dpin', label: 'DPIN', showIf: { field: 'kind', equals: 'LLP' } }] },
    );
    expect(issues(form)).toEqual({});
  });

  it('allows the same field name in a repeater row and at the top level', () => {
    const form = oneStep({ type: 'text', name: 'name', label: 'Name' }, { type: 'repeater', name: 'rows', label: 'Rows', fields: [{ type: 'text', name: 'name', label: 'Name' }] });
    expect(issues(form)).toEqual({});
  });

  it('accepts numeric conditions on number fields and oneOf lists on selects', () => {
    const form = oneStep(
      { type: 'number', name: 'employees', label: 'Employees' },
      { type: 'text', name: 'esic', label: 'ESIC number', showIf: { field: 'employees', equals: 10 } },
      { type: 'select', name: 'entity', label: 'Entity', options: ['LLP', 'OPC', 'Pvt'] },
      { type: 'text', name: 'cin', label: 'CIN', showIf: { field: 'entity', oneOf: ['OPC', 'Pvt'] } },
    );
    expect(issues(form)).toEqual({});
  });
});

describe('formSchema: structure', () => {
  it('needs at least one step, and each step at least one field', () => {
    expect(issues({ steps: [] })).toEqual({ steps: 'A form needs at least one step' });
    expect(issues({ steps: [{ title: 'Empty', fields: [] }] })).toEqual({ 'steps.0.fields': 'A step needs at least one field' });
  });

  it('rejects unknown field types and misspelt keys', () => {
    expect(issues(oneStep({ type: 'checkbox', name: 'a', label: 'A' }))).toHaveProperty(['steps.0.fields.0.type']);
    expect(issues(oneStep({ type: 'text', name: 'a', label: 'A', requried: true }))).toHaveProperty(['steps.0.fields.0']);
    expect(issues({ ...oneStep({ type: 'text', name: 'a', label: 'A' }), version: 2 })).toHaveProperty(['']);
  });

  it('rejects field names that are not identifiers, and blank labels', () => {
    const out = issues(oneStep({ type: 'text', name: 'full name', label: 'A' }, { type: 'text', name: '1st', label: ' ' }));
    expect(out['steps.0.fields.0.name']).toMatch(/letters, digits/);
    expect(out['steps.0.fields.1.name']).toMatch(/letters, digits/);
    expect(out['steps.0.fields.1.label']).toBe('Enter a label');
  });

  it('rejects duplicate field names across steps and within a repeater row', () => {
    const form = {
      steps: [
        { title: 'One', fields: [{ type: 'text', name: 'pan', label: 'PAN' }] },
        {
          title: 'Two',
          fields: [
            { type: 'text', name: 'pan', label: 'PAN again' },
            { type: 'repeater', name: 'rows', label: 'Rows', fields: [{ type: 'text', name: 'x', label: 'X' }, { type: 'number', name: 'x', label: 'X2' }] },
          ],
        },
      ],
    };
    expect(issues(form)).toEqual({
      'steps.1.fields.0.name': 'Another field is already named "pan"',
      'steps.1.fields.1.fields.1.name': 'Another field in "rows" is already named "x"',
    });
  });

  it('does not allow a repeater inside a repeater', () => {
    const inner = { type: 'repeater', name: 'inner', label: 'Inner', fields: [{ type: 'text', name: 'a', label: 'A' }] };
    expect(issues(oneStep({ type: 'repeater', name: 'outer', label: 'Outer', fields: [inner] }))).toHaveProperty(['steps.0.fields.0.fields.0.type']);
  });
});

describe('formSchema: field options', () => {
  it('rejects an invalid regular expression and a message without a pattern', () => {
    expect(issues(oneStep({ type: 'text', name: 'a', label: 'A', pattern: '[A-Z' }, { type: 'tel', name: 'b', label: 'B', patternMessage: 'Bad' }))).toEqual({
      'steps.0.fields.0.pattern': 'Not a valid regular expression',
      'steps.0.fields.1.patternMessage': 'Pattern message without a pattern',
    });
  });

  it('rejects ranges whose minimum is above the maximum', () => {
    const out = issues(
      oneStep(
        { type: 'text', name: 'a', label: 'A', minLength: 10, maxLength: 5 },
        { type: 'number', name: 'b', label: 'B', min: 10, max: 1 },
        { type: 'multi-select', name: 'c', label: 'C', options: ['x', 'y'], minItems: 3, maxItems: 2 },
        { type: 'repeater', name: 'd', label: 'D', minItems: 5, maxItems: 1, fields: [{ type: 'text', name: 'e', label: 'E' }] },
        { type: 'date', name: 'f', label: 'F', min: '2026-12-31', max: '2026-01-01' },
      ),
    );
    expect(Object.keys(out).sort()).toEqual(['steps.0.fields.0.minLength', 'steps.0.fields.1.min', 'steps.0.fields.2.minItems', 'steps.0.fields.3.minItems', 'steps.0.fields.4.min']);
  });

  it('accepts equal min and max', () => {
    expect(issues(oneStep({ type: 'number', name: 'n', label: 'N', min: 3, max: 3 }))).toEqual({});
  });

  it('checks date bounds are real dates or "today"', () => {
    expect(issues(oneStep({ type: 'date', name: 'a', label: 'A', min: '2026-02-30' }))).toEqual({ 'steps.0.fields.0.min': 'Not a real date' });
    expect(issues(oneStep({ type: 'date', name: 'a', label: 'A', max: '31/12/2026' }))).toEqual({ 'steps.0.fields.0.max': 'Use YYYY-MM-DD or "today"' });
    expect(issues(oneStep({ type: 'date', name: 'a', label: 'A', min: '2000-01-01', max: 'today' }))).toEqual({});
  });

  it('needs exactly one of options or optionsSource, with no duplicate values', () => {
    expect(issues(oneStep({ type: 'select', name: 'a', label: 'A' }))).toEqual({ 'steps.0.fields.0.options': 'Give either options or optionsSource' });
    expect(issues(oneStep({ type: 'select', name: 'a', label: 'A', options: ['x'], optionsSource: 'states' }))).toEqual({ 'steps.0.fields.0.options': 'Give either options or optionsSource' });
    expect(issues(oneStep({ type: 'multi-select', name: 'a', label: 'A', options: ['x', { value: 'x', label: 'Ex' }] }))).toEqual({ 'steps.0.fields.0.options': 'Option "x" is listed twice' });
    expect(issues(oneStep({ type: 'select', name: 'a', label: 'A', optionsSource: 'countries' }))).toHaveProperty(['steps.0.fields.0.optionsSource']);
  });

  it('limits file fields to types the API can verify', () => {
    expect(issues(oneStep({ type: 'file', name: 'a', label: 'A', accept: ['application/zip'] }))).toHaveProperty(['steps.0.fields.0.accept.0']);
    expect(issues(oneStep({ type: 'file', name: 'a', label: 'A', accept: ['image/png', 'image/png'] }))).toEqual({ 'steps.0.fields.0.accept': 'A file type is listed twice' });
    expect(issues(oneStep({ type: 'file', name: 'a', label: 'A', maxSizeMb: 0 }))).toHaveProperty(['steps.0.fields.0.maxSizeMb']);
  });
});

describe('formSchema: conditional show', () => {
  it('only refers to fields declared earlier (no forward references, so no cycles)', () => {
    const form = oneStep({ type: 'text', name: 'a', label: 'A', showIf: { field: 'b', filled: true } }, { type: 'text', name: 'b', label: 'B', showIf: { field: 'a', filled: true } });
    expect(issues(form)).toEqual({ 'steps.0.fields.0.showIf.field': '"b" is not a field declared before this one' });
    expect(issues(oneStep({ type: 'text', name: 'a', label: 'A', showIf: { field: 'a', filled: true } }))).toHaveProperty(['steps.0.fields.0.showIf.field']);
    expect(issues(oneStep({ type: 'text', name: 'a', label: 'A', showIf: { field: 'ghost', equals: 'x' } }))).toHaveProperty(['steps.0.fields.0.showIf.field']);
  });

  it('does not let a top-level field depend on a field inside a repeater row', () => {
    const form = oneStep({ type: 'repeater', name: 'rows', label: 'Rows', fields: [{ type: 'text', name: 'x', label: 'X' }] }, { type: 'text', name: 'y', label: 'Y', showIf: { field: 'x', filled: true } });
    expect(issues(form)).toHaveProperty(['steps.0.fields.1.showIf.field']);
  });

  it('only compares values that are options of the select', () => {
    const select = { type: 'select', name: 'office', label: 'Office', options: ['Owned', 'Rented'] };
    expect(issues(oneStep(select, { type: 'file', name: 'b', label: 'B', showIf: { field: 'office', equals: 'Leased' } }))).toEqual({ 'steps.0.fields.1.showIf.field': '"Leased" is not an option of "office"' });
    expect(issues(oneStep(select, { type: 'file', name: 'b', label: 'B', showIf: { field: 'office', oneOf: ['Owned', 'rented'] } }))).toEqual({ 'steps.0.fields.1.showIf.field': '"rented" is not an option of "office"' });
  });

  it('compares numbers with numbers and text with text', () => {
    expect(issues(oneStep({ type: 'number', name: 'n', label: 'N' }, { type: 'text', name: 't', label: 'T', showIf: { field: 'n', equals: '5' } }))).toEqual({ 'steps.0.fields.1.showIf.field': 'Compare "n" with numbers' });
    expect(issues(oneStep({ type: 'text', name: 's', label: 'S' }, { type: 'text', name: 't', label: 'T', showIf: { field: 's', equals: 5 } }))).toEqual({ 'steps.0.fields.1.showIf.field': 'Compare "s" with text' });
  });

  it('checks file, address and repeater fields only with "filled"', () => {
    const file = { type: 'file', name: 'doc', label: 'Doc' };
    expect(issues(oneStep(file, { type: 'text', name: 't', label: 'T', showIf: { field: 'doc', equals: 'x' } }))).toEqual({ 'steps.0.fields.1.showIf.field': 'A file field can only be checked with "filled"' });
    expect(issues(oneStep(file, { type: 'text', name: 't', label: 'T', showIf: { field: 'doc', filled: false } }))).toEqual({});
  });

  it('rejects a condition with no operator or two operators', () => {
    expect(issues(oneStep({ type: 'text', name: 'a', label: 'A' }, { type: 'text', name: 'b', label: 'B', showIf: { field: 'a' } }))).toHaveProperty(['steps.0.fields.1.showIf']);
    expect(issues(oneStep({ type: 'text', name: 'a', label: 'A' }, { type: 'text', name: 'b', label: 'B', showIf: { field: 'a', equals: 'x', filled: true } }))).toHaveProperty(['steps.0.fields.1.showIf']);
  });
});

describe('Aadhaar numbers (M12.2)', () => {
  it('refuses a field named after Aadhaar, also inside a repeater', () => {
    expect(issues(oneStep({ name: 'aadhaarNumber', label: 'Number', type: 'text' }))['steps.0.fields.0.name']).toMatch(/never be collected/);
    expect(issues(oneStep({ name: 'ownerAadhar', label: 'ID', type: 'number' }))['steps.0.fields.0.name']).toMatch(/never be collected/);
    const repeater = { name: 'directors', label: 'Directors', type: 'repeater', fields: [{ name: 'uidaiId', label: 'ID', type: 'text' }] };
    expect(issues(oneStep(repeater))['steps.0.fields.0.fields.0.name']).toMatch(/never be collected/);
  });

  it('refuses a label that asks for the number', () => {
    for (const label of ['Aadhaar number', 'Aadhar No.', 'Aadhaar card no', 'UID number']) {
      expect(issues(oneStep({ name: 'idNumber', label, type: 'text' }))['steps.0.fields.0.name'], label).toMatch(/never be collected/);
    }
  });

  it('allows labels that only mention Aadhaar', () => {
    expect(issues(oneStep({ name: 'ownerName', label: 'Full name (as on Aadhaar)', type: 'text' }))).toEqual({});
    expect(issues(oneStep({ name: 'contactMobile', label: 'Mobile number linked to Aadhaar', type: 'tel' }))).toEqual({});
  });
});
