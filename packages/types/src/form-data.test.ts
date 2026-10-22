import { describe, expect, it } from 'vitest';
import { formDataValidator, formFileIds, formSchema, isEmptyValue, stepFieldNames, todayInIndia, type FormDataOptions, type FormSchemaInput } from './index';

const TODAY = '2026-10-10';
const FILE_A = '0b6d8e8a-6f0e-4a8e-9a57-3f1f2b1f5c11';
const FILE_B = '5d2f4d7c-1c34-4f0f-8b8f-7d1e6b9a2c22';

/** Validate `data` against a one-step form made of `fields`. */
function check(fields: unknown[], data: unknown, options: FormDataOptions = {}) {
  const form = formSchema.parse({ steps: [{ title: 'Step', fields }] } satisfies { steps: unknown[] });
  const res = formDataValidator(form, { today: TODAY, ...options }).safeParse(data);
  const errors: Record<string, string> = {};
  if (!res.success) for (const i of res.error.issues) errors[i.path.join('.')] ??= i.message;
  return { data: res.success ? res.data : undefined, errors };
}

describe('formDataValidator: text-like fields', () => {
  it('trims text, drops empty optional answers and requires required ones', () => {
    const fields = [
      { type: 'text', name: 'name', label: 'Name', required: true },
      { type: 'textarea', name: 'notes', label: 'Notes' },
    ];
    expect(check(fields, { name: '  Asha Rao ', notes: '   ' }).data).toEqual({ name: 'Asha Rao' });
    expect(check(fields, { name: '   ' }).errors).toEqual({ name: 'This field is required' });
    expect(check(fields, {}).errors).toEqual({ name: 'This field is required' });
  });

  it('applies min/max length, with a default cap when no maxLength is set', () => {
    const fields = [{ type: 'text', name: 'a', label: 'A', minLength: 3, maxLength: 5 }, { type: 'text', name: 'b', label: 'B' }];
    expect(check(fields, { a: 'ab' }).errors).toEqual({ a: 'Use at least 3 characters' });
    expect(check(fields, { a: 'abcdef' }).errors).toEqual({ a: 'Use at most 5 characters' });
    expect(check(fields, { b: 'x'.repeat(501) }).errors).toEqual({ b: 'Use at most 500 characters' });
    expect(check(fields, { a: 'abc', b: 'x'.repeat(500) }).errors).toEqual({});
  });

  it('matches a pattern against the whole value, with the custom message', () => {
    const fields = [{ type: 'text', name: 'pan', label: 'PAN', pattern: '[A-Z]{5}[0-9]{4}[A-Z]', patternMessage: 'Enter a valid PAN' }];
    expect(check(fields, { pan: 'ABCDE1234F' }).data).toEqual({ pan: 'ABCDE1234F' });
    expect(check(fields, { pan: 'xxABCDE1234Fxx' }).errors).toEqual({ pan: 'Enter a valid PAN' });
    expect(check([{ type: 'text', name: 'a', label: 'A', pattern: 'a|b' }], { a: 'ab' }).errors).toEqual({ a: 'This is not in the expected format' });
  });

  it('checks email and phone formats', () => {
    const fields = [{ type: 'email', name: 'email', label: 'Email' }, { type: 'tel', name: 'phone', label: 'Phone' }];
    expect(check(fields, { email: 'asha@example.in', phone: '+91 98765-43210' }).errors).toEqual({});
    expect(check(fields, { email: 'asha@', phone: 'call me' }).errors).toEqual({ email: 'Enter a valid email', phone: 'Enter a valid phone number' });
  });

  it('rejects a non-string value', () => {
    expect(check([{ type: 'text', name: 'a', label: 'A' }], { a: 42 }).errors).toEqual({ a: 'Enter text' });
  });
});

