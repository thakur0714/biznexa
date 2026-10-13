import { describe, expect, it } from 'vitest';
import { gstinCheckChar } from './business-entities';
import { SELLER_SETTING_KEYS, readSellerSettings, sellerSettingValues, sellerSettingsInput, rejectionPresetsInput } from './settings';

const gstin = (first14: string) => first14 + gstinCheckChar(first14);
const PUNJAB_GSTIN = gstin('03AABCB1234F1Z');
const DELHI_GSTIN = gstin('07AABCB1234F1Z');
const address = { line1: '12 Mall Road', city: 'Ludhiana', state: 'Punjab', pincode: '141001' };
const valid = { name: 'BizNexa', legalName: 'BizNexa Private Limited', gstin: PUNJAB_GSTIN, email: 'Billing@BizNexa.com', phone: '+91 98765 43210', address, invoicePrefix: 'bn' };
const issues = (body: unknown) => sellerSettingsInput.safeParse(body).error?.issues.map((i) => [i.path.join('.'), i.message]);

describe('sellerSettingsInput (M3.14)', () => {
  it('accepts complete details, upper-casing the prefix and GSTIN', () => {
    const r = sellerSettingsInput.parse({ ...valid, gstin: PUNJAB_GSTIN.toLowerCase() });
    expect(r).toMatchObject({ gstin: PUNJAB_GSTIN, invoicePrefix: 'BN', address });
  });

  it('treats blank GSTIN, email and phone as none', () => {
    expect(sellerSettingsInput.parse({ ...valid, gstin: '  ', email: '', phone: null })).toMatchObject({ gstin: null, email: null, phone: null });
  });

  it('refuses a GSTIN with a wrong check character or from another state', () => {
    expect(issues({ ...valid, gstin: PUNJAB_GSTIN.slice(0, 14) + (PUNJAB_GSTIN[14] === 'A' ? 'B' : 'A') })).toEqual([['gstin', 'This is not a valid GSTIN — check each character']]);
    expect(issues({ ...valid, gstin: DELHI_GSTIN })).toEqual([['gstin', 'This GSTIN is registered in Delhi, not Punjab']]);
  });

  it('requires names, a full address and a prefix of letters and digits', () => {
    const found = issues({ ...valid, name: ' ', legalName: '', address: { ...address, state: 'PB', pincode: '12' }, invoicePrefix: 'BN/' });
    expect(found?.map(([path]) => path)).toEqual(['name', 'legalName', 'address.state', 'address.pincode', 'invoicePrefix']);
    expect(issues({ ...valid, invoicePrefix: 'BIZNX' })).toEqual([['invoicePrefix', 'Use at most 4 characters']]);
    expect(issues({ ...valid, address: undefined })?.[0][0]).toBe('address');
  });

  it('refuses a bad email or phone and unknown fields', () => {
    expect(issues({ ...valid, email: 'billing', phone: 'call us' })?.map(([p]) => p)).toEqual(['email', 'phone']);
    expect(issues({ ...valid, state: 'Punjab' })?.[0][1]).toMatch(/Unrecognized key/);
  });
});

describe('stored seller settings', () => {
  it('reads the seed (state as a code, blanks, no address)', () => {
    const r = readSellerSettings({ 'company.name': 'BizNexa', 'company.gstin': '', 'company.state': 'PB', 'invoice.prefix': 'BN' });
    expect(r).toEqual({ name: 'BizNexa', legalName: null, gstin: null, email: null, phone: null, address: null, state: 'Punjab', invoicePrefix: 'BN', updatedAt: null });
  });

  it('round-trips saved details, with the state taken from the address', () => {
    const data = sellerSettingsInput.parse({ ...valid, gstin: '' });
    const stored = sellerSettingValues(data);
    expect(stored[SELLER_SETTING_KEYS.state]).toBe('Punjab');
    expect(stored[SELLER_SETTING_KEYS.gstin]).toBe('');
    const at = new Date('2026-10-11T06:00:00Z');
    expect(readSellerSettings(stored, at)).toEqual({ ...data, state: 'Punjab', updatedAt: at.toISOString() });
  });

  it('ignores an address stored in a shape it no longer accepts', () => {
    expect(readSellerSettings({ 'company.address': '12 Mall Road', 'company.state': '03' })).toMatchObject({ address: null, state: 'Punjab' });
  });

  describe('rejectionPresetsInput', () => {
    it('accepts valid presets', () => {
      const res = rejectionPresetsInput.safeParse(['Blurry image', 'Missing signature']);
      expect(res.success).toBe(true);
    });

    it('rejects empty preset', () => {
      const res = rejectionPresetsInput.safeParse(['']);
      expect(res.success).toBe(false);
      expect(res.error?.issues[0]?.message).toBe('Preset cannot be empty');
    });

    it('rejects duplicate presets', () => {
      const res = rejectionPresetsInput.safeParse(['Blurry image', 'Blurry image']);
      expect(res.success).toBe(false);
      expect(res.error?.issues[0]?.message).toBe('Presets must be unique');
    });
  });
});
