/**
 * Invoice numbers (M3.20, D47): `<prefix>/<FY>/<running number>`, e.g. `BN/2627/000123` for the 123rd
 * invoice of FY 2026-27. GST rule 46 allows at most 16 characters, so the year is written as `2627`
 * (the spec's `BN/2026-27/000123` is 17) and the prefix is at most 4 characters (`invoicePrefixSchema`):
 * 4 + 1 + 4 + 1 + 6 = 16. The running number restarts at 1 every 1 April (IST) and is gap-free
 * (`InvoiceNumbersService` in the API keeps one counter row per year).
 */
import { z } from 'zod';
import { GST_STATE_CODES } from './business-entities';
import { calculatePrice, splitAmount } from './pricing';
import { stateName } from './states';

export const INVOICE_NUMBER_MAX_LENGTH = 16;
/** Used when the seller has not set `invoice.prefix` (M3.14). */
export const DEFAULT_INVOICE_PREFIX = 'BN';
export const INVOICE_NUMBER_PATTERN = /^[A-Z0-9]{1,4}\/\d{4}\/\d{6}$/;

/** `2026-27` → `2627` */
export function invoiceYearCode(fy: string): string {
  const m = /^\d{2}(\d{2})-(\d{2})$/.exec(fy);
  if (!m) throw new Error(`Not a financial year: ${fy}`);
  return `${m[1]}${m[2]}`;
}

/** `BN/2627/000123`. Throws when the number would not fit in 16 characters (prefix over 4, or past 999999). */
export function formatInvoiceNumber(prefix: string, fy: string, sequence: number): string {
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error('Invoice sequence must be a positive integer');
  if (!/^[A-Z0-9]+$/.test(prefix)) throw new Error(`Invoice prefix must be upper-case letters and digits: ${prefix}`);
  const number = `${prefix}/${invoiceYearCode(fy)}/${String(sequence).padStart(6, '0')}`;
  if (number.length > INVOICE_NUMBER_MAX_LENGTH) {
    throw new Error(`Invoice number ${number} is longer than ${INVOICE_NUMBER_MAX_LENGTH} characters (GST rule 46)`);
  }
  return number;
}


const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

/** 0–99 → `Forty-Two`. */
function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : '');
}

/** 0–999 → `Three Hundred Forty-Two`. */
function threeDigits(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  return [hundreds ? `${ONES[hundreds]} Hundred` : '', rest ? twoDigits(rest) : ''].filter(Boolean).join(' ');
}