describe('formDataValidator: number and date', () => {
  it('accepts numbers and numeric strings, and applies integer/min/max', () => {
    const fields = [{ type: 'number', name: 'capital', label: 'Capital', min: 100000, max: 10000000, integer: true }];
    expect(check(fields, { capital: '500000' }).data).toEqual({ capital: 500000 });
    expect(check(fields, { capital: 0 }).errors).toEqual({ capital: 'Enter 100000 or more' });
    expect(check(fields, { capital: 100000.5 }).errors).toEqual({ capital: 'Enter a whole number' });
    expect(check(fields, { capital: '1e9' }).errors).toEqual({ capital: 'Enter a number' });
    expect(check(fields, { capital: 20000000 }).errors).toEqual({ capital: 'Enter 10000000 or less' });
  });

  it('treats 0 as an answer, not as empty', () => {
    expect(check([{ type: 'number', name: 'n', label: 'N', required: true }], { n: 0 }).data).toEqual({ n: 0 });
  });

  it('accepts real ISO dates within limits, with "today" from the options', () => {
    const fields = [{ type: 'date', name: 'dob', label: 'Date of birth', min: '1900-01-01', max: 'today' }];
    expect(check(fields, { dob: '1990-05-17' }).data).toEqual({ dob: '1990-05-17' });
    expect(check(fields, { dob: TODAY }).errors).toEqual({});
    expect(check(fields, { dob: '2026-10-11' }).errors).toEqual({ dob: 'Date cannot be in the future' });
    expect(check(fields, { dob: '1899-12-31' }).errors).toEqual({ dob: 'Choose 1 Jan 1900 or later' });
    expect(check(fields, { dob: '1990-02-30' }).errors).toEqual({ dob: 'Enter a real date' });
    expect(check(fields, { dob: '17/05/1990' }).errors).toEqual({ dob: 'Enter a date' });
    expect(check([{ type: 'date', name: 'start', label: 'Start', min: 'today' }], { start: '2026-10-09' }).errors).toEqual({ start: 'Choose today or a later date' });
  });

  it('works out "today" in Indian time', () => {
    expect(todayInIndia(new Date('2026-10-09T18:29:00Z'))).toBe('2026-10-09');
    expect(todayInIndia(new Date('2026-10-09T18:31:00Z'))).toBe('2026-10-10');
  });
});

describe('formDataValidator: choices', () => {
  it('accepts only listed options in a select, including an options source', () => {
    const fields = [
      { type: 'select', name: 'office', label: 'Office', options: [{ value: 'owned', label: 'Owned' }, { value: 'rented', label: 'Rented' }], required: true },
      { type: 'select', name: 'state', label: 'State', optionsSource: 'states' },
    ];
    expect(check(fields, { office: 'rented', state: 'Kerala' }).errors).toEqual({});
    expect(check(fields, { office: 'Rented', state: 'Kerela' }).errors).toEqual({ office: 'Choose one of the listed options', state: 'Choose one of the listed options' });
    expect(check(fields, {}).errors).toEqual({ office: 'Choose an option' });
  });

  it('checks multi-select options, duplicates and item counts', () => {
    const fields = [{ type: 'multi-select', name: 'objects', label: 'Objects', options: ['Trading', 'Manufacturing', 'Services'], minItems: 2, maxItems: 2 }];
    expect(check(fields, { objects: ['Trading', 'Services'] }).data).toEqual({ objects: ['Trading', 'Services'] });
    expect(check(fields, { objects: ['Trading'] }).errors).toEqual({ objects: 'Choose at least 2' });
    expect(check(fields, { objects: ['Trading', 'Services', 'Manufacturing'] }).errors).toEqual({ objects: 'Choose at most 2' });
    expect(check(fields, { objects: ['Trading', 'Mining'] }).errors).toEqual({ objects: 'Choose only the listed options' });
    expect(check(fields, { objects: ['Trading', 'Trading'] }).errors).toEqual({ objects: 'An option is chosen twice' });
    expect(check(fields, { objects: 'Trading' }).errors).toEqual({ objects: 'Choose options' });
  });

  it('lets an optional multi-select with minItems be left empty', () => {
    expect(check([{ type: 'multi-select', name: 'm', label: 'M', options: ['a', 'b'], minItems: 2 }], { m: [] }).data).toEqual({});
  });
});

