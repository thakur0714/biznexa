import {
  escapeCsvCell,
  generateCsvErrorReport,
  mapHeaders,
  parseCsv,
  parseCsvBoolean,
  parseCsvDate,
} from './certificate-csv';

describe('certificate-csv utilities', () => {
  it('parses standard RFC 4180 CSV with quotes, commas, and CRLF', () => {
    const csv = 'Header1,Header2,"Header, 3"\r\nval1,"val 2 with, comma",val3\r\n"escaped ""quotes""",val5,val6\r\n';
    const rows = parseCsv(csv);
    expect(rows).toEqual([
      ['Header1', 'Header2', 'Header, 3'],
      ['val1', 'val 2 with, comma', 'val3'],
      ['escaped "quotes"', 'val5', 'val6'],
    ]);
  });

  it('maps various header aliases to standardized field keys', () => {
    const headers = [
      'Certificate No.',
      'Standard',
      'Organisation Name',
      'Scope',
      'Address',
      'Date of Issue',
      'Start Date',
      'Expiry Date',
      'Certifying Body',
      'Allow Public Download',
    ];
    const mapping = mapHeaders(headers);
    expect(mapping.certificateNumber).toBe(0);
    expect(mapping.type).toBe(1);
    expect(mapping.organizationName).toBe(2);
    expect(mapping.scope).toBe(3);
    expect(mapping.address).toBe(4);
    expect(mapping.issueDate).toBe(5);
    expect(mapping.validFrom).toBe(6);
    expect(mapping.validUntil).toBe(7);
    expect(mapping.certificationBody).toBe(8);
    expect(mapping.showPdfPublicly).toBe(9);
  });

  it('parses dates in ISO and DD-MM-YYYY formats', () => {
    const d1 = parseCsvDate('2026-05-15');
    expect(d1).not.toBeNull();
    expect(d1?.getUTCFullYear()).toBe(2026);
    expect(d1?.getUTCMonth()).toBe(4); // 0-indexed May
    expect(d1?.getUTCDate()).toBe(15);

    const d2 = parseCsvDate('15/05/2026');
    expect(d2).not.toBeNull();
    expect(d2?.getUTCFullYear()).toBe(2026);
    expect(d2?.getUTCMonth()).toBe(4);
    expect(d2?.getUTCDate()).toBe(15);

    expect(parseCsvDate('invalid-date')).toBeNull();
    expect(parseCsvDate('')).toBeNull();
  });

  it('parses boolean representations', () => {
    expect(parseCsvBoolean('true')).toBe(true);
    expect(parseCsvBoolean('True')).toBe(true);
    expect(parseCsvBoolean('1')).toBe(true);
    expect(parseCsvBoolean('yes')).toBe(true);
    expect(parseCsvBoolean('false')).toBe(false);
    expect(parseCsvBoolean('0')).toBe(false);
    expect(parseCsvBoolean('no')).toBe(false);
    expect(parseCsvBoolean('')).toBe(false);
  });

  it('escapes cells to prevent CSV formula injection', () => {
    expect(escapeCsvCell('=CMD("calc")')).toBe('"\'=CMD(""calc"")"');
    expect(escapeCsvCell('+12345')).toBe('"\' +12345"'.replace(' ', ''));
    expect(escapeCsvCell('-SUM(A1:A10)')).toBe('"\' -SUM(A1:A10)"'.replace(' ', ''));
    expect(escapeCsvCell('@EXEC()')).toBe('"\' @EXEC()"'.replace(' ', ''));
    expect(escapeCsvCell('Normal Text')).toBe('"Normal Text"');
  });

  it('generates downloadable error report CSV', () => {
    const errors = [
      { rowNumber: 2, certificateNumber: 'BNC-1', organizationName: 'Acme', field: 'type', message: 'Type is required' },
      { rowNumber: 3, organizationName: '=Initech', field: 'validUntil', message: 'Valid until must be after valid from' },
    ];
    const report = generateCsvErrorReport(errors);
    expect(report).toContain('"Row Number","Certificate Number","Organisation","Field","Error Message"');
    expect(report).toContain('"2","BNC-1","Acme","type","Type is required"');
    expect(report).toContain('\'=Initech');
  });
});
