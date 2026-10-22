import { describe, expect, it } from 'vitest';
import { businessEntityInput, gstinCheckChar, gstinState, isValidGstin, maskPan, SERVICE_FORMS, ENTITY_TYPES, type BusinessEntityInput } from './index';

const company: BusinessEntityInput = { legalName: 'Acme Widgets Private Limited', entityType: 'PRIVATE_LIMITED', pan: 'AAPCA1234F' };
const gstinFor = (stateCode: string, pan: string) => {
  const body = `${stateCode}${pan}1Z`;
  return `${body}${gstinCheckChar(body)}`;
};
const errors = (input: unknown) => {
  const r = businessEntityInput.safeParse(input);
  return r.success ? {} : Object.fromEntries(r.error.issues.map((i) => [i.path.join('.'), i.message]));
};

describe('GSTIN', () => {
  it('checks the check character', () => {
    expect(isValidGstin('27AAPFU0939F1ZV')).toBe(true);
    expect(isValidGstin('27AAPFU0939F1ZW')).toBe(false);
    // One changed character elsewhere also fails the checksum.
    expect(isValidGstin('27AAPFU0938F1ZV')).toBe(false);
  });

  it('needs a known state code', () => {
    expect(isValidGstin(gstinFor('03', 'AAPCA1234F'))).toBe(true);
    expect(isValidGstin(gstinFor('97', 'AAPCA1234F'))).toBe(true);
    expect(isValidGstin(gstinFor('45', 'AAPCA1234F'))).toBe(false);
    expect(gstinState('27AAPFU0939F1ZV')).toBe('Maharashtra');
    expect(gstinState(gstinFor('97', 'AAPCA1234F'))).toBeNull();
  });

  it('refuses the wrong shape', () => {
    for (const v of ['', '27AAPFU0939F1Z', '27aapfu0939f1zv', '27AAPFU0939F1AV', 'XXAAPFU0939F1ZV']) expect(isValidGstin(v)).toBe(false);
  });
});

describe('businessEntityInput', () => {
  it('accepts a minimal business and fills blanks with null', () => {
    expect(businessEntityInput.parse({ legalName: ' Sharma Traders ', entityType: 'PROPRIETORSHIP' })).toEqual({
      legalName: 'Sharma Traders',
      entityType: 'PROPRIETORSHIP',
      pan: null,
      gstin: null,
      cin: null,
      address: null,
      state: null,
    });
    expect(businessEntityInput.parse({ ...company, pan: '', gstin: '  ', cin: null }).gstin).toBeNull();
  });

  it('capitalises and trims IDs', () => {
    const gstin = gstinFor('03', 'AAPCA1234F');
    const v = businessEntityInput.parse({ ...company, pan: ' aapca1234f ', gstin: gstin.toLowerCase(), cin: 'u74999pb2020ptc012345' });
    expect(v).toMatchObject({ pan: 'AAPCA1234F', gstin, cin: 'U74999PB2020PTC012345' });
  });

  it('checks PAN format and the holder letter for the type of business', () => {
    expect(errors({ ...company, pan: 'AAPC1234F' })).toEqual({ pan: 'Enter a PAN like ABCDE1234F' });
    expect(errors({ ...company, pan: 'AAPPA1234F' })).toEqual({ pan: 'The 4th letter of the PAN of a company is C' });
    expect(errors({ legalName: 'Sharma Traders', entityType: 'PROPRIETORSHIP', pan: 'AAPCA1234F' }).pan).toMatch(/proprietorship/);
    expect(errors({ legalName: 'Sharma Trust', entityType: 'TRUST_SOCIETY', pan: 'AAPAA1234F' })).toEqual({});
    expect(errors({ legalName: 'Sharma Trust', entityType: 'TRUST_SOCIETY', pan: 'AAPCA1234F' }).pan).toBe('The 4th letter of the PAN of a trust or society is T or A');
    expect(errors({ legalName: 'Anything', entityType: 'OTHER', pan: 'AAPGA1234F' })).toEqual({});
  });

  it('checks the GSTIN, and that it belongs to the PAN and the state', () => {
    expect(errors({ ...company, gstin: '03AAPCA1234F1Z0' }).gstin).toBe('This is not a valid GSTIN — check each character');
    expect(errors({ ...company, gstin: gstinFor('03', 'AAPCB9999F') }).gstin).toBe('This GSTIN belongs to a different PAN');
    expect(errors({ ...company, gstin: gstinFor('03', 'AAPCA1234F'), state: 'Delhi' }).gstin).toBe('This GSTIN is registered in Punjab, not Delhi');
    expect(errors({ ...company, gstin: gstinFor('97', 'AAPCA1234F'), state: 'Delhi' })).toEqual({});
  });

  it('takes the state from the address, else from the GSTIN', () => {
    const address = { line1: '12 Mall Road', city: 'Ludhiana', state: 'Punjab', pincode: '141001' };
    expect(businessEntityInput.parse({ ...company, address }).state).toBe('Punjab');
    expect(businessEntityInput.parse({ ...company, gstin: gstinFor('07', 'AAPCA1234F') }).state).toBe('Delhi');
    expect(businessEntityInput.parse({ ...company, state: 'Goa' }).state).toBe('Goa');
    expect(errors({ ...company, address, state: 'Goa' })).toEqual({ state: 'The state does not match the address' });
  });

  it('checks the address parts', () => {
    expect(errors({ ...company, address: { line1: '', city: 'X', state: 'Narnia', pincode: '012345' } })).toEqual({
      'address.line1': 'Enter the address',
      'address.state': 'Choose the state',
      'address.pincode': 'Enter a valid 6-digit PIN code',
    });
  });

  it('wants a CIN for companies, an LLPIN for LLPs and neither for others', () => {
    expect(errors({ ...company, cin: 'U74999PB2020PTC012345' })).toEqual({});
    expect(errors({ ...company, cin: 'AAB-1234' }).cin).toMatch(/21-character CIN/);
    expect(errors({ legalName: 'Acme LLP', entityType: 'LLP', pan: 'AAPFA1234F', cin: 'aab-1234' })).toEqual({});
    expect(errors({ legalName: 'Acme LLP', entityType: 'LLP', cin: 'U74999PB2020PTC012345' }).cin).toMatch(/LLPIN/);
    expect(errors({ legalName: 'Sharma Traders', entityType: 'PROPRIETORSHIP', cin: 'U74999PB2020PTC012345' }).cin).toMatch(/leave this blank/);
  });

  it('needs a name and a known type, and refuses unknown fields', () => {
    expect(errors({ legalName: ' ', entityType: 'INDIVIDUAL' })).toEqual({ legalName: 'Enter the legal name', entityType: 'Choose the type of business' });
    expect(businessEntityInput.safeParse({ ...company, ownerId: 'someone-else' }).success).toBe(false);
  });

  it('masks a PAN', () => {
    expect(maskPan('AAPCA1234F')).toBe('AAPCA****F');
  });

  it('uses the same type values as the ready-made forms', () => {
    const values = new Set<string>(ENTITY_TYPES.map((t) => t.value));
    const used = Object.values(SERVICE_FORMS)
      .flatMap((form) => form.steps.flatMap((s) => s.fields))
      .flatMap((f) => (f.name === 'entityType' && f.type === 'select' ? (f.options ?? []).map((o) => (typeof o === 'string' ? o : o.value)) : []));
    expect(used.length).toBeGreaterThan(0);
    // INDIVIDUAL ("no business yet") is a form-only answer, never saved as a business.
    expect(used.filter((v) => v !== 'INDIVIDUAL' && !values.has(v))).toEqual([]);
  });
});
