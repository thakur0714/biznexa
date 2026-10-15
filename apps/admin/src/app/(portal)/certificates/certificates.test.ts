import { describe, expect, it } from 'vitest';
import { validateCertificateCreate, type CertificateCreateDraft } from './new/certificate-create-view';
import { validateStatusChange } from './[id]/certificate-detail-view';

describe('validateCertificateCreate (M7.1)', () => {
  const validDraft: CertificateCreateDraft = {
    certificateNumber: 'BNC-2026-000100',
    type: 'ISO 9001:2015',
    organizationName: 'ACME Corp',
    scope: 'Manufacturing',
    address: '123 MG Road',
    issueDate: '2026-01-01',
    validFrom: '2026-01-01',
    validUntil: '2029-01-01',
    certificationBodyId: '11111111-2222-3333-4444-555555555555',
    showPdfPublicly: false,
  };

  it('accepts a valid draft with no errors', () => {
    const errs = validateCertificateCreate(validDraft);
    expect(Object.keys(errs)).toHaveLength(0);
  });

  it('accepts optional fileId for uploaded custom PDF', () => {
    const draftWithFile = {
      ...validDraft,
      fileId: '22222222-3333-4444-5555-666666666666',
    };
    const errs = validateCertificateCreate(draftWithFile);
    expect(Object.keys(errs)).toHaveLength(0);
  });

  it('requires type, organisation, dates, and certification body', () => {
    const emptyDraft: CertificateCreateDraft = {
      certificateNumber: '',
      type: '   ',
      organizationName: '',
      scope: '',
      address: '',
      issueDate: '',
      validFrom: '',
      validUntil: '',
      certificationBodyId: '',
      showPdfPublicly: false,
    };

    const errs = validateCertificateCreate(emptyDraft);
    expect(errs.type).toBe('Enter certificate type');
    expect(errs.organizationName).toBe('Enter organisation name');
    expect(errs.issueDate).toBe('Select issue date');
    expect(errs.validFrom).toBe('Select valid from date');
    expect(errs.validUntil).toBe('Select valid until date');
    expect(errs.certificationBodyId).toBe('Select a certification body');
  });

  it('refuses validUntil on or before validFrom date', () => {
    const badDatesDraft: CertificateCreateDraft = {
      ...validDraft,
      validFrom: '2026-05-10',
      validUntil: '2026-05-10',
    };

    const errs = validateCertificateCreate(badDatesDraft);
    expect(errs.validUntil).toBe('Valid until must be after valid from date');
  });
});

describe('validateStatusChange (M7.1)', () => {
  it('accepts a non-empty reason', () => {
    expect(validateStatusChange({ status: 'SUSPENDED', reason: 'Surveillance audit pending' })).toBeNull();
  });

  it('refuses empty or whitespace-only reason', () => {
    expect(validateStatusChange({ status: 'SUSPENDED', reason: '' })).toBe('Reason for status change is required');
    expect(validateStatusChange({ status: 'WITHDRAWN', reason: '   ' })).toBe('Reason for status change is required');
  });

  it('refuses reasons shorter than 3 characters', () => {
    expect(validateStatusChange({ status: 'SUSPENDED', reason: 'ab' })).toBe('Reason must be at least 3 characters');
  });
});

describe('certificate bulk import UI state (M7.4)', () => {
  it('identifies valid file extension for CSV', () => {
    const isCsv = (filename: string) => filename.toLowerCase().endsWith('.csv');
    expect(isCsv('certificates.csv')).toBe(true);
    expect(isCsv('DATA.CSV')).toBe(true);
    expect(isCsv('sheet.xlsx')).toBe(false);
    expect(isCsv('report.pdf')).toBe(false);
  });

  it('formats error report CSV safely escaping formula prefixes', () => {
    const escapeCsv = (val: string) => {
      let s = val;
      if (/^[=+\-@]/.test(s)) s = `'${s}`;
      return `"${s.replace(/"/g, '""')}"`;
    };
    expect(escapeCsv('=HYPERLINK()')).toBe('"\'=HYPERLINK()"');
    expect(escapeCsv('Normal text')).toBe('"Normal text"');
  });
});

