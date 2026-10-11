/**
 * Price and GST calculation shared by API, web and mobile.
 * All money is handled in integer paise to avoid floating-point errors.
 *
 * Rules (India):
 * - GST applies to the professional fee (after discount), not to government fees.
 * - Seller and buyer in the same state  → CGST + SGST (half each).
 * - Different states or buyer state unknown → IGST. (The order summary passes the seller's state as the
 *   place of supply when the buyer's is unknown, M3.13.)
 * States may be written as names, two-letter codes or GST codes (`stateName`).
 */

import { stateName } from './states';

export interface PriceInput {
  /** Professional fee in paise */
  professionalFee: number;
  /** Government / statutory fee in paise (non-taxable pass-through) */
  governmentFee: number;
  /** GST rate in percent, e.g. 18 */
  gstRate: number;
  /** Discount in paise, applied to the professional fee only */
  discount?: number;
  /** State of the seller (from Settings), e.g. "PB" or "Punjab" */
  sellerState?: string | null;
  /** State of the buyer (place of supply), e.g. "Punjab" */
  buyerState?: string | null;
}

export interface PriceBreakdown {
  professionalFee: number;
  discount: number;
  taxableValue: number;
  gstRate: number;
  taxType: 'CGST_SGST' | 'IGST';
  cgst: number;
  sgst: number;
  igst: number;
  totalTax: number;
  governmentFee: number;
  total: number;
}

export function calculatePrice(input: PriceInput): PriceBreakdown {
  const { professionalFee, governmentFee, gstRate } = input;
  if (professionalFee < 0 || governmentFee < 0) throw new Error('Fees cannot be negative');
  if (gstRate < 0 || gstRate > 28) throw new Error('Invalid GST rate');

  const discount = Math.min(Math.max(input.discount ?? 0, 0), professionalFee);
  const taxableValue = professionalFee - discount;
  const totalTax = Math.round((taxableValue * gstRate) / 100);

  const intraState = !!input.sellerState && !!input.buyerState && sameState(input.sellerState, input.buyerState);

  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  if (intraState) {
    cgst = Math.floor(totalTax / 2);
    sgst = totalTax - cgst;
  } else {
    igst = totalTax;
  }

  return {
    professionalFee,
    discount,
    taxableValue,
    gstRate,
    taxType: intraState ? 'CGST_SGST' : 'IGST',
    cgst,
    sgst,
    igst,
    totalTax,
    governmentFee,
    total: taxableValue + totalTax + governmentFee,
  };
}

export interface CouponRule {
  type: 'PERCENTAGE' | 'FIXED';
  /** Percent (e.g. 10) for PERCENTAGE, paise for FIXED */
  value: number;
  /** Maximum discount in paise (PERCENTAGE only) */
  maxDiscount?: number | null;
  /** Minimum professional fee in paise for the coupon to apply */
  minOrderValue?: number | null;
}

/** Returns the discount in paise for a professional fee, or 0 if the coupon doesn't apply. */
export function couponDiscount(professionalFee: number, rule: CouponRule): number {
  if (rule.minOrderValue && professionalFee < rule.minOrderValue) return 0;
  let d =
    rule.type === 'PERCENTAGE'
      ? Math.round((professionalFee * rule.value) / 100)
      : rule.value;
  if (rule.type === 'PERCENTAGE' && rule.maxDiscount) d = Math.min(d, rule.maxDiscount);
  return Math.min(Math.max(d, 0), professionalFee);
}

/** True when both name the same state, however each is written; unrecognised values compare as text. */
export function sameState(a: string, b: string): boolean {
  const key = (s: string) => stateName(s) ?? s.trim().toUpperCase();
  return key(a) === key(b);
}

/**
 * Splits `total` paise across parts in proportion to `weights`, so the parts add up to exactly `total`
 * (largest remainder; ties go to the earlier part). Zero weights get nothing; all-zero weights give zeros.
 */
export function splitAmount(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, w) => a + w, 0);
  if (sum <= 0 || total <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (total * w) / sum);
  const parts = exact.map(Math.floor);
  let left = total - parts.reduce((a, p) => a + p, 0);
  const order = exact.map((e, i) => ({ i, r: e - Math.floor(e) })).sort((x, y) => y.r - x.r || x.i - y.i);
  for (const { i } of order) {
    if (left <= 0) break;
    if (weights[i] > 0) {
      parts[i]++;
      left--;
    }
  }
  return parts;
}
