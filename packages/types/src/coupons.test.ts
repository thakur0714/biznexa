import { describe, expect, it } from 'vitest';
import { couponCodeSchema, couponRuleIssues, couponStatus, createCouponInput, evaluateCoupon, updateCouponInput, type CouponContext, type CouponForValidation } from './index';

const now = new Date('2026-10-11T06:30:00.000Z');
const coupon = (over: Partial<CouponForValidation> = {}): CouponForValidation => ({
  id: 'c1',
  code: 'SAVE10',
  type: 'PERCENTAGE',
  value: 10,
  maxDiscount: null,
  minOrderValue: null,
  serviceIds: [],
  startsAt: null,
  expiresAt: null,
  usageLimit: null,
  perUserLimit: 1,
  isActive: true,
  ...over,
});
const ctx = (over: Partial<CouponContext> = {}): CouponContext => ({
  lines: [{ serviceId: 'gst', professionalFee: 100000 }],
  timesUsed: 0,
  timesUsedByUser: 0,
  now,
  ...over,
});
const reason = (c: CouponForValidation | null, x: Partial<CouponContext> = {}) => {
  const r = evaluateCoupon(c, ctx(x));
  return r.ok ? 'OK' : r.reason;
};

describe('couponCodeSchema', () => {
  it('trims and upper-cases codes', () => {
    expect(couponCodeSchema.parse('  save10 ')).toBe('SAVE10');
    expect(couponCodeSchema.parse('diwali_2026-x')).toBe('DIWALI_2026-X');
  });
  it('refuses blank, too long and odd characters', () => {
    expect(couponCodeSchema.safeParse('   ').success).toBe(false);
    expect(couponCodeSchema.safeParse('A'.repeat(33)).success).toBe(false);
    expect(couponCodeSchema.safeParse('SAVE 10').success).toBe(false);
    expect(couponCodeSchema.safeParse("x' OR 1=1").success).toBe(false);
  });
});

