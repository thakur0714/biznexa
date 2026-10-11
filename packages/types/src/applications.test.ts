import { describe, expect, it } from 'vitest';
import {
  APPLICATION_CODE_PATTERN,
  createApplicationInput,
  FIRST_APPLICATION_NUMBER,
  formatApplicationCode,
  formatOrderCode,
  istYear,
  formDataValidator,
  formSchema,
  ORDER_CODE_PATTERN,
  prefillAnswers,
  SERVICE_FORMS,
  type FormSchemaInput,
} from './index';

const PKG = '6f1c2b0e-7d4a-4c1e-9a55-0b8f3e2d1c4a';

describe('order codes', () => {
  it('pads the number to six digits after the year', () => {
    expect(formatOrderCode(123, new Date('2026-10-10T06:00:00Z'))).toBe('ORD-2026-000123');
    expect(formatOrderCode(1, new Date('2026-10-10T06:00:00Z'))).toBe('ORD-2026-000001');
  });

  it('keeps every digit past 999999 instead of cutting them off', () => {
    expect(formatOrderCode(1234567, new Date('2026-10-10T06:00:00Z'))).toBe('ORD-2026-1234567');
    expect(ORDER_CODE_PATTERN.test('ORD-2026-1234567')).toBe(true);
  });

  it('uses the year in India, not UTC', () => {
    // 31-Dec-2026 19:00 UTC is 01-Jan-2027 00:30 IST.
    expect(istYear(new Date('2026-12-31T19:00:00Z'))).toBe(2027);
    expect(formatOrderCode(5, new Date('2026-12-31T19:00:00Z'))).toBe('ORD-2027-000005');
    expect(istYear(new Date('2026-12-31T18:00:00Z'))).toBe(2026);
  });

  it('refuses numbers a sequence never returns', () => {
    for (const n of [0, -1, 1.5, Number.NaN]) expect(() => formatOrderCode(n)).toThrow();
  });
});

describe('application codes', () => {
  it('is BN followed by the number', () => {
    expect(formatApplicationCode(10025)).toBe('BN10025');
    expect(formatApplicationCode(FIRST_APPLICATION_NUMBER)).toBe('BN10001');
    expect(APPLICATION_CODE_PATTERN.test(formatApplicationCode(1_000_000))).toBe(true);
    expect(() => formatApplicationCode(0)).toThrow();
  });
});

describe('createApplicationInput', () => {
  it('needs a package and treats a missing business as none', () => {
    expect(createApplicationInput.parse({ packageId: PKG })).toEqual({ packageId: PKG, businessEntityId: null });
    expect(createApplicationInput.parse({ packageId: PKG, businessEntityId: null })).toEqual({ packageId: PKG, businessEntityId: null });
    expect(createApplicationInput.safeParse({}).success).toBe(false);
    expect(createApplicationInput.safeParse({ packageId: 'basic' }).success).toBe(false);
    expect(createApplicationInput.safeParse({ packageId: PKG, businessEntityId: 'acme' }).success).toBe(false);
  });

  it('refuses fields the server decides (prices, status, codes)', () => {
    expect(createApplicationInput.safeParse({ packageId: PKG, total: 1 }).success).toBe(false);
    expect(createApplicationInput.safeParse({ packageId: PKG, code: 'BN1' }).success).toBe(false);
  });
});

describe('prefillAnswers (M3.9)', () => {
  const business = {
    legalName: 'Acme Widgets Private Limited',
    entityType: 'PRIVATE_LIMITED' as const,
    pan: 'AAACA1234F',
    gstin: '27AAACA1234F1Z5',
    cin: null,
    address: { line1: '12 MG Road', city: 'Pune', state: 'Maharashtra', pincode: '411001' },
  };
  const user = { name: 'Asha Rao', email: 'asha@example.com', mobile: '9876543210' };
  const form = (fields: FormSchemaInput['steps'][number]['fields']) => formSchema.parse({ steps: [{ title: 'Details', fields }] });

  it('fills the shared field names the form has, from the business and the account', () => {
    const f = form([
      { type: 'text', name: 'businessName', label: 'Name' },
      { type: 'select', name: 'entityType', label: 'Type', options: ['PRIVATE_LIMITED', 'LLP'] },
      { type: 'text', name: 'businessPan', label: 'PAN' },
      { type: 'text', name: 'cin', label: 'CIN', required: false },
      { type: 'address', name: 'businessAddress', label: 'Address' },
      { type: 'text', name: 'contactName', label: 'Name' },
      { type: 'email', name: 'contactEmail', label: 'Email' },
      { type: 'tel', name: 'contactMobile', label: 'Mobile' },
    ]);
    expect(prefillAnswers(f, { business, user })).toEqual({
      businessName: 'Acme Widgets Private Limited',
      entityType: 'PRIVATE_LIMITED',
      businessPan: 'AAACA1234F',
      businessAddress: { line1: '12 MG Road', line2: '', city: 'Pune', state: 'Maharashtra', pincode: '411001' },
      contactName: 'Asha Rao',
      contactEmail: 'asha@example.com',
      contactMobile: '9876543210',
    });
  });

  it('leaves out fields the form lacks, empty values, and names reused for another kind of field', () => {
    const f = form([
      { type: 'number', name: 'businessName', label: 'Not a name' },
      { type: 'select', name: 'entityType', label: 'Type', options: ['LLP'] },
      { type: 'text', name: 'cin', label: 'CIN', required: false },
      { type: 'tel', name: 'contactMobile', label: 'Mobile' },
    ]);
    expect(prefillAnswers(f, { business, user: { ...user, mobile: '+91 98765 43210' } })).toEqual({});
    expect(prefillAnswers(f, {})).toEqual({});
  });

  it('gives a ready-made form answers that autosave accepts', () => {
    const f = SERVICE_FORMS['gst-registration'];
    const values = prefillAnswers(f, { business, user });
    expect(Object.keys(values).length).toBeGreaterThan(3);
    expect(formDataValidator(f, { partial: true }).safeParse(values).success).toBe(true);
  });
});
