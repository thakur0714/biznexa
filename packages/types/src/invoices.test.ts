import { describe, expect, it } from 'vitest';
import { financialYear } from './format';
import {
  amountInWords,
  formatInvoiceNumber,
  INVOICE_NUMBER_MAX_LENGTH,
  INVOICE_NUMBER_PATTERN,
  invoiceLines,
  invoiceOrderLine,
  invoiceYearCode,
  numberInWords,
  type InvoiceLine,
} from './invoices';
import { advancePayment, orderTotals } from './orders';

describe('invoice financial year', () => {
  it('changes at midnight IST between 31 March and 1 April', () => {
    // 31-Mar-2027 23:59:59 IST is 18:29:59 UTC; 01-Apr-2027 00:00 IST is 18:30 UTC (still 31 March in UTC).
    expect(financialYear(new Date('2027-03-31T18:29:59.999Z'))).toBe('2026-27');
    expect(financialYear(new Date('2027-03-31T18:30:00.000Z'))).toBe('2027-28');
    expect(formatInvoiceNumber('BN', financialYear(new Date('2027-03-31T18:29:59Z')), 4812)).toBe('BN/2627/004812');
    expect(formatInvoiceNumber('BN', financialYear(new Date('2027-03-31T18:30:00Z')), 1)).toBe('BN/2728/000001');
  });

  it('keeps 1 January in the year that started the April before', () => {
    expect(financialYear(new Date('2026-12-31T18:30:00Z'))).toBe('2026-27');
    expect(financialYear(new Date('2026-04-01T00:00:00+05:30'))).toBe('2026-27');
    expect(financialYear(new Date('2026-03-31T23:59:59+05:30'))).toBe('2025-26');
  });

  it('writes the year in four digits, across a century', () => {
    expect(invoiceYearCode('2026-27')).toBe('2627');
    expect(invoiceYearCode('2099-00')).toBe('9900');
    expect(financialYear(new Date('2099-06-01T00:00:00Z'))).toBe('2099-00');
    for (const bad of ['2026', '26-27', '2026-2027', '']) expect(() => invoiceYearCode(bad)).toThrow();
  });
});

describe('formatInvoiceNumber', () => {
  it('pads the running number to six digits', () => {
    expect(formatInvoiceNumber('BN', '2026-27', 123)).toBe('BN/2627/000123');
    expect(formatInvoiceNumber('BN', '2026-27', 999999)).toBe('BN/2627/999999');
    expect(formatInvoiceNumber('BN', '2026-27', 1)).toMatch(INVOICE_NUMBER_PATTERN);
  });

  it('fits GST rule 46 (16 characters) with the longest allowed prefix', () => {
    const n = formatInvoiceNumber('BNXA', '2026-27', 999999);
    expect(n).toBe('BNXA/2627/999999');
    expect(n).toHaveLength(INVOICE_NUMBER_MAX_LENGTH);
    expect(n).toMatch(INVOICE_NUMBER_PATTERN);
  });

  it('refuses numbers that would be longer than 16 characters', () => {
    expect(() => formatInvoiceNumber('BIZNX', '2026-27', 1)).toThrow(/16 characters/);
    expect(() => formatInvoiceNumber('BNXA', '2026-27', 1_000_000)).toThrow(/16 characters/);
  });

  it('rejects bad sequences and prefixes', () => {
    for (const n of [0, -1, 1.5, Number.NaN]) expect(() => formatInvoiceNumber('BN', '2026-27', n)).toThrow();
    for (const p of ['', 'bn', 'B/N']) expect(() => formatInvoiceNumber(p, '2026-27', 1)).toThrow();
  });
});