describe('formDataValidator: file and address', () => {
  it('takes a list of stored-file ids, up to maxFiles', () => {
    const fields = [{ type: 'file', name: 'rent', label: 'Rent agreement', required: true }, { type: 'file', name: 'photos', label: 'Photos', maxFiles: 2 }];
    expect(check(fields, { rent: [FILE_A], photos: [FILE_A, FILE_B] }).errors).toEqual({});
    expect(check(fields, { rent: [] }).errors).toEqual({ rent: 'Upload a file' });
    expect(check(fields, { rent: [FILE_A, FILE_B] }).errors).toEqual({ rent: 'Upload one file' });
    expect(check(fields, { rent: ['../../etc/passwd'] }).errors).toEqual({ 'rent.0': 'Upload the file again' });
    expect(check(fields, { rent: [FILE_A], photos: [FILE_B, FILE_B] }).errors).toEqual({ photos: 'A file is attached twice' });
  });

  it('validates each part of an address and reports it on that part', () => {
    const fields = [{ type: 'address', name: 'office', label: 'Office', required: true }];
    const good = { line1: ' 12 MG Road ', line2: '', city: 'Bengaluru', state: 'Karnataka', pincode: '560001' };
    expect(check(fields, { office: good }).data).toEqual({ office: { line1: '12 MG Road', city: 'Bengaluru', state: 'Karnataka', pincode: '560001' } });
    expect(check(fields, { office: { ...good, city: '', state: 'Bangalore', pincode: '060001' } }).errors).toEqual({
      'office.city': 'Enter the city',
      'office.state': 'Choose the state',
      'office.pincode': 'Enter a valid 6-digit PIN code',
    });
    expect(check(fields, { office: { line1: '', city: ' ', state: '', pincode: '' } }).errors).toEqual({ office: 'This field is required' });
  });

  it('checks an optional address only once any part is filled', () => {
    const fields = [{ type: 'address', name: 'home', label: 'Home' }];
    expect(check(fields, { home: { line1: '', city: '' } }).data).toEqual({});
    expect(check(fields, { home: { city: 'Pune' } }).errors).toEqual({ 'home.line1': 'Enter the address', 'home.state': 'Choose the state', 'home.pincode': 'Enter the PIN code' });
  });
});

describe('formDataValidator: conditional fields', () => {
  const fields = [
    { type: 'select', name: 'office', label: 'Office', options: ['Owned', 'Rented'], required: true },
    { type: 'file', name: 'rent', label: 'Rent agreement', required: true, showIf: { field: 'office', equals: 'Rented' } },
    { type: 'text', name: 'landlord', label: 'Landlord', required: true, showIf: { field: 'rent', filled: true } },
  ];

  it('requires a shown field and drops a hidden one, even when a value was sent', () => {
    expect(check(fields, { office: 'Rented' }).errors).toEqual({ rent: 'Upload a file' });
    expect(check(fields, { office: 'Owned', rent: [FILE_A], landlord: 'Mr Rao' }).data).toEqual({ office: 'Owned' });
  });

  it('hides a field whose controlling field is itself hidden', () => {
    expect(check(fields, { office: 'Owned', rent: [FILE_A] }).errors).toEqual({});
    expect(check(fields, { office: 'Rented', rent: [FILE_A] }).errors).toEqual({ landlord: 'This field is required' });
  });

  it('does not validate a hidden field, so stale invalid values do not block submit', () => {
    expect(check(fields, { office: 'Owned', rent: 'not-a-list' }).errors).toEqual({});
  });

  it('decides on the cleaned value: an invalid controlling answer shows nothing', () => {
    expect(check(fields, { office: 'Leased', rent: [FILE_A] }).errors).toEqual({ office: 'Choose one of the listed options' });
  });

  it('uses "includes" for multi-selects, oneOf lists and numbers', () => {
    const f = [
      { type: 'multi-select', name: 'regs', label: 'Registrations', options: ['GST', 'IEC', 'FSSAI'] },
      { type: 'text', name: 'gstin', label: 'GSTIN', required: true, showIf: { field: 'regs', oneOf: ['GST', 'IEC'] } },
      { type: 'number', name: 'staff', label: 'Staff' },
      { type: 'text', name: 'esic', label: 'ESIC', required: true, showIf: { field: 'staff', equals: 10 } },
    ];
    expect(check(f, { regs: ['FSSAI', 'IEC'], staff: '10' }).errors).toEqual({ gstin: 'This field is required', esic: 'This field is required' });
    expect(check(f, { regs: ['FSSAI'], staff: 9 }).errors).toEqual({});
  });
});

