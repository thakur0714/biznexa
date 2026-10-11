import { describe, expect, it } from 'vitest';
import { applyCouponInput, calculatePrice, orderTotals, placeOfSupply, sameState, splitAmount, stateName } from './index';

describe('stateName (M3.13)', () => {
  it('reads names, two-letter codes and GST codes as the same state', () => {
    expect(stateName('Punjab')).toBe('Punjab');
    expect(stateName(' punjab ')).toBe('Punjab');
    expect(stateName('PB')).toBe('Punjab');
    expect(stateName('pb')).toBe('Punjab');
    expect(stateName('03')).toBe('Punjab');
    expect(stateName('3')).toBe('Punjab');
    expect(stateName('TG')).toBe('Telangana');
    expect(stateName('TS')).toBe('Telangana');
    expect(stateName('DL')).toBe('Delhi');
  });
  it('returns null for blank or unknown values', () => {
    expect(stateName('')).toBeNull();
    expect(stateName(null)).toBeNull();
    expect(stateName('XX')).toBeNull();
    expect(stateName('99')).toBeNull();
  });
});

describe('calculatePrice with differently written states', () => {
  it('treats "PB" (Settings) and "Punjab" (business address) as intra-state', () => {
    expect(calculatePrice({ professionalFee: 100000, governmentFee: 0, gstRate: 18, sellerState: 'PB', buyerState: 'Punjab' }).taxType).toBe('CGST_SGST');
    expect(calculatePrice({ professionalFee: 100000, governmentFee: 0, gstRate: 18, sellerState: '03', buyerState: 'Haryana' }).taxType).toBe('IGST');
    expect(sameState('Unknownland', 'unknownland')).toBe(true);
  });
});

describe('splitAmount', () => {
  it('splits in proportion and adds up exactly', () => {
    expect(splitAmount(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(splitAmount(10000, [100000, 0, 200000])).toEqual([3333, 0, 6667]);
    expect(splitAmount(7, [5])).toEqual([7]);
  });
  it('gives zeros when there is nothing to split or no weight', () => {
    expect(splitAmount(0, [1, 2])).toEqual([0, 0]);
    expect(splitAmount(50, [0, 0])).toEqual([0, 0]);
    expect(splitAmount(50, [])).toEqual([]);
  });
});

describe('placeOfSupply', () => {
  it('prefers the business, then the profile, then the seller', () => {
    expect(placeOfSupply({ business: 'Maharashtra', profile: 'Delhi', seller: 'PB' })).toEqual({ state: 'Maharashtra', source: 'BUSINESS' });
    expect(placeOfSupply({ business: null, profile: 'DL', seller: 'PB' })).toEqual({ state: 'Delhi', source: 'PROFILE' });
    expect(placeOfSupply({ business: 'not a state', profile: null, seller: 'PB' })).toEqual({ state: 'Punjab', source: 'SELLER' });
    expect(placeOfSupply({})).toBeNull();
  });
});

describe('orderTotals', () => {
  const line = { professionalFee: 100000, governmentFee: 450000, gstRate: 18, discount: 0 };

  it('intra-state: CGST + SGST on the fee only, government fee untaxed', () => {
    const t = orderTotals([line], { sellerState: 'PB', placeOfSupply: 'Punjab' });
    expect(t).toMatchObject({ taxType: 'CGST_SGST', cgst: 9000, sgst: 9000, igst: 0, taxTotal: 18000, governmentFee: 450000, total: 568000 });
  });

  it('inter-state: IGST', () => {
    const t = orderTotals([line], { sellerState: 'PB', placeOfSupply: 'Karnataka' });
    expect(t).toMatchObject({ taxType: 'IGST', cgst: 0, sgst: 0, igst: 18000, total: 568000 });
  });

  it('applies the discount before GST and never to the government fee', () => {
    const t = orderTotals([{ ...line, discount: 20000 }], { sellerState: 'PB', placeOfSupply: 'PB' });
    expect(t).toMatchObject({ professionalFee: 100000, discount: 20000, taxableValue: 80000, taxTotal: 14400, governmentFee: 450000, total: 80000 + 14400 + 450000 });
  });

  it('adds up several lines with their own GST rates', () => {
    const t = orderTotals(
      [
        { professionalFee: 100000, governmentFee: 0, gstRate: 18, discount: 10000 },
        { professionalFee: 50000, governmentFee: 1000, gstRate: 12, discount: 0 },
      ],
      { sellerState: 'PB', placeOfSupply: 'Delhi' },
    );
    expect(t.lines).toHaveLength(2);
    expect(t).toMatchObject({ professionalFee: 150000, discount: 10000, taxableValue: 140000, igst: 16200 + 6000, governmentFee: 1000, total: 140000 + 22200 + 1000 });
  });

  it('is inter-state when nothing is known', () => {
    expect(orderTotals([line], { sellerState: null, placeOfSupply: null }).taxType).toBe('IGST');
  });
});

describe('applyCouponInput', () => {
  it('accepts only a code, cleaned up', () => {
    expect(applyCouponInput.parse({ code: ' save10 ' })).toEqual({ code: 'SAVE10' });
  });
  it('refuses amounts sent with the code', () => {
    expect(applyCouponInput.safeParse({ code: 'SAVE10', total: 1 }).success).toBe(false);
    expect(applyCouponInput.safeParse({ code: 'SAVE10', discount: 999999 }).success).toBe(false);
  });
});
