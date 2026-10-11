import { z } from 'zod';
import { couponDiscount, splitAmount } from './pricing';

/**
 * Coupon validation rules (M3.11, D38), shared so the API decides and the web can show the same messages.
 * The API loads the coupon and its redemption counts; everything else here is pure.
 */

/** Coupon codes are stored and compared in upper case, without surrounding spaces. */
export const couponCodeSchema = z
  .string({ required_error: 'Enter a coupon code' })
  .trim()
  .min(1, 'Enter a coupon code')
  .max(32, 'Coupon codes are at most 32 characters')
  .regex(/^[A-Za-z0-9_-]+$/, 'Coupon codes use only letters, numbers, - and _')
  .transform((s) => s.toUpperCase());

/** The coupon as stored (amounts in paise; `value` is a percent for PERCENTAGE). */
export interface CouponForValidation {
  id: string;
  code: string;
  type: 'PERCENTAGE' | 'FIXED';
  value: number;
  maxDiscount: number | null;
  minOrderValue: number | null;
  /** Empty = every service. */
  serviceIds: string[];
  startsAt: Date | null;
  expiresAt: Date | null;
  /** Total redemptions allowed; null = no limit. */
  usageLimit: number | null;
  /** Redemptions allowed per customer; null = no limit. */
  perUserLimit: number | null;
  isActive: boolean;
}

export interface CouponOrderLine {
  serviceId: string;
  /** Professional fee in paise (the only part a coupon discounts). */
  professionalFee: number;
}

export interface CouponContext {
  lines: CouponOrderLine[];
  /** Completed redemptions of this coupon by anyone. */
  timesUsed: number;
  /** Completed redemptions of this coupon by this customer. */
  timesUsedByUser: number;
  now: Date;
}

export const COUPON_REJECTIONS = {
  NOT_FOUND: 'This coupon code is not valid.',
  INACTIVE: 'This coupon code is not valid.',
  NOT_STARTED: 'This coupon is not active yet.',
  EXPIRED: 'This coupon has expired.',
  SERVICE_MISMATCH: 'This coupon cannot be used for this service.',
  MIN_ORDER: 'Your order is below the minimum amount for this coupon.',
  USAGE_LIMIT: 'This coupon has reached its usage limit.',
  PER_USER_LIMIT: 'You have already used this coupon the maximum number of times.',
  NO_DISCOUNT: 'This coupon gives no discount on this order.',
} as const;
export type CouponRejection = keyof typeof COUPON_REJECTIONS;

export type CouponEvaluation =
  | {
      ok: true;
      couponId: string;
      code: string;
      /** Discount in paise, never more than the eligible professional fee. */
      discount: number;
      /** Professional fee of the lines the coupon applies to, in paise. */
      eligibleAmount: number;
      /**
       * The discount per order line, in the order the lines were given: shared across the matching lines
       * in proportion to their professional fees (0 for lines the coupon does not cover). Adds up to `discount`.
       */
      lineDiscounts: number[];
    }
  | { ok: false; reason: CouponRejection; message: string; minOrderValue?: number };

const reject = (reason: CouponRejection, extra: { minOrderValue?: number } = {}): CouponEvaluation => ({
  ok: false,
  reason,
  message: COUPON_REJECTIONS[reason],
  ...extra,
});

/**
 * Checks a coupon against an order. Rules, in this order: active → start date → expiry → service match →
 * minimum order (on the matching lines' professional fees) → total usage limit → per-customer limit → a
 * non-zero discount. Valid from `startsAt` (inclusive) until `expiresAt` (exclusive).
 */