describe('formDataValidator: repeaters', () => {
  const fields = [
    { type: 'select', name: 'kind', label: 'Kind', options: ['LLP', 'Company'], required: true },
    {
      type: 'repeater',
      name: 'directors',
      label: 'Directors',
      itemLabel: 'Director',
      required: true,
      minItems: 2,
      maxItems: 3,
      fields: [
        { type: 'text', name: 'name', label: 'Name', required: true },
        { type: 'select', name: 'hasDin', label: 'Has DIN?', options: ['Yes', 'No'], required: true },
        { type: 'text', name: 'din', label: 'DIN', required: true, pattern: String.raw`\d{8}`, showIf: { field: 'hasDin', equals: 'Yes' } },
        { type: 'text', name: 'dpin', label: 'DPIN', required: true, showIf: { field: 'kind', equals: 'LLP' } },
      ],
    },
  ];
  const ram = { name: 'Ram', hasDin: 'No' };
  const sita = { name: 'Sita', hasDin: 'Yes', din: '01234567' };

  it('validates each row, with conditions on sibling and earlier top-level fields', () => {
    expect(check(fields, { kind: 'Company', directors: [ram, sita] }).data).toEqual({ kind: 'Company', directors: [ram, sita] });
    expect(check(fields, { kind: 'LLP', directors: [ram, { ...sita, din: '123' }] }).errors).toEqual({
      'directors.0.dpin': 'This field is required',
      'directors.1.din': 'This is not in the expected format',
      'directors.1.dpin': 'This field is required',
    });
  });

  it('drops hidden and unknown keys inside rows', () => {
    const res = check(fields, { kind: 'Company', directors: [{ ...ram, din: '01234567', isAdmin: true }, sita] });
    expect(res.data?.directors).toEqual([ram, sita]);
  });

  it('enforces the number of rows', () => {
    expect(check(fields, { kind: 'Company', directors: [] }).errors).toEqual({ directors: 'Add at least one director' });
    expect(check(fields, { kind: 'Company', directors: [ram] }).errors).toEqual({ directors: 'Add at least 2 directors' });
    expect(check(fields, { kind: 'Company', directors: [ram, sita, ram, sita] }).errors).toEqual({ directors: 'Add at most 3 directors' });
  });

  it('rejects rows that are not objects and a value that is not a list', () => {
    expect(check(fields, { kind: 'Company', directors: [ram, 'Sita'] }).errors).toEqual({ 'directors.1': 'This director is not valid' });
    expect(check(fields, { kind: 'Company', directors: { 0: ram } }).errors).toEqual({ directors: 'Add each director as a row' });
  });
});

describe('formDataValidator: whole form', () => {
  const form: FormSchemaInput = {
    steps: [
      { title: 'One', fields: [{ type: 'text', name: 'name', label: 'Name', required: true }, { type: 'email', name: 'email', label: 'Email', required: true }] },
      { title: 'Two', fields: [{ type: 'number', name: 'age', label: 'Age', min: 18 }] },
    ],
  };

  it('strips keys the form does not declare', () => {
    const res = formDataValidator(formSchema.parse(form)).safeParse({ name: 'Asha', email: 'a@b.in', isAdmin: true, __proto__: { x: 1 } });
    expect(res.success && res.data).toEqual({ name: 'Asha', email: 'a@b.in' });
  });

  it('rejects data that is not an object', () => {
    for (const bad of [null, 'x', [1, 2]]) expect(formDataValidator(formSchema.parse(form)).safeParse(bad).success).toBe(false);
  });

  it('in partial (autosave) mode skips required, format and range checks but still checks types and size', () => {
    const v = formDataValidator(formSchema.parse(form), { partial: true });
    expect(v.safeParse({ email: 'asha@', age: 3 })).toMatchObject({ success: true, data: { email: 'asha@', age: 3 } });
    expect(v.safeParse({ name: 'x'.repeat(501) }).success).toBe(false);
    expect(v.safeParse({ age: 'old' }).success).toBe(false);
  });

  it('lists a step’s field names so a renderer can show only that step’s errors', () => {
    const parsed = formSchema.parse(form);
    expect(stepFieldNames(parsed, 0)).toEqual(['name', 'email']);
    expect(stepFieldNames(parsed, 5)).toEqual([]);
  });

  it('treats blank strings, empty lists and blank addresses as empty', () => {
    expect([undefined, null, ' ', [], { line1: '', city: ' ' }].every(isEmptyValue)).toBe(true);
    expect([0, 'a', ['x'], { city: 'Pune' }].some(isEmptyValue)).toBe(false);
  });
});

describe('formFileIds', () => {
  const A = '11111111-1111-4111-8111-111111111111';
  const B = '22222222-2222-4222-8222-222222222222';
  it('lists file ids from top-level fields and repeater rows with their paths', () => {
    const f = formSchema.parse({
      steps: [
        {
          title: 'One',
          fields: [
            { type: 'file', name: 'logo', label: 'Logo', maxFiles: 2 },
            { type: 'text', name: 'name', label: 'Name' },
            { type: 'repeater', name: 'people', label: 'People', itemLabel: 'Person', fields: [{ type: 'file', name: 'photo', label: 'Photo' }] },
          ],
        },
      ],
    });
    expect(formFileIds(f, { logo: [A, B], name: A, people: [{ photo: [B] }, {}, null] })).toEqual([
      { path: ['logo', 0], id: A },
      { path: ['logo', 1], id: B },
      { path: ['people', 0, 'photo', 0], id: B },
    ]);
  });
});
