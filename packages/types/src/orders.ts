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
});
export type OrderSummary = z.infer<typeof orderSummarySchema>;
