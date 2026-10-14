import { describe, expect, it } from 'vitest';
import { APPLICATION_STATUSES, allowedNext, applicationTransitionSchema, assertTransition, canTransition, type ApplicationStatus } from './status';

/** The application state machine as agreed (§6). Changing status.ts without changing this list fails the test. */
const ALLOWED: Record<ApplicationStatus, ApplicationStatus[]> = {
  DRAFT: ['PAYMENT_PENDING', 'CANCELLED'],
  PAYMENT_PENDING: ['SUBMITTED', 'DRAFT', 'CANCELLED'],
  SUBMITTED: ['DOCUMENTS_UNDER_REVIEW', 'DOCUMENTS_PENDING', 'CANCELLED'],
  DOCUMENTS_UNDER_REVIEW: ['DOCUMENTS_PENDING', 'DOCUMENTS_APPROVED', 'CANCELLED'],
  DOCUMENTS_PENDING: ['DOCUMENTS_UNDER_REVIEW', 'CANCELLED'],
  DOCUMENTS_APPROVED: ['ASSIGNED', 'IN_PROGRESS', 'DOCUMENTS_PENDING', 'CANCELLED'],
  ASSIGNED: ['IN_PROGRESS', 'DOCUMENTS_PENDING', 'CANCELLED'],
  IN_PROGRESS: ['ON_HOLD', 'COMPLETED', 'DOCUMENTS_PENDING', 'CANCELLED'],
  ON_HOLD: ['IN_PROGRESS', 'CANCELLED'],
  COMPLETED: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
};

describe('application state machine (M4.1)', () => {
  for (const from of APPLICATION_STATUSES) {
    for (const to of APPLICATION_STATUSES) {
      const ok = ALLOWED[from].includes(to);
      it(`${from} → ${to} is ${ok ? 'allowed' : 'refused'}`, () => {
        expect(canTransition('application', from, to)).toBe(ok);
        if (ok) expect(() => assertTransition('application', from, to)).not.toThrow();
        else expect(() => assertTransition('application', from, to)).toThrow(/Invalid application status change/);
      });
    }
  }

  it('lists the next statuses in the agreed order', () => {
    for (const from of APPLICATION_STATUSES) expect(allowedNext('application', from)).toEqual(ALLOWED[from]);
  });

  it('never leaves DELIVERED or CANCELLED, and never moves to the same status', () => {
    expect(allowedNext('application', 'DELIVERED')).toEqual([]);
    expect(allowedNext('application', 'CANCELLED')).toEqual([]);
    for (const s of APPLICATION_STATUSES) expect(canTransition('application', s, s)).toBe(false);
  });
});

describe('applicationTransitionSchema', () => {
  it('takes a status with an optional note, visible to the customer by default', () => {
    expect(applicationTransitionSchema.parse({ to: 'IN_PROGRESS' })).toEqual({ to: 'IN_PROGRESS', visibleToCustomer: true });
    expect(applicationTransitionSchema.parse({ to: 'ON_HOLD', note: '  Waiting for MCA  ', visibleToCustomer: false })).toEqual({
      to: 'ON_HOLD',
      note: 'Waiting for MCA',
      visibleToCustomer: false,
    });
  });

  it('needs a reason to cancel', () => {
    expect(applicationTransitionSchema.safeParse({ to: 'CANCELLED' }).success).toBe(false);
    expect(applicationTransitionSchema.safeParse({ to: 'CANCELLED', note: '   ' }).success).toBe(false);
    expect(applicationTransitionSchema.safeParse({ to: 'CANCELLED', note: 'Customer asked to cancel' }).success).toBe(true);
  });

  it('refuses unknown statuses and overlong notes', () => {
    expect(applicationTransitionSchema.safeParse({ to: 'ARCHIVED' }).success).toBe(false);
    expect(applicationTransitionSchema.safeParse({ to: 'IN_PROGRESS', note: 'x'.repeat(1001) }).success).toBe(false);
  });
});
