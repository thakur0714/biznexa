import { gstStateCode } from '@biznexa/types';
import { htmlText } from '../pdf/pdf-renderer';
import { esc, invoiceHtml, type InvoicePrint } from './invoice-template';

const seller = {
  name: 'BizNexa',
  legalName: 'BizNexa Services Private Limited',
  gstin: '03AAACB1234C1ZV',
  email: 'billing@example.com',
  phone: null,
  address: { line1: '12 Mall Road', city: 'Ludhiana', state: 'Punjab', pincode: '141001' },
  state: 'Punjab',
};

const intra: InvoicePrint = {
  number: 'BN/2627/000123',
  issuedAt: new Date('2026-10-11T06:30:00Z'),
  seller,
  buyer: { name: 'Acme Traders Pvt Ltd', gstin: '03AAACT2727Q1ZW', email: 'a@example.com', mobile: null, address: { line1: '4 Ring Road', city: 'Ludhiana', state: 'Punjab', pincode: '141002' }, state: 'Punjab' },
  placeOfSupply: 'Punjab',
  taxType: 'CGST_SGST',
  lines: [
    { kind: 'SERVICE', orderItemId: 'i1', description: 'GST Registration — Basic', sacCode: '998231', gstRate: 18, professionalFee: 100000, discount: 10000, taxableValue: 90000, cgst: 8100, sgst: 8100, igst: 0, total: 106200 },
    { kind: 'GOVERNMENT_FEE', orderItemId: 'i1', description: 'Government fee — GST Registration — Basic', total: 450000 },
  ],
  taxableValue: 90000,
  cgst: 8100,
  sgst: 8100,
  igst: 0,
  govtFees: 450000,
  discount: 10000,
  total: 556200,
  amountInWords: 'Rupees Five Thousand Five Hundred Sixty-Two Only',
  orderCode: 'ORD-2026-000045',
  payment: { reference: 'pay_ABC123', method: 'upi', paidAt: new Date('2026-10-11T06:29:00Z') },
};

const text = (inv: InvoicePrint) => htmlText(invoiceHtml(inv)).join('\n');

describe('invoice template (M3.23)', () => {
  it('prints what GST rule 46 asks for', () => {
    const t = text(intra);
    for (const s of [
      'TAX INVOICE'.toLowerCase(),
      'BizNexa Services Private Limited',
      'GSTIN 03AAACB1234C1ZV',
      'BN/2627/000123',
      '11-Oct-2026',
      'Place of supply Punjab (03)',
      'Reverse charge No',
      'Acme Traders Pvt Ltd',
      'GSTIN 03AAACT2727Q1ZW',
      '998231',
      'CGST',
      'SGST',
      '9%',
      '1,000.00',
      '−100.00',
      '900.00',
      '81.00',
      '4,500.00',
      'not subject to GST',
      'Rupees Five Thousand Five Hundred Sixty-Two Only',
      '₹5,562.00',
      'For BizNexa Services Private Limited',
      'Authorised signatory',
      'ORD-2026-000045',
      'pay_ABC123',
    ]) {
      expect(t.toLowerCase()).toContain(s.toLowerCase());
    }
    expect(t).not.toContain('IGST');
  });

  it('inter-state: IGST at the full rate, the buyer unregistered without an address', () => {
    const inv: InvoicePrint = {
      ...intra,
      buyer: { name: 'Riya Sharma', gstin: null, email: null, mobile: '9876500000', address: null, state: 'Delhi' },
      placeOfSupply: 'Delhi',
      taxType: 'IGST',
      lines: [{ ...(intra.lines[0] as Extract<InvoicePrint['lines'][number], { kind: 'SERVICE' }>), discount: 0, professionalFee: 90000, cgst: 0, sgst: 0, igst: 16200 }],
      cgst: 0,
      sgst: 0,
      igst: 16200,
      govtFees: 0,
      discount: 0,
      total: 106200,
    };
    const t = text(inv);
    expect(t).toContain('Place of supply Delhi (07)');
    expect(t).toContain('Unregistered (no GSTIN)');
    expect(t).toMatch(/IGST[\s\S]*18%[\s\S]*162\.00/);
    expect(t).not.toMatch(/\bCGST\b/);
    expect(t).not.toContain('Discount');
    expect(t).not.toContain('Government fees');
  });

  it('is titled "Invoice", not "Tax Invoice", while the seller has no GSTIN', () => {
    const html = invoiceHtml({ ...intra, seller: { ...seller, gstin: null } });
    expect(html).toContain('<div class="title">Invoice</div>');
    expect(htmlText(html).join('\n')).toContain('Not registered under GST');
  });

  it('escapes every printed value', () => {
    const html = invoiceHtml({
      ...intra,
      buyer: { ...intra.buyer, name: '<img src=x onerror=alert(1)> & "Co"' },
      lines: [{ ...intra.lines[1], description: '</td><script>x</script>' }],
    });
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;Co&quot;');
    expect(esc(`'<>&"`)).toBe('&#39;&lt;&gt;&amp;&quot;');
  });

  it('is self-contained: fonts inline, nothing fetched', () => {
    const html = invoiceHtml(intra);
    expect(html).toContain("src:url(data:font/woff2;base64,");
    expect(html).not.toMatch(/(src|href)=["']?https?:/);
    expect(html).not.toMatch(/url\((?!data:)/);
  });

  it('GST state codes, the current code where a state has two', () => {
    expect(gstStateCode('Punjab')).toBe('03');
    expect(gstStateCode('Andhra Pradesh')).toBe('37');
    expect(gstStateCode('Dadra and Nagar Haveli and Daman and Diu')).toBe('26');
    expect(gstStateCode(null)).toBeNull();
    expect(gstStateCode('Atlantis')).toBeNull();
  });
});
