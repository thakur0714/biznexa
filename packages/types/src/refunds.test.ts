import { describe, expect, it } from 'vitest';
import { financialYear } from './format';
import {
  CREDIT_NOTE_NUMBER_PATTERN,
  creditNoteLines,
  formatCreditNoteNumber,
  INVOICE_NUMBER_MAX_LENGTH,
  invoiceLines,
  invoiceOrderLine,
  type InvoiceAmounts,
  type InvoiceLine,
  type InvoiceTaxType,
} from './invoices';
import { idempotencyKeySchema, paymentStatusAfterRefunds, refundableAmount, refundCreateInput } from './payments';

const item = (over: Partial<Parameters<typeof invoiceOrderLine>[0]> = {}) => ({
  id: 'item-1',
  description: 'GST Registration — Standard',
  sacCode: '998231',
  professionalFee: 100000,
  governmentFee: 0,
  discount: 0,
  gstRate: 18,
  ...over,
});

/** The invoice of a full payment of these order items. */
function invoiceOf(items: ReturnType<typeof item>[], taxType: InvoiceTaxType): InvoiceAmounts {
  const order = items.map((i) => invoiceOrderLine(i, taxType));
  const total = order.reduce((a, l) => a + l.taxableValue + l.cgst + l.sgst + l.igst + l.governmentFee, 0);
  return invoiceLines(order, [], total, taxType);
}

/** Every line's GST is consistent: CGST/SGST at most 1 paisa apart, total = taxable + tax, fee = taxable + discount. */
function expectConsistent(c: InvoiceAmounts, taxType: InvoiceTaxType) {
  for (const l of c.lines) {
    if (l.kind !== 'SERVICE') continue;
    expect(l.total).toBe(l.taxableValue + l.cgst + l.sgst + l.igst);
    expect(l.professionalFee).toBe(l.taxableValue + l.discount);
    if (taxType === 'IGST') expect(l.cgst + l.sgst).toBe(0);
    else {
      expect(l.igst).toBe(0);
      expect(Math.abs(l.cgst - l.sgst)).toBeLessThanOrEqual(1);
    }
  }
}

describe('credit note numbers', () => {
  it('are CN/<FY>/<6 digits>, within 16 characters, and follow the IST financial year', () => {
    const n = formatCreditNoteNumber('2026-27', 45);
    expect(n).toBe('CN/2627/000045');
    expect(n).toMatch(CREDIT_NOTE_NUMBER_PATTERN);
    expect(n.length).toBeLessThanOrEqual(INVOICE_NUMBER_MAX_LENGTH);
    expect(formatCreditNoteNumber(financialYear(new Date('2027-03-31T18:29:59Z')), 1)).toBe('CN/2627/000001');
    expect(formatCreditNoteNumber(financialYear(new Date('2027-03-31T18:30:00Z')), 1)).toBe('CN/2728/000001');
    expect(() => formatCreditNoteNumber('2026-27', 0)).toThrow();
    expect(formatCreditNoteNumber('2026-27', 999_999)).toBe('CN/2627/999999');
  });
});

