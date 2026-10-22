import { readFileSync } from 'node:fs';
import { formatDate, formatINRExact, gstStateCode, type InvoiceBuyer, type InvoiceLine, type InvoiceSeller, type InvoiceTaxType } from '@biznexa/types';

/** Everything printed on an invoice: the `Invoice` row as issued (M3.21) plus its order code and payment reference. */
export interface InvoicePrint {
  number: string;
  issuedAt: Date;
  seller: InvoiceSeller;
  buyer: InvoiceBuyer;
  placeOfSupply: string | null;
  taxType: InvoiceTaxType;
  lines: InvoiceLine[];
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  govtFees: number;
  discount: number;
  total: number;
  amountInWords: string;
  orderCode: string;
  payment: { reference: string | null; method: string | null; paidAt: Date | null };
  /** Set for a credit note (M4.13): printed as a credit note against this invoice, the amounts being what is credited. */
  creditNote?: { invoiceNumber: string; invoiceDate: Date; reason: string };
}

/** Escapes text for HTML content and attribute values. Every value from the database goes through this. */
export function esc(value: string | number | null | undefined): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const money = (paise: number) => esc(formatINRExact(paise));
/** Amounts in the table: no ₹ on every cell, the column header says it. */
const amount = (paise: number) => esc(formatINRExact(paise).replace('₹', ''));

let fontFaces: string | null = null;

/**
 * Noto Sans 400/700, latin + latin-ext (₹ is U+20B9, in latin-ext), as `data:` URLs: the renderer has no
 * network (D49) and Chromium's default fonts lack ₹ on some Linux images. Read once.
 */
function fonts(): string {
  if (fontFaces) return fontFaces;
  const face = (subset: string, weight: number, range: string) => {
    const file = require.resolve(`@fontsource/noto-sans/files/noto-sans-${subset}-${weight}-normal.woff2`);
    const data = readFileSync(file).toString('base64');
    return `@font-face{font-family:'Noto Sans';font-weight:${weight};font-style:normal;src:url(data:font/woff2;base64,${data}) format('woff2');unicode-range:${range}}`;
  };
  const LATIN = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
  const LATIN_EXT = 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';
  fontFaces = [400, 700].flatMap((w) => [face('latin', w, LATIN), face('latin-ext', w, LATIN_EXT)]).join('\n');
  return fontFaces;
}

const METHOD: Record<string, string> = { upi: 'UPI', card: 'Card', netbanking: 'Net banking', wallet: 'Wallet', emi: 'EMI' };

function address(a: InvoiceSeller['address']): string {
  if (!a) return '';
  return [a.line1, a.line2, `${a.city}, ${a.state} ${a.pincode}`].filter(Boolean).map(esc).join('<br>');
}

function stateWithCode(state: string | null): string {
  if (!state) return '—';
  const code = gstStateCode(state);
  return code ? `${esc(state)} (${esc(code)})` : esc(state);
}

/**
 * The invoice as an A4 page (M3.23), laid out for GST rule 46: supplier name, address and GSTIN; a number of
 * at most 16 characters and the date; recipient name, address and GSTIN (or "unregistered"); place of supply
 * with its state code; per line the description, SAC, value, discount, taxable value, rate and CGST + SGST or
 * IGST; government fees as their own lines outside GST; the total in figures and words; reverse charge "No";
 * and the supplier's authorised signatory. Without a seller GSTIN it is titled "Invoice", not "Tax Invoice".
 *
 * A credit note (M4.13, `inv.creditNote`) is the same page titled "Credit Note", with its own number and date,
 * the original invoice's number and date (rule 53), the refund and its reason in place of the payment.
 */
/** One row of the lines table: a service with its GST split, or a government fee passed on at cost. */
function lineRowHtml(l: InvoicePrint['lines'][number], i: number, igst: boolean, anyDiscount: boolean): string {
  if (l.kind === 'GOVERNMENT_FEE') {
    return `<tr class="govt">
  <td class="n">${i + 1}</td>
  <td>${esc(l.description)}<div class="note">Paid to the government on your behalf, at cost — not subject to GST</div></td>
  <td></td>
  <td class="r">${amount(l.total)}</td>${anyDiscount ? '<td class="r">—</td>' : ''}
  <td class="r">—</td>
  ${igst ? '<td class="r" colspan="2">—</td>' : '<td class="r" colspan="4">—</td>'}
  <td class="r">${amount(l.total)}</td>
</tr>`;
  }
  const half = l.gstRate / 2;
  const discount = l.discount ? `−${amount(l.discount)}` : '—';
  const discountCell = anyDiscount ? `<td class="r">${discount}</td>` : '';
  const taxCells = igst
    ? `<td class="r rate">${esc(l.gstRate)}%</td><td class="r">${amount(l.igst)}</td>`
    : `<td class="r rate">${esc(half)}%</td><td class="r">${amount(l.cgst)}</td><td class="r rate">${esc(half)}%</td><td class="r">${amount(l.sgst)}</td>`;
  return `<tr>
  <td class="n">${i + 1}</td>
  <td>${esc(l.description)}</td>
  <td>${esc(l.sacCode ?? '')}</td>
  <td class="r">${amount(l.professionalFee)}</td>${discountCell}
  <td class="r">${amount(l.taxableValue)}</td>
  ${taxCells}
  <td class="r">${amount(l.total)}</td>
</tr>`;
}