describe('amount in words (Indian system)', () => {
  it('groups by crore, lakh and thousand', () => {
    expect(numberInWords(0)).toBe('Zero');
    expect(numberInWords(7)).toBe('Seven');
    expect(numberInWords(42)).toBe('Forty-Two');
    expect(numberInWords(100)).toBe('One Hundred');
    expect(numberInWords(1180)).toBe('One Thousand One Hundred Eighty');
    expect(numberInWords(100000)).toBe('One Lakh');
    expect(numberInWords(125000)).toBe('One Lakh Twenty-Five Thousand');
    expect(numberInWords(9999999)).toBe('Ninety-Nine Lakh Ninety-Nine Thousand Nine Hundred Ninety-Nine');
    expect(numberInWords(12500000)).toBe('One Crore Twenty-Five Lakh');
    expect(numberInWords(1000000000)).toBe('One Hundred Crore');
    expect(numberInWords(101010101)).toBe('Ten Crore Ten Lakh Ten Thousand One Hundred One');
  });

  it('writes rupees and paise', () => {
    expect(amountInWords(568000)).toBe('Rupees Five Thousand Six Hundred Eighty Only');
    expect(amountInWords(12550050)).toBe('Rupees One Lakh Twenty-Five Thousand Five Hundred and Fifty Paise Only');
    expect(amountInWords(101)).toBe('Rupees One and One Paise Only');
    expect(amountInWords(99)).toBe('Ninety-Nine Paise Only');
    expect(amountInWords(0)).toBe('Rupees Zero Only');
    expect(() => amountInWords(-1)).toThrow();
    expect(() => amountInWords(1.5)).toThrow();
  });
});

