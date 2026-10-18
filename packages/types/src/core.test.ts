import { describe, expect, it } from 'vitest';
import {
  calculatePrice,
  couponDiscount,
  canTransition,
  assertTransition,
  effectiveCertificateStatus,
  formatINR,
  formatDate,
  formatDateTime,
  istDay,
  financialYear,
  registerSchema,
  updateProfileSchema,
  changePasswordSchema,
} from './index';

describe('calculatePrice', () => {
  it('uses CGST + SGST when seller and buyer are in the same state', () => {
    const p = calculatePrice({ professionalFee: 100000, governmentFee: 450000, gstRate: 18, sellerState: 'PB', buyerState: 'pb' });
    expect(p.taxType).toBe('CGST_SGST');
    expect(p.cgst).toBe(9000);
    expect(p.sgst).toBe(9000);
    expect(p.igst).toBe(0);
    expect(p.total).toBe(100000 + 18000 + 450000);
  });

  it('uses IGST for inter-state or unknown buyer state', () => {
    expect(calculatePrice({ professionalFee: 100000, governmentFee: 0, gstRate: 18, sellerState: 'PB', buyerState: 'MH' }).igst).toBe(18000);
    expect(calculatePrice({ professionalFee: 100000, governmentFee: 0, gstRate: 18, sellerState: 'PB' }).taxType).toBe('IGST');
  });

  it('does not tax government fees and applies discount before GST', () => {
    const p = calculatePrice({ professionalFee: 100000, governmentFee: 50000, gstRate: 18, discount: 20000 });
    expect(p.taxableValue).toBe(80000);
    expect(p.totalTax).toBe(14400);
    expect(p.total).toBe(80000 + 14400 + 50000);
  });

  it('splits odd tax amounts without losing a paisa', () => {
    const p = calculatePrice({ professionalFee: 99, governmentFee: 0, gstRate: 18, sellerState: 'PB', buyerState: 'PB' });
    expect(p.cgst + p.sgst).toBe(p.totalTax);
  });

  it('caps discount at the professional fee and rejects bad input', () => {
    expect(calculatePrice({ professionalFee: 1000, governmentFee: 0, gstRate: 18, discount: 5000 }).taxableValue).toBe(0);
    expect(() => calculatePrice({ professionalFee: -1, governmentFee: 0, gstRate: 18 })).toThrow();
    expect(() => calculatePrice({ professionalFee: 1, governmentFee: 0, gstRate: 50 })).toThrow();
  });
});

describe('couponDiscount', () => {
  it('applies percentage with cap', () => {
    expect(couponDiscount(1000000, { type: 'PERCENTAGE', value: 10, maxDiscount: 50000 })).toBe(50000);
    expect(couponDiscount(100000, { type: 'PERCENTAGE', value: 10 })).toBe(10000);
  });
  it('applies fixed discount and min order value', () => {
    expect(couponDiscount(100000, { type: 'FIXED', value: 20000 })).toBe(20000);
    expect(couponDiscount(100000, { type: 'FIXED', value: 20000, minOrderValue: 200000 })).toBe(0);
    expect(couponDiscount(10000, { type: 'FIXED', value: 20000 })).toBe(10000);
  });
});

