import { z } from 'zod';
import { couponRuleIssues, createCouponInput, type AdminCouponRow, type CouponType, type CreateCouponRequest } from '@biznexa/types';

/**
 * Coupon editor form (M3.12). Inputs hold what the admin types (rupees, a percent, IST calendar days);
 * `couponFormSchema` turns that into the API request and validates it with the API's own
 * `createCouponInput`, so the form shows the server's rules and messages (D7).
 */
export interface CouponFormValues {
  code: string;
  type: CouponType;
  /** Percent for PERCENTAGE, rupees for FIXED. */
  value: string;
  maxDiscount: string;
  minOrderValue: string;
  /** false = every service. */
  limitServices: boolean;
  serviceIds: string[];
  /** YYYY-MM-DD, IST; blank = from now. */
  startsOn: string;
  /** Last valid day (inclusive), YYYY-MM-DD, IST; blank = no end. */
  lastDay: string;
  usageLimit: string;
  perUserLimit: string;
  isActive: boolean;
}

export type CouponFormField = keyof CouponFormValues;

export const emptyCouponForm = (): CouponFormValues => ({
  code: '',
  type: 'PERCENTAGE',
  value: '',
  maxDiscount: '',
  minOrderValue: '',
  limitServices: false,
  serviceIds: [],
  startsOn: '',
  lastDay: '',
  usageLimit: '',
  perUserLimit: '1',
  isActive: true,
});

const IST = '+05:30';
const DAY = 24 * 60 * 60 * 1000;
const IST_OFFSET = 5.5 * 60 * 60 * 1000;

/** "2026-11-30" → the next day's midnight in IST (the coupon stops working when that day starts). */
const dayAfter = (d: string) => new Date(Date.parse(`${d}T00:00:00${IST}`) + DAY + IST_OFFSET).toISOString().slice(0, 10);
/** An instant → its calendar day in IST. */
const istDay = (iso: string, minus = 0) => new Date(Date.parse(iso) - minus + IST_OFFSET).toISOString().slice(0, 10);
const isDay = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));

/** Blank → null; anything that is not a whole number → NaN, which the API schema reports in its own words. */
const numberOrNull = (v: string) => (v.trim() === '' ? null : /^\d+$/.test(v.trim()) ? Number(v.trim()) : NaN);
/** "1,499.50" rupees → 149950 paise; blank → null. */
const rupeesToPaise = (v: string) => {
  const clean = v.replace(/[₹,\s]/g, '');
  if (clean === '') return null;
  return /^\d+(\.\d{1,2})?$/.test(clean) ? Math.round(Number(clean) * 100) : NaN;
};
const paiseToRupees = (p: number | null) => (p == null ? '' : p % 100 === 0 ? String(p / 100) : (p / 100).toFixed(2));

export function toCouponRequest(v: CouponFormValues): CreateCouponRequest {
  const percent = v.type === 'PERCENTAGE';
  return {
    code: v.code,
    type: v.type,
    value: (percent ? numberOrNull(v.value) : rupeesToPaise(v.value)) ?? NaN,
    maxDiscount: percent ? rupeesToPaise(v.maxDiscount) : null,
    minOrderValue: rupeesToPaise(v.minOrderValue),
    serviceIds: v.limitServices ? v.serviceIds : [],
    // A day that is not a date reaches the API schema as an invalid instant, which it reports.
    startsAt: v.startsOn ? (isDay(v.startsOn) ? `${v.startsOn}T00:00:00${IST}` : v.startsOn) : null,
    expiresAt: v.lastDay ? (isDay(v.lastDay) ? `${dayAfter(v.lastDay)}T00:00:00${IST}` : v.lastDay) : null,
    usageLimit: numberOrNull(v.usageLimit),
    perUserLimit: numberOrNull(v.perUserLimit),
    isActive: v.isActive,
  };
}

export function toCouponForm(c: AdminCouponRow): CouponFormValues {
  return {
    code: c.code,
    type: c.type,
    value: c.type === 'PERCENTAGE' ? String(c.value) : paiseToRupees(c.value),
    maxDiscount: paiseToRupees(c.maxDiscount),
    minOrderValue: paiseToRupees(c.minOrderValue),
    limitServices: c.serviceIds.length > 0,
    serviceIds: c.serviceIds,
    startsOn: c.startsAt ? istDay(c.startsAt) : '',
    // Valid until the start of `expiresAt`, so the last full day is the one before it.
    lastDay: c.expiresAt ? istDay(c.expiresAt, 1) : '',
    usageLimit: c.usageLimit == null ? '' : String(c.usageLimit),
    perUserLimit: c.perUserLimit == null ? '' : String(c.perUserLimit),
    isActive: c.isActive,
  };
}

/** Request field → the form input that shows its error. */
const FIELD_OF: Record<string, CouponFormField> = { startsAt: 'startsOn', expiresAt: 'lastDay', serviceIds: 'serviceIds' };
export const formFieldOf = (path: string): CouponFormField => (FIELD_OF[path.split('.')[0]] ?? path.split('.')[0]) as CouponFormField;

const formValues = z.custom<CouponFormValues>();
export const couponFormSchema = formValues.transform(toCouponRequest).pipe(createCouponInput);

/** Field errors for the form, keyed by input; empty when the request is valid. */
export function couponFormErrors(v: CouponFormValues): Partial<Record<CouponFormField, string>> {
  const errors: Partial<Record<CouponFormField, string>> = {};
  const r = couponFormSchema.safeParse(v);
  for (const i of r.error?.issues ?? []) errors[formFieldOf(i.path.map(String).join('.'))] ??= i.message;
  // zod skips the cross-field rules while any field is invalid; show them together anyway.
  for (const i of couponRuleIssues(toCouponRequest(v) as Parameters<typeof couponRuleIssues>[0])) errors[formFieldOf(i.field)] ??= i.message;
  // An empty list would mean "every service" to the API.
  if (v.limitServices && !v.serviceIds.length) errors.serviceIds ??= 'Pick at least one service';
  return errors;
}
