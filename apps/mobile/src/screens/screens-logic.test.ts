import { describe, it, expect } from 'vitest';
import {
  formatINR,
  formatDate,
  formatDateTime,
  customerNextAction,
  describeFileTypes,
  isKnownFileType,
  type FileMimeType,
} from '@biznexa/types';
import { canChangeBooking, getJoinLink } from './consultation-logic';

describe('Screen formatting and logic', () => {
  it('formats Indian rupee amounts with appropriate grouping', () => {
    expect(formatINR(12500000)).toMatch(/1,25,000/);
    expect(formatINR(50000)).toMatch(/500/);
    expect(formatINR(999900)).toMatch(/9,999/);
  });

  it('formats dates in DD-MMM-YYYY format in IST', () => {
    // 2026-10-18T10:00:00.000Z is 2026-10-18T15:30:00.000+05:30
    const formatted = formatDate('2026-10-18T10:00:00.000Z');
    expect(formatted).toBe('18-Oct-2026');
  });

  it('formats date and time in DD-MMM-YYYY, HH:mm:ss in IST', () => {
    const formatted = formatDateTime('2026-10-18T10:00:00.000Z');
    expect(formatted).toContain('18-Oct-2026');
    expect(formatted).toContain('15:30:00');
  });

  it('determines the next action for customer applications correctly', () => {
    // Completed status should suggest downloading certificate/deliverable
    expect(
      customerNextAction({
        status: 'COMPLETED',
        pendingMandatory: 0,
        orderBalance: 0,
      })
    ).toBe('download');

    // Documents pending status or canUploadDocuments with pendingMandatory
    expect(
      customerNextAction({
        status: 'DOCUMENTS_PENDING',
        pendingMandatory: 1,
        orderBalance: 0,
      })
    ).toBe('upload_documents');

    // Payment pending or order balance > 0
    expect(
      customerNextAction({
        status: 'SUBMITTED',
        pendingMandatory: 0,
        orderBalance: 50000,
      })
    ).toBe('pay_balance');

    // Otherwise view
    expect(
      customerNextAction({
        status: 'IN_PROGRESS',
        pendingMandatory: 0,
        orderBalance: 0,
      })
    ).toBe('view');
  });

  it('correctly describes and validates accepted file types', () => {
    const types: FileMimeType[] = ['application/pdf', 'image/jpeg', 'image/png'];
    expect(describeFileTypes(types)).toBe('PDF, JPG or PNG');
    expect(isKnownFileType('application/pdf')).toBe(true);
    expect(isKnownFileType('text/html')).toBe(false);
  });

  it('parses certificate numbers from QR code contents', () => {
    const parseQr = (data: string) => {
      let certNumber = data.trim();
      if (data.includes('number=')) {
        const match = data.match(/number=([^&]+)/);
        if (match && match[1]) {
          certNumber = decodeURIComponent(match[1]);
        }
      } else if (data.includes('/verify/')) {
        const parts = data.split('/verify/');
        if (parts[1]) {
          certNumber = decodeURIComponent(parts[1].split('?')[0]);
        }
      }
      return certNumber;
    };

    expect(parseQr('BN-ISO-9001-2026')).toBe('BN-ISO-9001-2026');
    expect(parseQr('https://biznexa.in/verify?number=BN-ISO-001&t=sig')).toBe('BN-ISO-001');
    expect(parseQr('https://biznexa.in/verify/CERT-999?t=abc')).toBe('CERT-999');
  });

  it('shows booking actions only while confirmed; server enforces the configured window', () => {
    expect(canChangeBooking({ status: 'CONFIRMED' })).toBe(true);
    expect(canChangeBooking({ status: 'CANCELLED' })).toBe(false);
    expect(getJoinLink({ status: 'CONFIRMED', meetingLink: 'https://meet.example/session' })).toBe('https://meet.example/session');
    expect(getJoinLink({ status: 'PENDING_PAYMENT', meetingLink: 'https://meet.example/session' })).toBeNull();
  });
});