describe('evaluateCoupon (M3.11)', () => {
  it('accepts a valid coupon and returns the discount', () => {
    expect(evaluateCoupon(coupon(), ctx())).toEqual({ ok: true, couponId: 'c1', code: 'SAVE10', discount: 10000, eligibleAmount: 100000, lineDiscounts: [10000] });
  });

  it('refuses an unknown code', () => {
    const r = evaluateCoupon(null, ctx());
    expect(r).toMatchObject({ ok: false, reason: 'NOT_FOUND', message: 'This coupon code is not valid.' });
  });

  it('refuses an inactive coupon with the same message as an unknown one', () => {
    const r = evaluateCoupon(coupon({ isActive: false }), ctx());
    expect(r).toMatchObject({ ok: false, reason: 'INACTIVE', message: 'This coupon code is not valid.' });
  });

  it('is valid from startsAt (inclusive)', () => {
    expect(reason(coupon({ startsAt: new Date(now.getTime() + 1) }))).toBe('NOT_STARTED');
    expect(reason(coupon({ startsAt: now }))).toBe('OK');
  });

  it('is valid until expiresAt (exclusive)', () => {
    expect(reason(coupon({ expiresAt: now }))).toBe('EXPIRED');
    expect(reason(coupon({ expiresAt: new Date(now.getTime() + 1) }))).toBe('OK');
  });

  it('applies to every service when it names none, else only to the named ones', () => {
    expect(reason(coupon({ serviceIds: ['company'] }))).toBe('SERVICE_MISMATCH');
    expect(reason(coupon({ serviceIds: ['company', 'gst'] }))).toBe('OK');
  });

  it('discounts only the matching lines of a mixed order', () => {
    const r = evaluateCoupon(
      coupon({ serviceIds: ['gst'] }),
      ctx({ lines: [{ serviceId: 'gst', professionalFee: 100000 }, { serviceId: 'company', professionalFee: 500000 }] }),
    );
    expect(r).toMatchObject({ ok: true, eligibleAmount: 100000, discount: 10000, lineDiscounts: [10000, 0] });
  });

  it('shares the discount across matching lines by fee, adding up to the paisa', () => {
    const lines = [
      { serviceId: 'gst', professionalFee: 100000 },
      { serviceId: 'company', professionalFee: 999 },
      { serviceId: 'gst', professionalFee: 200000 },
    ];
    const r = evaluateCoupon(coupon({ type: 'FIXED', value: 10000, serviceIds: ['gst'] }), ctx({ lines }));
    expect(r).toMatchObject({ ok: true, discount: 10000, lineDiscounts: [3333, 0, 6667] });
    const all = evaluateCoupon(coupon({ type: 'FIXED', value: 1000 }), ctx({ lines }));
    if (!all.ok) throw new Error('expected ok');
    expect(all.lineDiscounts.reduce((a, b) => a + b, 0)).toBe(1000);
  });

  it('checks the minimum order on the matching lines, inclusive', () => {
    const r = evaluateCoupon(coupon({ minOrderValue: 100001 }), ctx());
    expect(r).toMatchObject({ ok: false, reason: 'MIN_ORDER', minOrderValue: 100001 });
    expect(reason(coupon({ minOrderValue: 100000 }))).toBe('OK');
    const mixed = [{ serviceId: 'gst', professionalFee: 100000 }, { serviceId: 'company', professionalFee: 500000 }];
    expect(reason(coupon({ serviceIds: ['gst'], minOrderValue: 200000 }), { lines: mixed })).toBe('MIN_ORDER');
  });

  it('caps a percentage discount at maxDiscount', () => {
    const r = evaluateCoupon(coupon({ value: 50, maxDiscount: 20000 }), ctx());
    expect(r).toMatchObject({ ok: true, discount: 20000 });
  });

  it('never discounts more than the professional fee', () => {
    expect(evaluateCoupon(coupon({ type: 'FIXED', value: 500000 }), ctx())).toMatchObject({ ok: true, discount: 100000 });
    expect(evaluateCoupon(coupon({ value: 150 }), ctx())).toMatchObject({ ok: true, discount: 100000 });
  });

  it('stops at the total usage limit', () => {
    expect(reason(coupon({ usageLimit: 5, perUserLimit: null }), { timesUsed: 5 })).toBe('USAGE_LIMIT');
    expect(reason(coupon({ usageLimit: 5, perUserLimit: null }), { timesUsed: 4 })).toBe('OK');
    expect(reason(coupon({ usageLimit: null, perUserLimit: null }), { timesUsed: 10_000 })).toBe('OK');
  });

  it('stops at the per-customer limit', () => {
    expect(reason(coupon({ perUserLimit: 1 }), { timesUsedByUser: 1 })).toBe('PER_USER_LIMIT');
    expect(reason(coupon({ perUserLimit: 2 }), { timesUsedByUser: 1 })).toBe('OK');
    expect(reason(coupon({ perUserLimit: null }), { timesUsedByUser: 50 })).toBe('OK');
  });

  it('refuses a coupon that would give nothing off', () => {
    expect(reason(coupon(), { lines: [{ serviceId: 'gst', professionalFee: 0 }] })).toBe('NO_DISCOUNT');
    expect(reason(coupon({ type: 'FIXED', value: 0 }))).toBe('NO_DISCOUNT');
  });

  it('reports the first failing rule', () => {
    expect(reason(coupon({ isActive: false, expiresAt: now }))).toBe('INACTIVE');
    expect(reason(coupon({ expiresAt: now, serviceIds: ['company'] }))).toBe('EXPIRED');
    expect(reason(coupon({ serviceIds: ['company'], usageLimit: 0 }))).toBe('SERVICE_MISMATCH');
  });
});