function sellerHtml(s: InvoicePrint['seller'], sellerName: string): string {
  return `  <div>
    <h1>${esc(s.name || sellerName)}</h1>
    ${s.legalName && s.legalName !== s.name ? `<div>${esc(s.legalName)}</div>` : ''}
    <div class="muted">${address(s.address)}</div>
    <div>${s.gstin ? `GSTIN <strong class="mono">${esc(s.gstin)}</strong>` : '<span class="muted">Not registered under GST</span>'}</div>
    <div class="muted">${[s.email, s.phone].filter(Boolean).map(esc).join(' · ')}</div>
  </div>`;
}

function buyerHtml(b: InvoicePrint['buyer']): string {
  return `  <div class="party">
    <h2>Billed to</h2>
    <div class="name">${esc(b.name)}</div>
    ${b.address ? `<div>${address(b.address)}</div>` : ''}
    <div>${b.gstin ? `GSTIN <strong class="mono">${esc(b.gstin)}</strong>` : '<span class="muted">Unregistered (no GSTIN)</span>'}</div>
    ${b.state ? `<div>State: ${stateWithCode(b.state)}</div>` : ''}
    <div class="muted">${[b.email, b.mobile].filter(Boolean).map(esc).join(' · ')}</div>
  </div>`;
}

function paymentHtml(inv: InvoicePrint): string {
  const cn = inv.creditNote;
  const paid = [
    inv.payment.method ? esc(METHOD[inv.payment.method] ?? inv.payment.method) : '',
    inv.payment.paidAt ? `on ${esc(formatDate(inv.payment.paidAt))}` : '',
    inv.payment.reference ? `· ref. <span class="mono">${esc(inv.payment.reference)}</span>` : '',
  ]
    .filter(Boolean)
    .join(' ');
  const paidPrefix = cn ? 'Original payment: ' : '';
  return `  <div class="party">
    <h2>${cn ? 'Refund' : 'Payment'}</h2>
    <div class="name">${money(inv.total)} ${cn ? 'refunded' : 'received'}</div>
    ${cn ? `<div>Reason: ${esc(cn.reason)}</div>` : ''}
    ${paid ? `<div>${paidPrefix}${paid}</div>` : ''}
    <div class="muted">${inv.taxType === 'IGST' ? 'Inter-state supply: IGST' : 'Intra-state supply: CGST + SGST'}</div>
  </div>`;
}

function linesHeadHtml(igst: boolean, anyDiscount: boolean): string {
  return `    <tr>
      <th rowspan="2">#</th>
      <th rowspan="2">Description</th>
      <th rowspan="2">SAC</th>
      <th rowspan="2" class="r">Fee (₹)</th>${anyDiscount ? '<th rowspan="2" class="r">Discount (₹)</th>' : ''}
      <th rowspan="2" class="r">Taxable value (₹)</th>
      ${igst ? '<th colspan="2" class="r">IGST</th>' : '<th colspan="2" class="r">CGST</th><th colspan="2" class="r">SGST</th>'}
      <th rowspan="2" class="r">Amount (₹)</th>
    </tr>
    <tr>${igst ? '<th class="r">Rate</th><th class="r">₹</th>' : '<th class="r">Rate</th><th class="r">₹</th><th class="r">Rate</th><th class="r">₹</th>'}</tr>`;
}