export function evaluateCoupon(coupon: CouponForValidation | null, ctx: CouponContext): CouponEvaluation {
  if (!coupon) return reject('NOT_FOUND');
  if (!coupon.isActive) return reject('INACTIVE');
  const now = ctx.now.getTime();
  if (coupon.startsAt && now < coupon.startsAt.getTime()) return reject('NOT_STARTED');
  if (coupon.expiresAt && now >= coupon.expiresAt.getTime()) return reject('EXPIRED');

  const covers = (l: CouponOrderLine) => !coupon.serviceIds.length || coupon.serviceIds.includes(l.serviceId);
  const eligible = ctx.lines.filter(covers);
  if (!eligible.length) return reject('SERVICE_MISMATCH');
  const eligibleAmount = eligible.reduce((sum, l) => sum + l.professionalFee, 0);

  if (coupon.minOrderValue && eligibleAmount < coupon.minOrderValue) {
    return reject('MIN_ORDER', { minOrderValue: coupon.minOrderValue });
  }
  if (coupon.usageLimit != null && ctx.timesUsed >= coupon.usageLimit) return reject('USAGE_LIMIT');
  if (coupon.perUserLimit != null && ctx.timesUsedByUser >= coupon.perUserLimit) return reject('PER_USER_LIMIT');

  const discount = couponDiscount(eligibleAmount, coupon);
  if (discount <= 0) return reject('NO_DISCOUNT');
  const lineDiscounts = splitAmount(discount, ctx.lines.map((l) => (covers(l) ? l.professionalFee : 0)));
  return { ok: true, couponId: coupon.id, code: coupon.code, discount, eligibleAmount, lineDiscounts };
}

// ─────────────── Admin coupon editing (M3.12, D39) ───────────────

export const COUPON_TYPES = ['PERCENTAGE', 'FIXED'] as const;
export type CouponType = (typeof COUPON_TYPES)[number];

/** Upper bound for amounts and limits typed in the admin (₹1 crore / one million uses). */
const MAX_PAISE = 1_000_000_000;
const MAX_USES = 1_000_000;

const paise = (blankMessage: string) =>
  z.number({ required_error: blankMessage, invalid_type_error: 'Enter an amount' }).int('Enter an amount in paise').min(1, 'Must be more than ₹0').max(MAX_PAISE, 'Too large');
const uses = z.number({ invalid_type_error: 'Enter a whole number' }).int('Enter a whole number').min(1, 'At least 1').max(MAX_USES, `At most ${MAX_USES}`);
const instant = z.string().datetime({ offset: true, message: 'Enter a valid date' });

/** Every coupon field; amounts in paise, `value` is a percent for PERCENTAGE. Null limits = no limit. */
export const couponFields = z.object({
  code: couponCodeSchema,
  type: z.enum(COUPON_TYPES, { errorMap: () => ({ message: 'Choose percentage or fixed amount' }) }),
  value: z.number({ required_error: 'Enter the discount', invalid_type_error: 'Enter the discount' }).int('Enter a whole number').min(1, 'Must be more than 0').max(MAX_PAISE, 'Too large'),
  /** Largest discount in paise; PERCENTAGE only. */
  maxDiscount: paise('Enter an amount').nullable().default(null),
  /** Smallest eligible professional fee in paise. */
  minOrderValue: paise('Enter an amount').nullable().default(null),
  /** Empty = every service. */
  serviceIds: z
    .array(z.string().uuid())
    .max(200, 'At most 200 services')
    .refine((ids) => new Set(ids).size === ids.length, 'A service is listed twice')
    .default([]),
  /** Valid from (inclusive). */
  startsAt: instant.nullable().default(null),
  /** Valid until (exclusive). */
  expiresAt: instant.nullable().default(null),
  usageLimit: uses.nullable().default(null),
  perUserLimit: uses.nullable().default(1),
  isActive: z.boolean().default(true),
});
export type CouponFields = z.infer<typeof couponFields>;

type RuleInput = Pick<CouponFields, 'type' | 'value' | 'maxDiscount'> & { startsAt: string | Date | null; expiresAt: string | Date | null };

/**
 * Rules across fields, checked on create and on the coupon as it would be after an update:
 * a percentage is 1–100, only a percentage has a cap, and the expiry is after the start.
 */