/** A whole number in the Indian system: 1,25,00,000 → `One Crore Twenty-Five Lakh`. Above 99 crore the crores are counted the same way (`One Hundred Crore`). */
export function numberInWords(n: number): string {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`Not a whole number: ${n}`);
  if (n === 0) return 'Zero';
  const crore = Math.floor(n / 10_000_000);
  const lakh = Math.floor((n % 10_000_000) / 100_000);
  const thousand = Math.floor((n % 100_000) / 1000);
  const rest = n % 1000;
  return [
    crore ? `${numberInWords(crore)} Crore` : '',
    lakh ? `${twoDigits(lakh)} Lakh` : '',
    thousand ? `${twoDigits(thousand)} Thousand` : '',
    rest ? threeDigits(rest) : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/** Invoice total in words (PROMPT §7.5): 12550050 paise → `Rupees One Lakh Twenty-Five Thousand Five Hundred and Fifty Paise Only`. */
export function amountInWords(paise: number): string {
  if (!Number.isSafeInteger(paise) || paise < 0) throw new Error(`Not an amount in paise: ${paise}`);
  const rupees = Math.floor(paise / 100);
  const p = paise % 100;
  if (!rupees && p) return `${twoDigits(p)} Paise Only`;
  return `Rupees ${numberInWords(rupees)}${p ? ` and ${twoDigits(p)} Paise` : ''} Only`;
}

// ---------------------------------------------------------------------------------------------------------
// Invoice lines (M3.21): what one payment bought, split the way the invoice shows it.

export const INVOICE_TAX_TYPES = ['CGST_SGST', 'IGST'] as const;
export type InvoiceTaxType = (typeof INVOICE_TAX_TYPES)[number];

/** One order line, priced in full (`calculatePrice`), with the tax split the invoice uses. */
export interface InvoiceOrderLine {
  orderItemId: string;
  description: string;
  sacCode: string | null;
  gstRate: number;
  professionalFee: number;
  discount: number;
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  governmentFee: number;
}

/** An order line as stored (`OrderItem`, prices frozen when payment started), priced for the invoice. */
export function invoiceOrderLine(
  item: { id: string; description: string; sacCode: string | null; professionalFee: number; governmentFee: number; discount: number; gstRate: number },
  taxType: InvoiceTaxType,
): InvoiceOrderLine {
  // The same rounding the order summary charged: tax per line, CGST the smaller half (`calculatePrice`).
  const p = calculatePrice(item);
  const cgst = taxType === 'CGST_SGST' ? Math.floor(p.totalTax / 2) : 0;
  return {
    orderItemId: item.id,
    description: item.description,
    sacCode: item.sacCode,
    gstRate: p.gstRate,
    professionalFee: p.professionalFee,
    discount: p.discount,
    taxableValue: p.taxableValue,
    cgst,
    sgst: taxType === 'CGST_SGST' ? p.totalTax - cgst : 0,
    igst: taxType === 'IGST' ? p.totalTax : 0,
    governmentFee: p.governmentFee,
  };
}

/** A professional-fee line: GST on the fee after discount. */
export interface InvoiceServiceLine {
  kind: 'SERVICE';
  orderItemId: string;
  description: string;
  sacCode: string | null;
  /** Percent; CGST and SGST are each half of it. */
  gstRate: number;
  professionalFee: number;
  discount: number;
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
}

/** A government fee: passed through at cost, outside GST, never discounted. */
export interface InvoiceGovernmentFeeLine {
  kind: 'GOVERNMENT_FEE';
  orderItemId: string;
  description: string;
  total: number;
}

export type InvoiceLine = InvoiceServiceLine | InvoiceGovernmentFeeLine;

export interface InvoiceAmounts {
  lines: InvoiceLine[];
  professionalFee: number;
  discount: number;
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  govtFees: number;
  total: number;
}

/** The part of a tax-inclusive amount that is tax, at `rate` %. */
const taxIn = (gross: number, rate: number) => gross - Math.round((gross * 100) / (100 + rate));

/**
 * The invoice for one payment of an order (M3.21). `previous` are the lines of the order's earlier invoices.
 *
 * - A payment of everything not yet invoiced (a full payment, or the balance) takes exactly what is left of
 *   every line, so an order's invoices always add up to its totals, to the paisa.
 * - A smaller payment (an advance, M3.19) takes the **government fees first** (D46 collects them in full with
 *   the advance), then a share of each line's fee + GST in proportion to what is left of it; the GST inside
 *   that share is worked back out at the line's rate, and the discount follows the taxable value.
 *
 * Throws when the payment is more than is left to invoice — that money is not owed (`overpaid`, refund).
 */
export function invoiceLines(order: InvoiceOrderLine[], previous: InvoiceLine[], amount: number, taxType: InvoiceTaxType): InvoiceAmounts {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error(`Not a payment amount: ${amount}`);
  const left = order.map((l) => {
    const before = previous.filter((p) => p.orderItemId === l.orderItemId);
    const service = before.filter((p): p is InvoiceServiceLine => p.kind === 'SERVICE');
    const sum = (k: 'professionalFee' | 'discount' | 'taxableValue' | 'cgst' | 'sgst' | 'igst') => service.reduce((a, p) => a + p[k], 0);
    const govt = before.filter((p) => p.kind === 'GOVERNMENT_FEE').reduce((a, p) => a + p.total, 0);
    const rest = {
      professionalFee: l.professionalFee - sum('professionalFee'),
      discount: l.discount - sum('discount'),
      taxableValue: l.taxableValue - sum('taxableValue'),
      cgst: l.cgst - sum('cgst'),
      sgst: l.sgst - sum('sgst'),
      igst: l.igst - sum('igst'),
      governmentFee: l.governmentFee - govt,
    };
    if (Object.values(rest).some((v) => v < 0)) throw new Error(`Order line ${l.orderItemId} is invoiced beyond its price`);
    return rest;
  });
  const gross = left.map((r) => r.taxableValue + r.cgst + r.sgst + r.igst);
  const owed = left.reduce((a, r, i) => a + gross[i] + r.governmentFee, 0);
  if (amount > owed) throw new Error(`Payment of ${amount} paise is more than the ${owed} paise left to invoice`);

  let parts: { professionalFee: number; discount: number; taxableValue: number; cgst: number; sgst: number; igst: number; governmentFee: number }[];
  if (amount === owed) {
    parts = left;
  } else {
    const govtFees = splitShare(Math.min(amount, left.reduce((a, r) => a + r.governmentFee, 0)), left.map((r) => r.governmentFee));
    const shares = splitShare(amount - govtFees.reduce((a, g) => a + g, 0), gross);
    parts = left.map((r, i) => {
      const g = shares[i];
      const tax = Math.min(taxIn(g, order[i].gstRate), r.cgst + r.sgst + r.igst);
      const taxableValue = g - tax;
      const discount = r.taxableValue > 0 ? Math.min(r.discount, Math.round((r.discount * taxableValue) / r.taxableValue)) : 0;
      const cgst = taxType === 'CGST_SGST' ? Math.min(Math.floor(tax / 2), r.cgst) : 0;
      const sgst = taxType === 'CGST_SGST' ? tax - cgst : 0;
      return { professionalFee: taxableValue + discount, discount, taxableValue, cgst, sgst, igst: taxType === 'IGST' ? tax : 0, governmentFee: govtFees[i] };
    });
  }

  const lines: InvoiceLine[] = [];
  for (const [i, p] of parts.entries()) {
    const l = order[i];
    const total = p.taxableValue + p.cgst + p.sgst + p.igst;
    if (p.professionalFee || total) {
      lines.push({ kind: 'SERVICE', orderItemId: l.orderItemId, description: l.description, sacCode: l.sacCode, gstRate: l.gstRate, ...pick(p), total });
    }
    if (p.governmentFee) lines.push({ kind: 'GOVERNMENT_FEE', orderItemId: l.orderItemId, description: `Government fee — ${l.description}`, total: p.governmentFee });
  }
  const sum = (k: 'professionalFee' | 'discount' | 'taxableValue' | 'cgst' | 'sgst' | 'igst') =>
    lines.reduce((a, l) => a + (l.kind === 'SERVICE' ? l[k] : 0), 0);
  const result: InvoiceAmounts = {
    lines,
    professionalFee: sum('professionalFee'),
    discount: sum('discount'),
    taxableValue: sum('taxableValue'),
    cgst: sum('cgst'),
    sgst: sum('sgst'),
    igst: sum('igst'),
    govtFees: lines.reduce((a, l) => a + (l.kind === 'GOVERNMENT_FEE' ? l.total : 0), 0),
    total: lines.reduce((a, l) => a + l.total, 0),
  };
  if (result.total !== amount) throw new Error(`Invoice lines add up to ${result.total} paise, not the ${amount} paid`);
  return result;
}

const pick = (p: { professionalFee: number; discount: number; taxableValue: number; cgst: number; sgst: number; igst: number }) => ({
  professionalFee: p.professionalFee,
  discount: p.discount,
  taxableValue: p.taxableValue,
  cgst: p.cgst,
  sgst: p.sgst,
  igst: p.igst,
});

/** `splitAmount`, but never giving a part more than its weight (the weights are what is left of each line). */
function splitShare(total: number, weights: number[]): number[] {
  const parts = splitAmount(total, weights).map((p, i) => Math.min(p, weights[i]));
  let short = total - parts.reduce((a, p) => a + p, 0);
  for (let i = 0; short > 0 && i < parts.length; i++) {
    const add = Math.min(short, weights[i] - parts[i]);
    parts[i] += add;
    short -= add;
  }
  return parts;
}

/** The seller as printed on the invoice: copied from Settings (M3.14) when it is issued, as they can change later. */
export interface InvoiceSeller {
  name: string | null;
  legalName: string | null;
  gstin: string | null;
  email: string | null;
  phone: string | null;
  address: { line1: string; line2?: string; city: string; state: string; pincode: string } | null;
  state: string | null;
}

/** The buyer as printed on the invoice: the business on the application, else the customer (M3.7 note). */
export interface InvoiceBuyer {
  name: string;
  gstin: string | null;
  email: string | null;
  mobile: string | null;
  address: { line1: string; line2?: string; city: string; state: string; pincode: string } | null;
  state: string | null;
}

/**
 * A state's two-digit GST code, printed beside the place of supply (GST rule 46): `Punjab` → `03`. Where a
 * state has two codes the current one wins (Andhra Pradesh 37, Dadra and Nagar Haveli and Daman and Diu 26).
 */
export function gstStateCode(state: string | null | undefined): string | null {
  const name = stateName(state);
  if (!name) return null;
  let code: string | null = null;
  for (const [c, n] of Object.entries(GST_STATE_CODES)) if (n === name && (!code || c > code)) code = c;
  return code;
}

// ---------------------------------------------------------------------------------------------------------
// Customer invoices (M3.23): the list and the PDF download link (`fileLinkSchema`).

export const invoiceListQuery = z.object({
  applicationId: z.string().uuid().optional().describe('Only the invoices of this application’s order'),
});
export type InvoiceListQuery = z.infer<typeof invoiceListQuery>;

export const invoiceSummarySchema = z.object({
  id: z.string().uuid(),
  number: z.string(),
  issuedAt: z.string().datetime(),
  orderCode: z.string(),
  /** Integer paise: the payment this invoice is for. */
  total: z.number().int(),
  /** False until the PDF is generated (usually seconds after payment); the download link is refused until then. */
  pdfReady: z.boolean(),
});
export type InvoiceSummary = z.infer<typeof invoiceSummarySchema>;
export const invoiceListSchema = z.array(invoiceSummarySchema);
