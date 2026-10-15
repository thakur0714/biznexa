export interface RawCsvRow {
  rowNumber: number;
  data: Record<string, string>;
  rawValues: string[];
}

export function escapeCsvCell(val: string | number | null | undefined): string {
  if (val == null) return '""';
  let s = String(val);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let insideQuotes = false;

  const len = text.length;
  for (let i = 0; i < len; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (insideQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          currentCell += '"';
          i++;
        } else {
          insideQuotes = false;
        }
      } else {
        currentCell += char;
      }
    } else {
      if (char === '"') {
        insideQuotes = true;
      } else if (char === ',') {
        currentRow.push(currentCell.trim());
        currentCell = '';
      } else if (char === '\r') {
        if (nextChar === '\n') {
          i++;
        }
        currentRow.push(currentCell.trim());
        if (currentRow.some((c) => c !== '')) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentCell = '';
      } else if (char === '\n') {
        currentRow.push(currentCell.trim());
        if (currentRow.some((c) => c !== '')) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentCell = '';
      } else {
        currentCell += char;
      }
    }
  }

  if (currentCell !== '' || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    if (currentRow.some((c) => c !== '')) {
      rows.push(currentRow);
    }
  }

  return rows;
}

export function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const HEADER_MAP: Record<string, string[]> = {
  certificateNumber: ['certificatenumber', 'certificateno', 'certnumber', 'certno'],
  type: ['type', 'certificatetype', 'standard', 'certificatestandard'],
  organizationName: ['organizationname', 'organisationname', 'organization', 'organisation', 'companyname', 'company'],
  scope: ['scope', 'scopes'],
  address: ['address', 'location'],
  issueDate: ['issuedate', 'issue_date', 'dateofissue'],
  validFrom: ['validfrom', 'valid_from', 'startdate', 'start_date'],
  validUntil: ['validuntil', 'valid_until', 'expirydate', 'expiry_date', 'validto', 'valid_to', 'expiry'],
  certificationBody: ['certificationbody', 'certificationbodyid', 'certificationbodyname', 'body', 'certifyingbody', 'issuingbody'],
  showPdfPublicly: ['showpdfpublicly', 'allowpublicdownload', 'publicdownload', 'publicpdf', 'allowdownload'],
};

export function mapHeaders(headers: string[]): Record<string, number> {
  const mapping: Record<string, number> = {};
  headers.forEach((h, idx) => {
    const norm = normalizeHeader(h);
    for (const [key, aliases] of Object.entries(HEADER_MAP)) {
      if (aliases.includes(norm) && mapping[key] === undefined) {
        mapping[key] = idx;
        break;
      }
    }
  });
  return mapping;
}

export function parseCsvDate(str: string | undefined): Date | null {
  if (!str) return null;
  const trimmed = str.trim();
  const dmyMatch = trimmed.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10);
    const month = parseInt(dmyMatch[2], 10) - 1;
    const year = parseInt(dmyMatch[3], 10);
    const d = new Date(Date.UTC(year, month, day));
    if (!isNaN(d.getTime())) return d;
  }
  const d = new Date(trimmed);
  if (!isNaN(d.getTime())) return d;
  return null;
}

export function parseCsvBoolean(str: string | undefined): boolean {
  if (!str) return false;
  const s = str.trim().toLowerCase();
  return ['true', '1', 'yes', 'y', 't'].includes(s);
}

export const CSV_SAMPLE_TEMPLATE =
`Certificate Number,Certificate Type,Organization Name,Scope,Address,Issue Date,Valid From,Valid Until,Certification Body,Allow Public Download
,ISO 9001:2015,Acme Innovations Pvt Ltd,Design and manufacturing of industrial sensors,42 MIDC Phase II Mumbai 400093,2026-01-15,2026-01-15,2029-01-14,Bureau Veritas India,true
CERT-2026-0002,ISO 27001:2022,Initech Technologies,Information security management for cloud solutions,Level 5 Cyber Towers Hyderabad 500081,2026-02-01,2026-02-01,2029-01-31,TUV Rheinland India,false`;

export function generateCsvErrorReport(
  errors: { rowNumber: number; certificateNumber?: string; organizationName?: string; field?: string; message: string }[],
): string {
  const headers = ['Row Number', 'Certificate Number', 'Organisation', 'Field', 'Error Message'];
  const rows = errors.map((e) => [
    escapeCsvCell(e.rowNumber),
    escapeCsvCell(e.certificateNumber ?? ''),
    escapeCsvCell(e.organizationName ?? ''),
    escapeCsvCell(e.field ?? ''),
    escapeCsvCell(e.message),
  ]);
  return [headers.map(escapeCsvCell).join(','), ...rows.map((r) => r.join(','))].join('\r\n');
}
