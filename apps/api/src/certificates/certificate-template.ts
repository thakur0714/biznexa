import { readFileSync } from 'node:fs';
import { formatDate } from '@biznexa/types';

export interface CertificatePrint {
  certificateNumber: string;
  verificationId: string;
  type: string;
  organizationName: string;
  scope: string | null;
  address: string | null;
  issueDate: Date;
  validFrom: Date;
  validUntil: Date;
  status: string;
  certificationBody: {
    name: string;
    accreditation: string | null;
    website: string | null;
    logoUrl?: string | null;
  };
  qrDataUrl: string;
  qrUrl: string;
}

export function esc(value: string | number | null | undefined): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

let fontFaces: string | null = null;

function fonts(): string {
  if (fontFaces) return fontFaces;
  const face = (subset: string, weight: number, range: string) => {
    const file = require.resolve(`@fontsource/noto-sans/files/noto-sans-${subset}-${weight}-normal.woff2`);
    const data = readFileSync(file).toString('base64');
    return `@font-face{font-family:'Noto Sans';font-weight:${weight};font-style:normal;src:url(data:font/woff2;base64,${data}) format('woff2');unicode-range:${range}}`;
  };
  const LATIN = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
  const LATIN_EXT = 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';
  fontFaces = [400, 600, 700].flatMap((w) => [face('latin', w, LATIN), face('latin-ext', w, LATIN_EXT)]).join('\n');
  return fontFaces;
}

