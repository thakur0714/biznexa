import { z } from 'zod';
/**
 * Status models and allowed transitions (PRD prompt, Section 6).
 * The API must call assertTransition() before every status change.
 */

export const APPLICATION_STATUSES = [
  'DRAFT',
  'PAYMENT_PENDING',
  'SUBMITTED',
  'DOCUMENTS_UNDER_REVIEW',
  'DOCUMENTS_PENDING',
  'DOCUMENTS_APPROVED',
  'ASSIGNED',
  'IN_PROGRESS',
  'ON_HOLD',
  'COMPLETED',
  'DELIVERED',
  'CANCELLED',
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

const APPLICATION_TRANSITIONS: Record<ApplicationStatus, ApplicationStatus[]> = {
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

export const DOCUMENT_STATUSES = ['REQUIRED', 'UPLOADED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED'] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

const DOCUMENT_TRANSITIONS: Record<DocumentStatus, DocumentStatus[]> = {
  REQUIRED: ['UPLOADED'],
  UPLOADED: ['UNDER_REVIEW', 'UPLOADED', 'APPROVED', 'REJECTED'],
  UNDER_REVIEW: ['APPROVED', 'REJECTED'],
  APPROVED: [],
  REJECTED: ['UPLOADED'],
};

export const TICKET_STATUSES = ['OPEN', 'IN_PROGRESS', 'WAITING_FOR_CUSTOMER', 'RESOLVED', 'CLOSED'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  OPEN: ['IN_PROGRESS', 'WAITING_FOR_CUSTOMER', 'RESOLVED', 'CLOSED'],
  IN_PROGRESS: ['WAITING_FOR_CUSTOMER', 'RESOLVED', 'CLOSED'],
  WAITING_FOR_CUSTOMER: ['IN_PROGRESS', 'RESOLVED', 'CLOSED'],
  RESOLVED: ['IN_PROGRESS', 'CLOSED'],
  CLOSED: [],
};

export const CERTIFICATE_STATUSES = ['ACTIVE', 'SUSPENDED', 'WITHDRAWN', 'EXPIRED'] as const;
export type CertificateStatus = (typeof CERTIFICATE_STATUSES)[number];

export const BOOKING_LIFECYCLE_STATUSES = ['CONFIRMED', 'RESCHEDULED', 'CANCELLED', 'COMPLETED', 'NO_SHOW'] as const;
export type BookingLifecycleStatus = (typeof BOOKING_LIFECYCLE_STATUSES)[number];
export const BOOKING_TRANSITIONS: Record<BookingLifecycleStatus, BookingLifecycleStatus[]> = {
  CONFIRMED: ['RESCHEDULED', 'CANCELLED', 'COMPLETED', 'NO_SHOW'],
  RESCHEDULED: ['CONFIRMED'],
  CANCELLED: [], COMPLETED: [], NO_SHOW: [],
};

const CERTIFICATE_TRANSITIONS: Record<CertificateStatus, CertificateStatus[]> = {
  ACTIVE: ['SUSPENDED', 'WITHDRAWN', 'EXPIRED'],
  SUSPENDED: ['ACTIVE', 'WITHDRAWN', 'EXPIRED'],
  WITHDRAWN: [],
  EXPIRED: [],
};

const MACHINES = {
  application: APPLICATION_TRANSITIONS,
  document: DOCUMENT_TRANSITIONS,
  ticket: TICKET_TRANSITIONS,
  certificate: CERTIFICATE_TRANSITIONS,
  booking: BOOKING_TRANSITIONS,
} as const;

export type Machine = keyof typeof MACHINES;

export function canTransition(machine: Machine, from: string, to: string): boolean {
  const table = MACHINES[machine] as Record<string, readonly string[]>;
  return (table[from] ?? []).includes(to);
}

export function assertTransition(machine: Machine, from: string, to: string): void {
  if (!canTransition(machine, from, to)) {
    throw new Error(`Invalid ${machine} status change: ${from} → ${to}`);
  }
}

export function allowedNext(machine: Machine, from: string): string[] {
  const table = MACHINES[machine] as Record<string, readonly string[]>;
  return [...(table[from] ?? [])];
}

/**
 * The status a verifier should see. A certificate stored as ACTIVE whose
 * validUntil has passed is shown as EXPIRED even before the nightly job runs.
 */
export function effectiveCertificateStatus(
  status: CertificateStatus,
  validUntil: Date | string,
  now: Date = new Date(),
): CertificateStatus {
  if ((status === 'ACTIVE' || status === 'SUSPENDED') && new Date(validUntil).getTime() < now.getTime()) {
    return 'EXPIRED';
  }
  return status;
}

/** Customer-friendly labels */
export const APPLICATION_STATUS_LABEL: Record<ApplicationStatus, string> = {
  DRAFT: 'Draft',
  PAYMENT_PENDING: 'Payment Pending',
  SUBMITTED: 'Application Submitted',
  DOCUMENTS_UNDER_REVIEW: 'Documents Under Review',
  DOCUMENTS_PENDING: 'Documents Pending',
  DOCUMENTS_APPROVED: 'Documents Approved',
  ASSIGNED: 'Expert Assigned',
  IN_PROGRESS: 'In Progress',
  ON_HOLD: 'On Hold',
  COMPLETED: 'Completed',
  DELIVERED: 'Documents Available',
  CANCELLED: 'Cancelled',
};

/** Required when moving a document to REJECTED. */
export const rejectDocumentSchema = z.object({
  reason: z.string({ required_error: 'Enter a rejection reason', invalid_type_error: 'Enter a rejection reason' })
    .trim()
    .min(1, 'Reason cannot be empty'),
});

/** Longest note kept on an application status change (history + audit). */
export const APPLICATION_NOTE_MAX = 1000;

/**
 * A staff-requested application status change (M4.1). `note` is shown on the customer timeline unless
 * `visibleToCustomer` is false; cancelling needs a reason (§6: "admin only, with reason").
 */
export const applicationTransitionSchema = z
  .object({
    to: z.enum(APPLICATION_STATUSES),
    note: z.string().trim().max(APPLICATION_NOTE_MAX).optional(),
    visibleToCustomer: z.boolean().default(true),
    stageId: z.string().uuid().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.to === 'CANCELLED' && !v.note) ctx.addIssue({ code: 'custom', path: ['note'], message: 'Enter the reason for cancelling' });
  });
export type ApplicationTransitionInput = z.input<typeof applicationTransitionSchema>;
