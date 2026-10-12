/**
 * Order summary & totals (M3.13, D40). The API is the only place totals are decided: it recomputes them
 * from the package prices, the coupon and the place of supply every time the summary is shown or the
 * coupon changes. The customer can send a coupon code and nothing else — no amounts.
 */
import { z } from 'zod';
import { couponCodeSchema } from './coupons';
import { calculatePrice } from './pricing';
import { stateName, type IndianState } from './states';

/** One order line as priced: amounts in paise; `discount` already decided by the coupon. */
export interface OrderLineInput {
  professionalFee: number;
  governmentFee: number;
  gstRate: number;
  discount: number;
}

/** Where the place of supply came from: the business on the order, the customer's profile, or — when neither is known — the seller's own state. */
export const PLACE_OF_SUPPLY_SOURCES = ['BUSINESS', 'PROFILE', 'SELLER'] as const;
export type PlaceOfSupplySource = (typeof PLACE_OF_SUPPLY_SOURCES)[number];

/**
 * Place of supply for a service to a customer in India (IGST Act s.12(2)): the buyer's state when on
 * record (the business on the order, else the customer's profile), otherwise the supplier's location.
 * Null only when nothing is known, which `calculatePrice` treats as inter-state (IGST).
 */
export function placeOfSupply(states: {
  business?: string | null;
  profile?: string | null;
  seller?: string | null;
}): { state: IndianState; source: PlaceOfSupplySource } | null {
  const business = stateName(states.business);
  if (business) return { state: business, source: 'BUSINESS' };
  const profile = stateName(states.profile);
  if (profile) return { state: profile, source: 'PROFILE' };
  const seller = stateName(states.seller);
  if (seller) return { state: seller, source: 'SELLER' };
  return null;
}

/**
 * Prices each line with `calculatePrice` (GST on the fee after its discount, government fee untaxed)
 * and adds them up. Tax is rounded per line, as each line appears on the invoice.
 */
export function orderTotals(lines: OrderLineInput[], states: { sellerState: string | null; placeOfSupply: string | null }) {
  const priced = lines.map((l) =>
    calculatePrice({
      professionalFee: l.professionalFee,
      governmentFee: l.governmentFee,
      gstRate: l.gstRate,
      discount: l.discount,
      sellerState: states.sellerState,
      buyerState: states.placeOfSupply,
    }),
  );
  const sum = (k: 'professionalFee' | 'discount' | 'taxableValue' | 'cgst' | 'sgst' | 'igst' | 'totalTax' | 'governmentFee' | 'total') =>
    priced.reduce((a, p) => a + p[k], 0);
  return {
    lines: priced,
    /** Same for every line: it depends only on the two states. */
    taxType: priced[0]?.taxType ?? ('IGST' as const),
    professionalFee: sum('professionalFee'),
    discount: sum('discount'),
    taxableValue: sum('taxableValue'),
    cgst: sum('cgst'),
    sgst: sum('sgst'),
    igst: sum('igst'),
    taxTotal: sum('totalTax'),
    governmentFee: sum('governmentFee'),
    total: sum('total'),
  };
}
export type OrderTotals = ReturnType<typeof orderTotals>;

/** The gateways' minimum charge, ₹1: neither part of a split payment may be smaller. */
export const MIN_ONLINE_PAYMENT = 100;

/** A priced order line and the advance % copied from its package (null = no part payment). */
export interface AdvanceLine {
  total: number;
  governmentFee: number;
  advancePercent: number | null;
}

/**
 * Paying in part (M3.19, D46): what to collect up front. Each line's **government fee is collected in full
 * with the advance** (we pay it out early, at filing); the line's advance % applies to the rest — the fee
 * after discount plus GST — rounded **up** to whole rupees. The balance is the rest of the total.
 * Null when any line can't be paid in part (no %, or not 1–99), or either part would be under ₹1.
 */
export function advancePayment(lines: AdvanceLine[]): { amount: number; balance: number; percent: number | null; governmentFee: number } | null {
  if (!lines.length || lines.some((l) => l.advancePercent == null || !Number.isInteger(l.advancePercent) || l.advancePercent < 1 || l.advancePercent > 99)) {
    return null;
  }
  const total = lines.reduce((a, l) => a + l.total, 0);
  const governmentFee = lines.reduce((a, l) => a + l.governmentFee, 0);
  const amount = Math.min(
    total,
    lines.reduce((a, l) => a + l.governmentFee + Math.ceil(((l.total - l.governmentFee) * l.advancePercent!) / 10_000) * 100, 0),
  );
  const balance = total - amount;
  if (amount < MIN_ONLINE_PAYMENT || balance < MIN_ONLINE_PAYMENT) return null;
  const percents = new Set(lines.map((l) => l.advancePercent));
  return { amount, balance, percent: percents.size === 1 ? lines[0].advancePercent : null, governmentFee };
}

/** Body of `PUT /api/applications/:id/coupon`. Strict: amounts or any other field are refused. */
export const applyCouponInput = z.object({ code: couponCodeSchema }).strict();
export type ApplyCouponInput = z.input<typeof applyCouponInput>;

const paise = z.number().int();
const TAX_TYPES = ['CGST_SGST', 'IGST'] as const;

/** `GET /api/applications/:id/summary` and the coupon endpoints: the order as the server priced it. */
export const orderSummarySchema = z.object({
  applicationId: z.string().uuid(),
  applicationCode: z.string(),
  orderId: z.string().uuid(),
  orderCode: z.string(),
  orderStatus: z.string(),
  /** False once payment has started (or the application moved on): totals are then frozen and the coupon can't change. */
  editable: z.boolean(),
  lines: z.array(
    z.object({
      description: z.string(),
      sacCode: z.string().nullable(),
      professionalFee: paise,
      discount: paise,
      taxableValue: paise,
      gstRate: z.number(),
      cgst: paise,
      sgst: paise,
      igst: paise,
      governmentFee: paise,
      total: paise,
    }),
  ),
  coupon: z.object({ code: z.string(), discount: paise }).nullable(),
  /** Set when a coupon applied earlier no longer applies and was taken off (expired, used up…). */
  couponNotice: z.string().nullable(),
  placeOfSupply: z.object({ state: z.string(), source: z.enum(PLACE_OF_SUPPLY_SOURCES) }).nullable(),
  taxType: z.enum(TAX_TYPES),
  /** Professional fees before discount. */
  professionalFee: paise,
  discount: paise,
  taxableValue: paise,
  cgst: paise,
  sgst: paise,
  igst: paise,
  taxTotal: paise,
  /** Government fees: passed through, never taxed or discounted. */
  governmentFee: paise,
  total: paise,
  /** Paid so far (confirmed by the gateway's webhook). */
  amountPaid: paise,
  /** Still to pay: `total − amountPaid`. */
  balance: paise,
  /**
   * Paying in part (M3.19): offered when every package on the order allows it and nothing is paid yet.
   * `amount` is collected now (it includes the whole `governmentFee`), `balance` later; `percent` is the
   * advance % on the fee + GST when every line has the same one.
   */
  advance: z.object({ amount: paise, balance: paise, percent: z.number().int().nullable(), governmentFee: paise }).nullable(),
});
export type OrderSummary = z.infer<typeof orderSummarySchema>;