export function invoiceHtml(inv: InvoicePrint): string {
  const s = inv.seller;
  const igst = inv.taxType === 'IGST';
  const service = inv.lines.filter((l) => l.kind === 'SERVICE');
  const anyDiscount = service.some((l) => l.discount > 0);
  const taxCols = igst ? 2 : 4;
  const cols = 5 + (anyDiscount ? 1 : 0) + taxCols;
  const sellerName = s.legalName || s.name || '';
  const cn = inv.creditNote;
  let title = s.gstin ? 'Tax Invoice' : 'Invoice';
  if (cn) title = 'Credit Note';
  const doc = cn ? 'Credit note' : 'Invoice';

  const rows = inv.lines.map((l, i) => lineRowHtml(l, i, igst, anyDiscount)).join('\n');

  const totals = [
    ['Taxable value', money(inv.taxableValue)],
    ...(igst ? [['IGST', money(inv.igst)]] : [['CGST', money(inv.cgst)], ['SGST', money(inv.sgst)]]),
    ...(inv.govtFees ? [['Government fees (outside GST)', money(inv.govtFees)]] : []),
  ]
    .map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`)
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(title)} ${esc(inv.number)}</title>
<style>
${fonts()}
@page { size: A4; margin: 14mm 12mm 16mm; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; font-family: 'Noto Sans', sans-serif; font-size: 9pt; line-height: 1.45; color: #1b1f24; }
h1 { font-size: 15pt; margin: 0; letter-spacing: -0.01em; }
h2 { font-size: 7.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #5b6470; margin: 0 0 4px; }
.muted { color: #5b6470; }
.mono { font-variant-numeric: tabular-nums; }
header { display: flex; justify-content: space-between; gap: 24px; padding-bottom: 12px; border-bottom: 2px solid #1b1f24; }
.doc { text-align: right; }
.doc .title { font-size: 16pt; font-weight: 700; letter-spacing: 0.02em; text-transform: uppercase; }
.doc .copy { font-size: 7.5pt; color: #5b6470; margin-bottom: 8px; }
.meta { border-collapse: collapse; margin-left: auto; }
.meta th { text-align: left; font-weight: 400; color: #5b6470; padding: 1px 10px 1px 0; }
.meta td { text-align: right; font-weight: 700; padding: 1px 0; font-variant-numeric: tabular-nums; }
.parties { display: flex; gap: 16px; margin: 14px 0; }
.party { flex: 1; border: 1px solid #d5d9de; border-radius: 4px; padding: 10px 12px; }
.party .name { font-weight: 700; font-size: 10pt; }
table.lines { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
.lines th { background: #eef0f3; font-size: 7.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #3a414a; padding: 6px 5px; border-bottom: 1px solid #c3c8ce; text-align: left; vertical-align: bottom; }
.lines td { padding: 7px 5px; border-bottom: 1px solid #e3e6ea; vertical-align: top; }
.lines .r { text-align: right; white-space: nowrap; }
.lines .n { width: 18px; color: #5b6470; }
.lines .rate { color: #5b6470; }
.lines tr { page-break-inside: avoid; }
.note { font-size: 7.5pt; color: #5b6470; }
.summary { display: flex; justify-content: space-between; gap: 24px; margin-top: 12px; page-break-inside: avoid; }
.words { flex: 1; }
.words p { margin: 0 0 8px; }
table.totals { border-collapse: collapse; min-width: 240px; font-variant-numeric: tabular-nums; }
.totals th { text-align: left; font-weight: 400; color: #3a414a; padding: 3px 12px 3px 0; }
.totals td { text-align: right; padding: 3px 0; white-space: nowrap; }
.totals tr.grand th, .totals tr.grand td { font-weight: 700; font-size: 11pt; border-top: 2px solid #1b1f24; padding-top: 6px; color: #1b1f24; }
footer { display: flex; justify-content: space-between; align-items: flex-end; gap: 24px; margin-top: 28px; padding-top: 10px; border-top: 1px solid #d5d9de; page-break-inside: avoid; }
.sign { text-align: right; min-width: 200px; }
.sign .for { font-weight: 700; margin-bottom: 30px; }
.sign .line { border-top: 1px solid #1b1f24; padding-top: 3px; }
</style>
</head>
<body>
<header>
${sellerHtml(s, sellerName)}
  <div class="doc">
    <div class="title">${esc(title)}</div>
    <div class="copy">Original for recipient</div>
    <table class="meta">
      <tr><th>${doc} no.</th><td>${esc(inv.number)}</td></tr>
      <tr><th>${doc} date</th><td>${esc(formatDate(inv.issuedAt))}</td></tr>${
        cn
          ? `
      <tr><th>Against invoice</th><td>${esc(cn.invoiceNumber)}</td></tr>
      <tr><th>Invoice date</th><td>${esc(formatDate(cn.invoiceDate))}</td></tr>`
          : ''
      }
      <tr><th>Order</th><td>${esc(inv.orderCode)}</td></tr>
      <tr><th>Place of supply</th><td>${stateWithCode(inv.placeOfSupply)}</td></tr>
      <tr><th>Reverse charge</th><td>No</td></tr>
    </table>
  </div>
</header>

<section class="parties">
${buyerHtml(inv.buyer)}
${paymentHtml(inv)}
</section>

<table class="lines">
  <thead>
${linesHeadHtml(igst, anyDiscount)}
  </thead>
  <tbody>
${rows || `<tr><td colspan="${cols}">—</td></tr>`}
  </tbody>
</table>

<section class="summary">
  <div class="words">
    <h2>Amount in words</h2>
    <p><strong>${esc(inv.amountInWords)}</strong></p>
    ${inv.discount ? `<p class="muted">Includes a discount of ${money(inv.discount)} on professional fees.</p>` : ''}
  </div>
  <table class="totals">
    ${totals}
    <tr class="grand"><th>${cn ? 'Total credited' : 'Total'}</th><td>${money(inv.total)}</td></tr>
  </table>
</section>

<footer>
  <div class="note">
    This is a computer-generated ${cn ? 'credit note' : 'invoice'}.<br>
    Tax is not payable on reverse charge basis.
  </div>
  <div class="sign">
    <div class="for">For ${esc(sellerName)}</div>
    <div class="line">Authorised signatory</div>
  </div>
</footer>
</body>
</html>`;
}