describe('createCouponInput (M3.12)', () => {
  const base = { code: ' diwali-10 ', type: 'PERCENTAGE', value: 10 } as const;
  const issues = (over: Record<string, unknown>) => {
    const r = createCouponInput.safeParse({ ...base, ...over });
    return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
  };

  it('stores the code upper-case and fills the defaults', () => {
    expect(createCouponInput.parse(base)).toEqual({
      code: 'DIWALI-10',
      type: 'PERCENTAGE',
      value: 10,
      maxDiscount: null,
      minOrderValue: null,
      serviceIds: [],
      startsAt: null,
      expiresAt: null,
      usageLimit: null,
      perUserLimit: 1,
      isActive: true,
    });
  });

  it('keeps a percentage between 1 and 100', () => {
    expect(issues({ value: 100 })).toEqual([]);
    expect(issues({ value: 101 })).toEqual(['value: A percentage is at most 100']);
    expect(issues({ value: 0 })).toEqual(['value: Must be more than 0']);
    expect(issues({ value: 2.5 })).toEqual(['value: Enter a whole number']);
    expect(issues({ type: 'FIXED', value: 50000 })).toEqual([]);
  });

  it('allows a maximum discount only on a percentage coupon', () => {
    expect(issues({ maxDiscount: 50000 })).toEqual([]);
    expect(issues({ type: 'FIXED', value: 50000, maxDiscount: 50000 })).toEqual(['maxDiscount: Only a percentage coupon has a maximum discount']);
    expect(issues({ maxDiscount: 0 })).toEqual(['maxDiscount: Must be more than ₹0']);
  });

  it('needs the expiry after the start', () => {
    const startsAt = '2026-11-01T00:00:00+05:30';
    expect(issues({ startsAt, expiresAt: '2026-11-02T00:00:00+05:30' })).toEqual([]);
    expect(issues({ startsAt, expiresAt: startsAt })).toEqual(['expiresAt: Must be after the start date']);
    expect(issues({ startsAt: 'tomorrow' })).toEqual(['startsAt: Enter a valid date']);
  });

  it('refuses bad codes, limits and service lists', () => {
    expect(issues({ code: 'DIWALI 10' })).toEqual(['code: Coupon codes use only letters, numbers, - and _']);
    expect(issues({ usageLimit: 0, perUserLimit: null })).toEqual(['usageLimit: At least 1']);
    const id = '11111111-1111-4111-8111-111111111111';
    expect(issues({ serviceIds: [id, id] })).toEqual(['serviceIds: A service is listed twice']);
    expect(issues({ serviceIds: ['gst'] })).toEqual(['serviceIds.0: Invalid uuid']);
  });

  it('updates only what is sent', () => {
    expect(updateCouponInput.parse({ isActive: false })).toEqual({ isActive: false });
    expect(updateCouponInput.parse({ code: 'new10' })).toEqual({ code: 'NEW10' });
  });
});

describe('couponRuleIssues on a merged coupon', () => {
  it('reports each broken rule once', () => {
    expect(couponRuleIssues({ type: 'FIXED', value: 500, maxDiscount: 100, startsAt: new Date(now.getTime() + 1), expiresAt: now })).toEqual([
      { field: 'maxDiscount', message: 'Only a percentage coupon has a maximum discount' },
      { field: 'expiresAt', message: 'Must be after the start date' },
    ]);
  });
});

describe('couponStatus', () => {
  const c = { isActive: true, startsAt: null, expiresAt: null, usageLimit: null };
  const later = new Date(now.getTime() + 1000);
  it('is ACTIVE, SCHEDULED, EXPIRED, USED_UP or INACTIVE', () => {
    expect(couponStatus(c, 0, now)).toBe('ACTIVE');
    expect(couponStatus({ ...c, startsAt: later }, 0, now)).toBe('SCHEDULED');
    expect(couponStatus({ ...c, startsAt: now }, 0, now)).toBe('ACTIVE');
    expect(couponStatus({ ...c, expiresAt: now }, 0, now)).toBe('EXPIRED');
    expect(couponStatus({ ...c, expiresAt: later.toISOString() }, 0, now)).toBe('ACTIVE');
    expect(couponStatus({ ...c, usageLimit: 3 }, 3, now)).toBe('USED_UP');
    expect(couponStatus({ ...c, usageLimit: 3 }, 2, now)).toBe('ACTIVE');
  });
  it('puts switched off first, then expired, then used up', () => {
    expect(couponStatus({ isActive: false, startsAt: null, expiresAt: now, usageLimit: 1 }, 1, now)).toBe('INACTIVE');
    expect(couponStatus({ isActive: true, startsAt: null, expiresAt: now, usageLimit: 1 }, 1, now)).toBe('EXPIRED');
  });
});