describe('invoice lines', () => {
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
  /** What the order summary charged for the same lines. */
  const charged = (items: ReturnType<typeof item>[], intra: boolean) =>
    orderTotals(items, { sellerState: 'Punjab', placeOfSupply: intra ? 'Punjab' : 'Delhi' });

  it('intra-state: CGST + SGST, half each, with the SAC code', () => {
    const inv = invoiceLines([invoiceOrderLine(item({ professionalFee: 99999 }), 'CGST_SGST')], [], 117999, 'CGST_SGST');
    // 18 % of ₹999.99 = ₹180.00 (17999.82 → 18000 paise); CGST takes the smaller half.
    expect(inv.lines).toEqual([
      {
        kind: 'SERVICE',
        orderItemId: 'item-1',
        description: 'GST Registration — Standard',
        sacCode: '998231',
        gstRate: 18,
        professionalFee: 99999,
        discount: 0,
        taxableValue: 99999,
        cgst: 9000,
        sgst: 9000,
        igst: 0,
        total: 117999,
      },
    ]);
    expect(inv).toMatchObject({ taxableValue: 99999, cgst: 9000, sgst: 9000, igst: 0, govtFees: 0, total: 117999 });
    expect(inv.total).toBe(charged([item({ professionalFee: 99999 })], true).total);
  });

  it('inter-state: IGST only', () => {
    const inv = invoiceLines([invoiceOrderLine(item(), 'IGST')], [], 118000, 'IGST');
    expect(inv).toMatchObject({ taxableValue: 100000, cgst: 0, sgst: 0, igst: 18000, total: 118000 });
    expect(inv.lines[0]).toMatchObject({ kind: 'SERVICE', sacCode: '998231', igst: 18000, cgst: 0, sgst: 0 });
  });

  it('with a coupon: GST on the fee after discount, discount shown on the line', () => {
    const it1 = item({ discount: 15000 });
    const inv = invoiceLines([invoiceOrderLine(it1, 'CGST_SGST')], [], 100300, 'CGST_SGST');
    expect(inv.lines[0]).toMatchObject({ professionalFee: 100000, discount: 15000, taxableValue: 85000, cgst: 7650, sgst: 7650, total: 100300 });
    expect(inv).toMatchObject({ professionalFee: 100000, discount: 15000, taxableValue: 85000, total: charged([it1], true).total });
  });

  it('with a government fee: a separate line with no GST and no discount', () => {
    const it1 = item({ governmentFee: 450000, discount: 10000 });
    const inv = invoiceLines([invoiceOrderLine(it1, 'IGST')], [], 106200 + 450000, 'IGST');
    expect(inv.lines).toEqual([
      expect.objectContaining({ kind: 'SERVICE', taxableValue: 90000, igst: 16200, total: 106200 }),
      { kind: 'GOVERNMENT_FEE', orderItemId: 'item-1', description: 'Government fee — GST Registration — Standard', total: 450000 },
    ]);
    expect(inv).toMatchObject({ taxableValue: 90000, igst: 16200, govtFees: 450000, discount: 10000, total: charged([it1], false).total });
  });

  it('an advance takes the government fee, then a share of the fee + GST; the balance takes the rest exactly', () => {
    const it1 = item({ governmentFee: 450000, discount: 10000 });
    const order = [invoiceOrderLine(it1, 'CGST_SGST')];
    const total = charged([it1], true).total;
    const adv = advancePayment([{ total, governmentFee: 450000, advancePercent: 30 }])!;

    const first = invoiceLines(order, [], adv.amount, 'CGST_SGST');
    // ₹4,500 government fee + ₹319 of the ₹1,062 fee + GST: ₹270.34 taxable (319 × 100/118) + ₹48.66 GST.
    expect(first).toMatchObject({ govtFees: 450000, taxableValue: 27034, cgst: 2433, sgst: 2433, total: adv.amount });
    expect(first.discount).toBe(Math.round((10000 * 27034) / 90000));

    const second = invoiceLines(order, first.lines, adv.balance, 'CGST_SGST');
    expect(second.lines.map((l) => l.kind)).toEqual(['SERVICE']);
    expect(second.total).toBe(adv.balance);
    const t = charged([it1], true);
    const expected = { professionalFee: 100000, discount: 10000, taxableValue: t.taxableValue, cgst: t.cgst, sgst: t.sgst, igst: 0, govtFees: 450000, total };
    for (const k of Object.keys(expected) as (keyof typeof expected)[]) expect(first[k] + second[k]).toBe(expected[k]);
  });

  it('advance and balance add up to the order for any amount, rate and split', () => {
    for (const fee of [100, 999, 12345, 100000, 2499999]) {
      for (const rate of [0, 5, 12, 18, 28]) {
        for (const pct of [1, 33, 50, 99]) {
          const items = [item({ id: 'a', professionalFee: fee, gstRate: rate, governmentFee: 20000, discount: Math.floor(fee / 7) }), item({ id: 'b', professionalFee: fee * 3 + 1, gstRate: 18 })];
          for (const taxType of ['CGST_SGST', 'IGST'] as const) {
            const order = items.map((i) => invoiceOrderLine(i, taxType));
            const total = order.reduce((a, l) => a + l.taxableValue + l.cgst + l.sgst + l.igst + l.governmentFee, 0);
            const advance = Math.max(1, Math.min(total - 1, Math.round((total * pct) / 100)));
            const first = invoiceLines(order, [], advance, taxType);
            const second = invoiceLines(order, first.lines, total - advance, taxType);
            const both: InvoiceLine[] = [...first.lines, ...second.lines];
            for (const l of order) {
              const mine = both.filter((b) => b.orderItemId === l.orderItemId);
              const svc = mine.flatMap((b) => (b.kind === 'SERVICE' ? [b] : []));
              const s = (k: 'professionalFee' | 'discount' | 'taxableValue' | 'cgst' | 'sgst' | 'igst') => svc.reduce((a, b) => a + b[k], 0);
              expect([s('professionalFee'), s('discount'), s('taxableValue'), s('cgst'), s('sgst'), s('igst')]).toEqual([l.professionalFee, l.discount, l.taxableValue, l.cgst, l.sgst, l.igst]);
              expect(mine.filter((b) => b.kind === 'GOVERNMENT_FEE').reduce((a, b) => a + b.total, 0)).toBe(l.governmentFee);
              for (const b of svc) {
                expect(Math.min(b.taxableValue, b.cgst, b.sgst, b.igst, b.discount)).toBeGreaterThanOrEqual(0);
                if (taxType === 'IGST') expect(b.cgst + b.sgst).toBe(0);
                else expect(b.igst).toBe(0);
              }
            }
          }
        }
      }
    }
  });

  it('refuses to invoice more than is left', () => {
    const order = [invoiceOrderLine(item(), 'IGST')];
    expect(() => invoiceLines(order, [], 118001, 'IGST')).toThrow(/more than/);
    const paid = invoiceLines(order, [], 118000, 'IGST');
    expect(() => invoiceLines(order, paid.lines, 100, 'IGST')).toThrow(/more than/);
    expect(() => invoiceLines(order, [], 0, 'IGST')).toThrow();
  });

  it('keeps each line of a multi-line order apart', () => {
    const items = [item({ id: 'a', governmentFee: 50000 }), item({ id: 'b', description: 'Trademark — Basic', sacCode: '998213', professionalFee: 50000, gstRate: 18 })];
    const order = items.map((i) => invoiceOrderLine(i, 'CGST_SGST'));
    const inv = invoiceLines(order, [], 118000 + 50000 + 59000, 'CGST_SGST');
    expect(inv.lines.map((l) => [l.kind, l.orderItemId, l.total])).toEqual([
      ['SERVICE', 'a', 118000],
      ['GOVERNMENT_FEE', 'a', 50000],
      ['SERVICE', 'b', 59000],
    ]);
    expect(inv.total).toBe(charged(items, true).total);
  });
});