export function couponRuleIssues(c: RuleInput): { field: 'value' | 'maxDiscount' | 'expiresAt'; message: string }[] {
  const issues: ReturnType<typeof couponRuleIssues> = [];
  if (c.type === 'PERCENTAGE' && c.value > 100) issues.push({ field: 'value', message: 'A percentage is at most 100' });
  if (c.type === 'FIXED' && c.maxDiscount != null) issues.push({ field: 'maxDiscount', message: 'Only a percentage coupon has a maximum discount' });
  if (c.startsAt && c.expiresAt && new Date(c.expiresAt).getTime() <= new Date(c.startsAt).getTime()) {
    issues.push({ field: 'expiresAt', message: 'Must be after the start date' });
  }
  return issues;
}

export const createCouponInput = couponFields.superRefine((c, ctx) => {
  for (const i of couponRuleIssues(c)) ctx.addIssue({ code: 'custom', path: [i.field], message: i.message });
});
export type CreateCouponInput = z.infer<typeof createCouponInput>;
export type CreateCouponRequest = z.input<typeof createCouponInput>;

/** Only the fields sent change; the API checks `couponRuleIssues` on the merged coupon. */
export const updateCouponInput = couponFields.partial();
export type UpdateCouponInput = z.infer<typeof updateCouponInput>;

export const COUPON_STATUSES = ['ACTIVE', 'SCHEDULED', 'EXPIRED', 'USED_UP', 'INACTIVE'] as const;
export type CouponStatus = (typeof COUPON_STATUSES)[number];

/** What a customer would find today, ignoring per-order rules (service, minimum order, per-customer limit). */
export function couponStatus(
  c: { isActive: boolean; startsAt: string | Date | null; expiresAt: string | Date | null; usageLimit: number | null },
  timesUsed: number,
  now: Date = new Date(),
): CouponStatus {
  if (!c.isActive) return 'INACTIVE';
  if (c.expiresAt && now.getTime() >= new Date(c.expiresAt).getTime()) return 'EXPIRED';
  if (c.usageLimit != null && timesUsed >= c.usageLimit) return 'USED_UP';
  if (c.startsAt && now.getTime() < new Date(c.startsAt).getTime()) return 'SCHEDULED';
  return 'ACTIVE';
}

const isoDate = z.string().datetime();

/** One row of the admin coupons list (GET/POST/PATCH under /admin/coupons), with usage so far. */
export const adminCouponRowSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  type: z.enum(COUPON_TYPES),
  value: z.number().int(),
  maxDiscount: z.number().int().nullable(),
  minOrderValue: z.number().int().nullable(),
  serviceIds: z.array(z.string().uuid()),
  /** The services in `serviceIds`; `removed` = deleted from the catalogue since. */
  services: z.array(z.object({ id: z.string().uuid(), name: z.string(), removed: z.boolean() })),
  startsAt: isoDate.nullable(),
  expiresAt: isoDate.nullable(),
  usageLimit: z.number().int().nullable(),
  perUserLimit: z.number().int().nullable(),
  isActive: z.boolean(),
  createdAt: isoDate,
  status: z.enum(COUPON_STATUSES),
  /** Completed redemptions (paid orders, M3.17). */
  usage: z.object({
    redemptions: z.number().int(),
    customers: z.number().int(),
    /** Total discount given, paise. */
    discountGiven: z.number().int(),
    lastUsedAt: isoDate.nullable(),
  }),
  /** Orders (paid or not) refer to it: its code cannot change and it cannot be deleted, only deactivated. */
  inUse: z.boolean(),
});
export type AdminCouponRow = z.infer<typeof adminCouponRowSchema>;
export const adminCouponListSchema = z.array(adminCouponRowSchema);

/** Services a coupon can be limited to (not deleted; inactive ones included). */
export const couponServiceOptionsSchema = z.array(z.object({ id: z.string().uuid(), name: z.string(), isActive: z.boolean() }));
export type CouponServiceOption = z.infer<typeof couponServiceOptionsSchema>[number];