export function certificateHtml(c: CertificatePrint): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Certificate ${esc(c.certificateNumber)}</title>
<style>
${fonts()}
@page {
  size: A4 landscape;
  margin: 0;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body {
  width: 297mm;
  height: 210mm;
  font-family: 'Noto Sans', sans-serif;
  color: #0f172a;
  background: #fdfcf9;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.page {
  width: 297mm;
  height: 210mm;
  padding: 10mm;
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: hidden;
}
.outer-border {
  width: 100%;
  height: 100%;
  border: 4px solid #1e293b;
  padding: 4mm;
  position: relative;
  background: #ffffff;
}
.inner-border {
  width: 100%;
  height: 100%;
  border: 1.5px solid #c59b27;
  padding: 6mm 10mm;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  text-align: center;
  position: relative;
}
.corner {
  position: absolute;
  width: 22px;
  height: 22px;
  border-color: #c59b27;
}
.corner-tl { top: -2px; left: -2px; border-top: 4px solid #c59b27; border-left: 4px solid #c59b27; }
.corner-tr { top: -2px; right: -2px; border-top: 4px solid #c59b27; border-right: 4px solid #c59b27; }
.corner-bl { bottom: -2px; left: -2px; border-bottom: 4px solid #c59b27; border-left: 4px solid #c59b27; }
.corner-br { bottom: -2px; right: -2px; border-bottom: 4px solid #c59b27; border-right: 4px solid #c59b27; }

.header {
  margin-top: 2mm;
}
.body-name {
  font-size: 13pt;
  font-weight: 700;
  letter-spacing: 2px;
  text-transform: uppercase;
  color: #334155;
}
.body-accreditation {
  font-size: 9pt;
  color: #64748b;
  margin-top: 1mm;
  letter-spacing: 0.5px;
}
.title-section {
  margin-top: 4mm;
}
.cert-title {
  font-size: 24pt;
  font-weight: 700;
  letter-spacing: 3px;
  text-transform: uppercase;
  color: #0f172a;
}
.cert-subtitle {
  font-size: 10.5pt;
  color: #64748b;
  margin-top: 2mm;
  font-style: italic;
}
.recipient {
  margin: 3mm 0;
}
.org-name {
  font-size: 20pt;
  font-weight: 700;
  color: #0f172a;
  letter-spacing: 0.5px;
  border-bottom: 2px solid #c59b27;
  display: inline-block;
  padding: 0 10mm 1.5mm 10mm;
  max-width: 90%;
}
.org-address {
  font-size: 9pt;
  color: #475569;
  margin-top: 1.5mm;
}
.statement {
  font-size: 10pt;
  color: #475569;
  margin-top: 2mm;
}
.standard {
  font-size: 15pt;
  font-weight: 700;
  color: #92400e;
  letter-spacing: 1px;
  margin-top: 1.5mm;
}
.scope {
  font-size: 9.5pt;
  color: #334155;
  margin-top: 1.5mm;
  max-width: 80%;
  margin-left: auto;
  margin-right: auto;
  line-height: 1.4;
}

.footer-grid {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  text-align: left;
  border-top: 1px solid #e2e8f0;
  padding-top: 3mm;
  margin-top: 3mm;
}
.meta-col {
  flex: 1;
  font-size: 8pt;
  color: #334155;
  line-height: 1.5;
}
.meta-col dt {
  color: #64748b;
  font-weight: 600;
  display: inline-block;
  min-width: 32mm;
}
.meta-col dd {
  display: inline-block;
  font-weight: 700;
  color: #0f172a;
}
.seal-col {
  flex: 0 0 50mm;
  text-align: center;
}
.seal-svg {
  width: 44mm;
  height: 44mm;
}
.qr-col {
  flex: 0 0 55mm;
  text-align: right;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}
.qr-img {
  width: 25mm;
  height: 25mm;
  border: 1px solid #e2e8f0;
  padding: 1mm;
  background: #ffffff;
}
.qr-caption {
  font-size: 7pt;
  color: #64748b;
  margin-top: 1mm;
  max-width: 35mm;
  line-height: 1.3;
  text-align: center;
}
.signatory {
  margin-top: 2mm;
  text-align: center;
  border-top: 1px solid #94a3b8;
  padding-top: 1mm;
  min-width: 35mm;
  font-size: 8pt;
  font-weight: 600;
  color: #334155;
}
.bottom-note {
  font-size: 6.5pt;
  color: #94a3b8;
  text-align: center;
  margin-top: 2mm;
  letter-spacing: 0.2px;
}
</style>
</head>
<body>
<div class="page">
  <div class="outer-border">
    <div class="inner-border">
      <div class="corner corner-tl"></div>
      <div class="corner corner-tr"></div>
      <div class="corner corner-bl"></div>
      <div class="corner corner-br"></div>

      <div class="header">
        <div class="body-name">${esc(c.certificationBody.name)}</div>
        ${c.certificationBody.accreditation ? `<div class="body-accreditation">${esc(c.certificationBody.accreditation)}</div>` : ''}
      </div>

      <div class="title-section">
        <h1 class="cert-title">Certificate of Registration</h1>
        <p class="cert-subtitle">This is to certify that the management system of</p>
      </div>

      <div class="recipient">
        <div class="org-name">${esc(c.organizationName)}</div>
        ${c.address ? `<div class="org-address">${esc(c.address)}</div>` : ''}
      </div>

      <div>
        <p class="statement">has been independently assessed and found to comply with the standard:</p>
        <div class="standard">${esc(c.type)}</div>
        ${c.scope ? `<p class="scope"><strong>Scope:</strong> ${esc(c.scope)}</p>` : ''}
      </div>

      <div class="footer-grid">
        <div class="meta-col">
          <dl>
            <div><dt>Certificate No:</dt><dd>${esc(c.certificateNumber)}</dd></div>
            <div><dt>Verification ID:</dt><dd>${esc(c.verificationId)}</dd></div>
            <div><dt>Date of Issue:</dt><dd>${esc(formatDate(c.issueDate))}</dd></div>
            <div><dt>Valid From:</dt><dd>${esc(formatDate(c.validFrom))}</dd></div>
            <div><dt>Valid Until:</dt><dd>${esc(formatDate(c.validUntil))}</dd></div>
            <div><dt>Status:</dt><dd>${esc(c.status)}</dd></div>
          </dl>
        </div>

        <div class="seal-col">
          <svg class="seal-svg" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="46" fill="none" stroke="#c59b27" stroke-width="2" stroke-dasharray="3 2"/>
            <circle cx="50" cy="50" r="41" fill="none" stroke="#c59b27" stroke-width="1"/>
            <circle cx="50" cy="50" r="34" fill="#faf5eb" stroke="#c59b27" stroke-width="1.5"/>
            <path d="M 50 20 L 53 29 L 62 29 L 55 35 L 57 44 L 50 39 L 43 44 L 45 35 L 38 29 L 47 29 Z" fill="#c59b27"/>
            <text x="50" y="55" font-family="'Noto Sans', sans-serif" font-size="6.5" font-weight="700" fill="#1e293b" text-anchor="middle" letter-spacing="1">AUTHENTIC</text>
            <text x="50" y="62" font-family="'Noto Sans', sans-serif" font-size="4.5" font-weight="600" fill="#92400e" text-anchor="middle" letter-spacing="0.5">BIZNEXA VERIFIED</text>
            <path d="M 38 68 C 45 71, 55 71, 62 68" fill="none" stroke="#c59b27" stroke-width="1"/>
          </svg>
        </div>

        <div class="qr-col">
          <img class="qr-img" src="${c.qrDataUrl}" alt="Verification QR" />
          <div class="qr-caption">Scan to verify online at biznexa.com/verify</div>
          <div class="signatory">Authorized Signatory</div>
        </div>
      </div>

      <div class="bottom-note">
        This certificate remains the property of ${esc(c.certificationBody.name)}. Real-time verification is available at ${esc(c.qrUrl)}
      </div>
    </div>
  </div>
</div>
</body>
</html>`;
}
