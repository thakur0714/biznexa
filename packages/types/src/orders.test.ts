import { describe, expect, it } from 'vitest';
import { advancePayment, applyCouponInput, calculatePrice, orderTotals, placeOfSupply, sameState, splitAmount, stateName } from './index';

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

describe('advancePayment (M3.19)', () => {
  const line = (total: number, advancePercent: number | null, governmentFee = 0) => ({ total, governmentFee, advancePercent });

  it('takes the advance % of the fee + GST, rounded up to whole rupees, and leaves the rest as the balance', () => {
    // ₹10,000 + 18 % GST at 50 %.
    expect(advancePayment([line(1180000, 50)])).toEqual({ amount: 590000, balance: 590000, percent: 50, governmentFee: 0 });
    // ₹1,000.01 at 50 % = ₹500.005 → ₹501.
    expect(advancePayment([line(100001, 50)])).toEqual({ amount: 50100, balance: 49901, percent: 50, governmentFee: 0 });
    // Already whole rupees: not rounded further.
    expect(advancePayment([line(100000, 10)])).toMatchObject({ amount: 10000, balance: 90000 });
  });

  it('collects the government fee in full with the advance', () => {
    // ₹1,000 + ₹180 GST + ₹4,500 government fee at 30 %: ₹4,500 + ₹354.
    expect(advancePayment([line(568000, 30, 450000)])).toEqual({ amount: 485400, balance: 82600, percent: 30, governmentFee: 450000 });
  });

  it('adds up per line; a mixed % is reported as null', () => {
    expect(advancePayment([line(118000, 50, 0), line(250000, 30, 50000)])).toEqual({ amount: 59000 + 50000 + 60000, balance: 199000, percent: null, governmentFee: 50000 });
    expect(advancePayment([line(118000, 40), line(118000, 40)])?.percent).toBe(40);
  });

  it('is offered only when every line allows it with a whole 1–99 %', () => {
    expect(advancePayment([])).toBeNull();
    expect(advancePayment([line(118000, 50), line(118000, null)])).toBeNull();
    for (const p of [0, 100, 120, -5, 12.5]) expect(advancePayment([line(118000, p)])).toBeNull();
  });

  it('is not offered when either part would be under ₹1', () => {
    // ₹1.50 at 50 %: the advance rounds up to ₹1, leaving 50 paise.
    expect(advancePayment([line(150, 50)])).toBeNull();
    // The government fee covers almost everything: nothing meaningful left as a balance.
    expect(advancePayment([line(100100, 50, 100000)])).toBeNull();
    expect(advancePayment([line(200, 50)])).toEqual({ amount: 100, balance: 100, percent: 50, governmentFee: 0 });
  });

  it('always splits the total exactly', () => {
    for (let total = 100; total < 400000; total += 7919) {
      for (const pct of [1, 10, 33, 50, 67, 90, 99]) {
        for (const govt of [0, Math.floor(total / 3)]) {
          const r = advancePayment([line(total, pct, govt)]);
          if (!r) continue;
          expect(r.amount + r.balance).toBe(total);
          expect(r.amount).toBeGreaterThanOrEqual(govt);
          expect((r.amount - govt) % 100).toBe(0);
          expect(r.amount - govt).toBeGreaterThanOrEqual(((total - govt) * pct) / 100);
        }
      }
    }
  });
});