describe('state machines', () => {

  describe('document state machine', () => {
    it('allows REQUIRED to UPLOADED', () => {
      expect(canTransition('document', 'REQUIRED', 'UPLOADED')).toBe(true);
    });
    it('allows UPLOADED to UNDER_REVIEW, UPLOADED, APPROVED, REJECTED', () => {
      expect(canTransition('document', 'UPLOADED', 'UNDER_REVIEW')).toBe(true);
      expect(canTransition('document', 'UPLOADED', 'UPLOADED')).toBe(true);
      expect(canTransition('document', 'UPLOADED', 'APPROVED')).toBe(true);
      expect(canTransition('document', 'UPLOADED', 'REJECTED')).toBe(true);
    });
    it('allows UNDER_REVIEW to APPROVED, REJECTED', () => {
      expect(canTransition('document', 'UNDER_REVIEW', 'APPROVED')).toBe(true);
      expect(canTransition('document', 'UNDER_REVIEW', 'REJECTED')).toBe(true);
    });
    it('does not allow UNDER_REVIEW to REQUIRED or UPLOADED', () => {
      expect(canTransition('document', 'UNDER_REVIEW', 'REQUIRED')).toBe(false);
      expect(canTransition('document', 'UNDER_REVIEW', 'UPLOADED')).toBe(false);
    });
    it('does not allow APPROVED to anything', () => {
      expect(canTransition('document', 'APPROVED', 'REQUIRED')).toBe(false);
      expect(canTransition('document', 'APPROVED', 'UPLOADED')).toBe(false);
      expect(canTransition('document', 'APPROVED', 'UNDER_REVIEW')).toBe(false);
      expect(canTransition('document', 'APPROVED', 'REJECTED')).toBe(false);
    });
    it('allows REJECTED to UPLOADED only', () => {
      expect(canTransition('document', 'REJECTED', 'UPLOADED')).toBe(true);
      expect(canTransition('document', 'REJECTED', 'REQUIRED')).toBe(false);
      expect(canTransition('document', 'REJECTED', 'UNDER_REVIEW')).toBe(false);
      expect(canTransition('document', 'REJECTED', 'APPROVED')).toBe(false);
    });
  });

  it('allows valid application transitions only', () => {
    expect(canTransition('application', 'SUBMITTED', 'DOCUMENTS_UNDER_REVIEW')).toBe(true);
    expect(canTransition('application', 'DOCUMENTS_PENDING', 'DOCUMENTS_UNDER_REVIEW')).toBe(true);
    expect(canTransition('application', 'DRAFT', 'COMPLETED')).toBe(false);
    expect(canTransition('application', 'DELIVERED', 'CANCELLED')).toBe(false);
    expect(() => assertTransition('application', 'CANCELLED', 'IN_PROGRESS')).toThrow(/Invalid application/);
  });

  it('allows booking lifecycle actions and keeps terminal states closed', () => {
    expect(canTransition('booking', 'CONFIRMED', 'RESCHEDULED')).toBe(true);
    expect(canTransition('booking', 'CONFIRMED', 'CANCELLED')).toBe(true);
    expect(canTransition('booking', 'CONFIRMED', 'COMPLETED')).toBe(true);
    expect(canTransition('booking', 'CONFIRMED', 'NO_SHOW')).toBe(true);
    expect(canTransition('booking', 'RESCHEDULED', 'CONFIRMED')).toBe(true);
    expect(canTransition('booking', 'CANCELLED', 'CONFIRMED')).toBe(false);
    expect(canTransition('booking', 'COMPLETED', 'NO_SHOW')).toBe(false);
    expect(canTransition('booking', 'NO_SHOW', 'COMPLETED')).toBe(false);
  });
  it('requires re-upload after rejection', () => {
    expect(canTransition('document', 'REJECTED', 'UPLOADED')).toBe(true);
    expect(canTransition('document', 'REJECTED', 'APPROVED')).toBe(false);
  });
  it('treats withdrawn certificates as final', () => {
    expect(canTransition('certificate', 'SUSPENDED', 'ACTIVE')).toBe(true);
    expect(canTransition('certificate', 'WITHDRAWN', 'ACTIVE')).toBe(false);
  });
  it('reports expired certificates even before the nightly job', () => {
    const now = new Date('2026-10-09T00:00:00Z');
    expect(effectiveCertificateStatus('ACTIVE', '2026-01-01', now)).toBe('EXPIRED');
    expect(effectiveCertificateStatus('ACTIVE', '2027-01-01', now)).toBe('ACTIVE');
    expect(effectiveCertificateStatus('WITHDRAWN', '2026-01-01', now)).toBe('WITHDRAWN');
  });
});

describe('formatting', () => {
  it('formats rupees with Indian grouping', () => {
    expect(formatINR(12500000)).toBe('₹1,25,000');
  });
  it('formats dates as DD-MMM-YYYY in IST', () => {
    expect(formatDate('2026-10-08T20:00:00Z')).toBe('09-Oct-2026');
    expect(formatDateTime('2026-10-08T20:05:09Z')).toBe('09-Oct-2026, 01:35:09');
    expect(istDay('2026-10-08T18:30:00Z')).toBe('2026-10-09'); // 00:00 IST is the next day
    expect(istDay('2026-10-08T18:29:59Z')).toBe('2026-10-08');
  });
  it('computes the Indian financial year', () => {
    expect(financialYear(new Date('2026-10-09T00:00:00Z'))).toBe('2026-27');
    expect(financialYear(new Date('2027-02-01T00:00:00Z'))).toBe('2026-27');
  });
});

describe('registerSchema', () => {
  it('validates Indian mobile and password rules', () => {
    const ok = registerSchema.safeParse({ name: 'Asha', mobile: '9876543210', email: 'a@b.com', password: 'secret123', consent: true });
    expect(ok.success).toBe(true);
    const bad = registerSchema.safeParse({ name: 'Asha', mobile: '1234567890', email: 'a@b.com', password: 'short', consent: true });
    expect(bad.success).toBe(false);
  });
});

describe('profile & password change schemas (M5.11)', () => {
  it('validates update profile input', () => {
    expect(updateProfileSchema.safeParse({ name: 'Rohit Sharma' }).success).toBe(true);
    expect(updateProfileSchema.safeParse({ email: 'rohit@example.com' }).success).toBe(true);
    expect(updateProfileSchema.safeParse({ name: 'Rohit Sharma', email: 'rohit@example.com' }).success).toBe(true);
    expect(updateProfileSchema.safeParse({}).success).toBe(false);
    expect(updateProfileSchema.safeParse({ name: 'R' }).success).toBe(false);
    expect(updateProfileSchema.safeParse({ email: 'not-an-email' }).success).toBe(false);
  });

  it('validates change password input with standard password rules', () => {
    expect(changePasswordSchema.safeParse({ currentPassword: 'oldPass123', newPassword: 'newSecretPass1' }).success).toBe(true);
    expect(changePasswordSchema.safeParse({ currentPassword: '', newPassword: 'newSecretPass1' }).success).toBe(false);
    expect(changePasswordSchema.safeParse({ currentPassword: 'oldPass123', newPassword: 'short' }).success).toBe(false);
    expect(changePasswordSchema.safeParse({ currentPassword: 'oldPass123', newPassword: 'letters_only' }).success).toBe(false);
    expect(changePasswordSchema.safeParse({ currentPassword: 'oldPass123', newPassword: '12345678' }).success).toBe(false);
  });
});

