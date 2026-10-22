import { describe, expect, it } from 'vitest';
import { formSchema, formSchemaSize, formSchemaVersionRef, formSchemaVersionSchema, saveFormSchemaInput, type FormSchemaInput } from './index';

const form: FormSchemaInput = {
  steps: [
    { title: 'Company', fields: [{ type: 'text', name: 'name', label: 'Name' }, { type: 'select', name: 'office', label: 'Office', options: ['Owned', 'Rented'] }] },
    {
      title: 'Directors',
      fields: [{ type: 'repeater', name: 'directors', label: 'Directors', fields: [{ type: 'text', name: 'pan', label: 'PAN' }, { type: 'date', name: 'dob', label: 'DOB' }] }],
    },
  ],
};

describe('saveFormSchemaInput', () => {
  it('activates by default and accepts a draft save', () => {
    expect(saveFormSchemaInput.parse({ schema: form }).activate).toBe(true);
    expect(saveFormSchemaInput.parse({ schema: form, activate: false }).activate).toBe(false);
  });

  it('rejects an invalid form, a missing form and unknown keys', () => {
    expect(saveFormSchemaInput.safeParse({ schema: { steps: [] } }).success).toBe(false);
    expect(saveFormSchemaInput.safeParse({}).success).toBe(false);
    expect(saveFormSchemaInput.safeParse({ schema: form, version: 3 }).success).toBe(false);
  });

  it('a stored (normalised) form parses again to the same value', () => {
    const stored = formSchema.parse(form);
    expect(formSchema.parse(JSON.parse(JSON.stringify(stored)))).toEqual(stored); // NOSONAR: a JSON round trip, as the database stores it
    const version = { id: crypto.randomUUID(), serviceId: crypto.randomUUID(), version: 2, isCurrent: true, createdAt: new Date().toISOString(), applications: 0, schema: stored };
    expect(formSchemaVersionSchema.safeParse(version).success).toBe(true);
  });
});

describe('formSchemaVersionRef', () => {
  it('accepts latest, current and positive version numbers', () => {
    expect(formSchemaVersionRef.parse('latest')).toBe('latest');
    expect(formSchemaVersionRef.parse('current')).toBe('current');
    expect(formSchemaVersionRef.parse('7')).toBe(7);
  });

  it('rejects zero, negatives, fractions and other words', () => {
    for (const bad of ['0', '-1', '1.5', 'first', '']) expect(formSchemaVersionRef.safeParse(bad).success, bad).toBe(false);
  });
});

describe('formSchemaSize', () => {
  it('counts steps and fields, including repeater sub-fields', () => {
    expect(formSchemaSize(formSchema.parse(form))).toEqual({ steps: 2, fields: 5 });
  });
});