describe('credit note lines', () => {
  it('a full refund credits exactly the invoice, line by line', () => {
    const inv = invoiceOf([item({ governmentFee: 450000, discount: 10000 })], 'CGST_SGST');
    const cn = creditNoteLines(inv.lines, [], inv.total, 'CGST_SGST');
    expect(cn.lines).toEqual(inv.lines);
    expect({ ...cn, lines: undefined }).toEqual({ ...inv, lines: undefined });
  });

  it('a partial refund takes the same share of the fee, GST and government fee', () => {
    // ₹1,000 fee + 18 % (₹90 + ₹90) + ₹4,500 government fee = ₹5,680; refund half.
    const inv = invoiceOf([item({ governmentFee: 450000 })], 'CGST_SGST');
    expect(inv.total).toBe(568000);
    const cn = creditNoteLines(inv.lines, [], 284000, 'CGST_SGST');
    expect(cn).toMatchObject({ taxableValue: 50000, cgst: 4500, sgst: 4500, igst: 0, govtFees: 225000, total: 284000 });
    expect(cn.lines.map((l) => l.kind)).toEqual(['SERVICE', 'GOVERNMENT_FEE']);
    expectConsistent(cn, 'CGST_SGST');
  });

  it('IGST invoices are credited in IGST', () => {
    const inv = invoiceOf([item()], 'IGST');
    const cn = creditNoteLines(inv.lines, [], 59000, 'IGST');
    expect(cn).toMatchObject({ taxableValue: 50000, igst: 9000, cgst: 0, sgst: 0, total: 59000 });
  });

  it('works the GST back out of an odd amount to the paisa', () => {
    const inv = invoiceOf([item({ professionalFee: 99999 })], 'CGST_SGST');
    const cn = creditNoteLines(inv.lines, [], 12345, 'CGST_SGST');
    // 12345 × 100 / 118 = 10461.86 → taxable 10462, GST 1883 (941 + 942).
    expect(cn).toMatchObject({ taxableValue: 10462, cgst: 941, sgst: 942, total: 12345 });
    expectConsistent(cn, 'CGST_SGST');
  });

  it('the discount follows the taxable value', () => {
    const inv = invoiceOf([item({ discount: 20000 })], 'CGST_SGST');
    const cn = creditNoteLines(inv.lines, [], inv.total / 2, 'CGST_SGST');
    const line = cn.lines[0];
    expect(line).toMatchObject({ kind: 'SERVICE', taxableValue: 40000, discount: 10000, professionalFee: 50000 });
  });

  it('partial refunds then the rest add up to the invoice exactly, whatever the amounts', () => {
    const items = [item({ governmentFee: 33333, discount: 777 }), item({ id: 'item-2', description: 'Trademark', professionalFee: 250001, gstRate: 12, governmentFee: 0 })];
    for (const taxType of ['CGST_SGST', 'IGST'] as const) {
      const inv = invoiceOf(items, taxType);
      for (const first of [100, 1, 12345, Math.floor(inv.total / 3), inv.total - 1]) {
        const previous: InvoiceLine[] = [];
        const notes: InvoiceAmounts[] = [];
        for (const amount of [first, Math.floor((inv.total - first) / 2), inv.total - first - Math.floor((inv.total - first) / 2)]) {
          if (amount <= 0) continue;
          const cn = creditNoteLines(inv.lines, previous, amount, taxType);
          expect(cn.total).toBe(amount);
          expectConsistent(cn, taxType);
          notes.push(cn);
          previous.push(...cn.lines);
        }
        const sum = (k: 'taxableValue' | 'cgst' | 'sgst' | 'igst' | 'govtFees' | 'discount' | 'total') => notes.reduce((a, n) => a + n[k], 0);
        expect({ taxableValue: sum('taxableValue'), cgst: sum('cgst'), sgst: sum('sgst'), igst: sum('igst'), govtFees: sum('govtFees'), discount: sum('discount'), total: sum('total') }).toEqual({
          taxableValue: inv.taxableValue,
          cgst: inv.cgst,
          sgst: inv.sgst,
          igst: inv.igst,
          govtFees: inv.govtFees,
          discount: inv.discount,
          total: inv.total,
        });
      }
    }
  });

  it('refuses more than is left to credit, and non-amounts', () => {
    const inv = invoiceOf([item()], 'CGST_SGST');
    const half = creditNoteLines(inv.lines, [], 59000, 'CGST_SGST');
    expect(() => creditNoteLines(inv.lines, half.lines, 59001, 'CGST_SGST')).toThrow(/more than/);
    expect(creditNoteLines(inv.lines, half.lines, 59000, 'CGST_SGST').total).toBe(59000);
    expect(() => creditNoteLines(inv.lines, [], 0, 'CGST_SGST')).toThrow();
    expect(() => creditNoteLines(inv.lines, [], 1.5, 'CGST_SGST')).toThrow();
  });
});

describe('refund status and amounts', () => {
  const r = (amount: number, status: 'INITIATED' | 'PROCESSED' | 'FAILED') => ({ amount, status });

  it('works the payment status out from its refunds', () => {
    expect(paymentStatusAfterRefunds(1000, [])).toBe('SUCCESS');
    expect(paymentStatusAfterRefunds(1000, [r(400, 'INITIATED')])).toBe('REFUND_INITIATED');
    expect(paymentStatusAfterRefunds(1000, [r(400, 'PROCESSED')])).toBe('PARTIALLY_REFUNDED');
    expect(paymentStatusAfterRefunds(1000, [r(400, 'PROCESSED'), r(600, 'PROCESSED')])).toBe('REFUNDED');
    expect(paymentStatusAfterRefunds(1000, [r(1000, 'FAILED')])).toBe('SUCCESS');
    expect(paymentStatusAfterRefunds(1000, [r(400, 'PROCESSED'), r(600, 'FAILED')])).toBe('PARTIALLY_REFUNDED');
    expect(paymentStatusAfterRefunds(1000, [r(400, 'PROCESSED'), r(600, 'INITIATED')])).toBe('REFUND_INITIATED');
  });

  it('counts refunds in flight against what is left, failed ones not', () => {
    expect(refundableAmount(1000, [])).toBe(1000);
    expect(refundableAmount(1000, [r(400, 'PROCESSED'), r(300, 'INITIATED'), r(300, 'FAILED')])).toBe(300);
    expect(refundableAmount(1000, [r(1000, 'PROCESSED')])).toBe(0);
  });

  it('validates the request body and the Idempotency-Key header', () => {
    expect(refundCreateInput.safeParse({ amount: 100, reason: 'Service cancelled' }).success).toBe(true);
    expect(refundCreateInput.safeParse({ amount: 99, reason: 'Service cancelled' }).success).toBe(false);
    expect(refundCreateInput.safeParse({ amount: 100.5, reason: 'Service cancelled' }).success).toBe(false);
    expect(refundCreateInput.safeParse({ amount: 100, reason: ' x ' }).success).toBe(false);
    expect(refundCreateInput.safeParse({ amount: 100, reason: 'ok reason', status: 'PROCESSED' }).success).toBe(false);
    expect(idempotencyKeySchema.safeParse('3f1c2a9e-0b7d-4c55-9a51-0d1f5b8c2e11').success).toBe(true);
    expect(idempotencyKeySchema.safeParse(undefined).success).toBe(false);
    expect(idempotencyKeySchema.safeParse('short').success).toBe(false);
    expect(idempotencyKeySchema.safeParse('has spaces in it').success).toBe(false);
  });
});
