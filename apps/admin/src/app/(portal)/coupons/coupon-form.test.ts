import { describe, expect, it } from 'vitest';
import type { AdminCouponRow } from '@biznexa/types';
import { couponFormErrors, emptyCouponForm, toCouponForm, toCouponRequest, type CouponFormValues } from './coupon-form';

const SVC = '11111111-1111-4111-8111-111111111111';
const form = (over: Partial<CouponFormValues> = {}): CouponFormValues => ({ ...emptyCouponForm(), code: 'diwali10', value: '10', ...over });

describe('coupon form → request', () => {
  it('sends a percent as a number and rupees as paise', () => {
    expect(toCouponRequest(form({ maxDiscount: '1,500', minOrderValue: '999.50' }))).toMatchObject({ type: 'PERCENTAGE', value: 10, maxDiscount: 150000, minOrderValue: 99950 });
    expect(toCouponRequest(form({ type: 'FIXED', value: '₹500', maxDiscount: '100' }))).toMatchObject({ type: 'FIXED', value: 50000, maxDiscount: null });
  });

  it('turns IST calendar days into a start and an exclusive end', () => {
    const r = toCouponRequest(form({ startsOn: '2026-11-01', lastDay: '2026-11-30' }));
    expect(r.startsAt).toBe('2026-11-01T00:00:00+05:30');
    expect(r.expiresAt).toBe('2026-12-01T00:00:00+05:30');
    expect(toCouponRequest(form({ lastDay: '2026-12-31' })).expiresAt).toBe('2027-01-01T00:00:00+05:30');
  });

  it('sends blanks as no limit, and every service unless limited', () => {
    expect(toCouponRequest(form({ perUserLimit: '', serviceIds: [SVC] }))).toMatchObject({ usageLimit: null, perUserLimit: null, serviceIds: [], startsAt: null, expiresAt: null });
    expect(toCouponRequest(form({ limitServices: true, serviceIds: [SVC] })).serviceIds).toEqual([SVC]);
  });
});

describe('coupon form errors', () => {
  it('uses the API rules and messages, on the inputs the admin sees', () => {
    expect(couponFormErrors(form())).toEqual({});
    expect(couponFormErrors(form({ code: '', value: '150' }))).toEqual({ code: 'Enter a coupon code', value: 'A percentage is at most 100' });
    expect(couponFormErrors(form({ value: 'ten' }))).toEqual({ value: 'Enter the discount' });
    expect(couponFormErrors(form({ startsOn: '2026-11-10', lastDay: '2026-11-09' }))).toEqual({ lastDay: 'Must be after the start date' });
    expect(couponFormErrors(form({ usageLimit: '0' }))).toEqual({ usageLimit: 'At least 1' });
  });

  it('needs a service when limited to some', () => {
    expect(couponFormErrors(form({ limitServices: true }))).toEqual({ serviceIds: 'Pick at least one service' });
  });
});

describe('coupon → form', () => {
  it('round-trips through the request', () => {
    const row = {
      code: 'DIWALI10',
      type: 'PERCENTAGE',
      value: 10,
      maxDiscount: 50050,
      minOrderValue: null,
      serviceIds: [SVC],
      startsAt: '2026-10-31T18:30:00.000Z',
      expiresAt: '2026-11-30T18:30:00.000Z',
      usageLimit: 100,
      perUserLimit: null,
      isActive: false,
    } as AdminCouponRow;
    const v = toCouponForm(row);
    expect(v).toMatchObject({ value: '10', maxDiscount: '500.50', startsOn: '2026-11-01', lastDay: '2026-11-30', limitServices: true, usageLimit: '100', perUserLimit: '' });
    const r = toCouponRequest(v);
    expect(new Date(r.startsAt!).toISOString()).toBe(row.startsAt);
    expect(new Date(r.expiresAt!).toISOString()).toBe(row.expiresAt);
    expect(r).toMatchObject({ maxDiscount: 50050, serviceIds: [SVC], isActive: false });
  });
});
