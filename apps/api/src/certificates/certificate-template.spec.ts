import { certificateHtml, esc, type CertificatePrint } from './certificate-template';

describe('certificate template (M7.3)', () => {
  const sampleCert: CertificatePrint = {
    certificateNumber: 'BNC-2026-000042',
    verificationId: 'ABCDEF234567',
    type: 'ISO 9001:2015 — Quality Management System',
    organizationName: 'Acme Technologies & Consulting Ltd.',
    scope: 'Design, development and deployment of cloud solutions',
    address: 'Plot 42, Electronic City, Bengaluru, Karnataka 560100',
    issueDate: new Date('2026-01-15T00:00:00Z'),
    validFrom: new Date('2026-01-15T00:00:00Z'),
    validUntil: new Date('2029-01-14T00:00:00Z'),
    status: 'ACTIVE',
    certificationBody: {
      name: 'Global Accreditation Board',
      accreditation: 'NABCB / IAF Accredited',
      website: 'https://example.com/gab',
    },
    qrUrl: 'https://biznexa.com/verify/ABCDEF234567?t=1234567890abcdef',
    qrDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  };

  it('escapes special characters to prevent HTML injection and SSRF', () => {
    expect(esc('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    expect(esc("O'Connor & Sons")).toBe('O&#39;Connor &amp; Sons');
    expect(esc(null)).toBe('');
    expect(esc(undefined)).toBe('');
  });

  it('renders a self-contained HTML document with all certificate details', () => {
    const html = certificateHtml(sampleCert);
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('BNC-2026-000042');
    expect(html).toContain('ABCDEF234567');
    expect(html).toContain('Acme Technologies &amp; Consulting Ltd.');
    expect(html).toContain('ISO 9001:2015 — Quality Management System');
    expect(html).toContain('Design, development and deployment of cloud solutions');
    expect(html).toContain('Plot 42, Electronic City');
    expect(html).toContain('Global Accreditation Board');
    expect(html).toContain('NABCB / IAF Accredited');
    expect(html).toContain(sampleCert.qrDataUrl);
    expect(html).toContain('size: A4 landscape');
    expect(html).toContain('@font-face');
  });

  it('handles optional fields (scope, address) when null', () => {
    const minCert: CertificatePrint = {
      ...sampleCert,
      scope: null,
      address: null,
      certificationBody: {
        name: 'Simple Certifiers',
        accreditation: null,
        website: null,
      },
    };
    const html = certificateHtml(minCert);
    expect(html).not.toContain('null');
    expect(html).not.toContain('undefined');
    expect(html).toContain('Simple Certifiers');
    expect(html).toContain('Certificate of Registration');
  });
});
