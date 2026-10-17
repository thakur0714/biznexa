import { Prisma } from '../generated/prisma/client';
import type { ApplicationStatus } from '../generated/prisma/enums';

/**
 * Account deletion = anonymisation, not a hard delete (M5.12, D61). The person's details are removed or
 * replaced; the records the law makes us keep (GST invoices, payments, credit notes, certificates — and the
 * orders and applications they hang off) stay exactly as they are, now pointing at an anonymous user.
 */
export const DELETED_USER_NAME = 'Deleted user';
export const DELETED_BUSINESS_NAME = 'Deleted business';
export const DELETED_TEXT = '[deleted]';

/** Paid work under way. A draft or an unpaid application is not "in progress" and does not block a deletion. */
export const IN_PROGRESS_STATUSES: ApplicationStatus[] = [
  'SUBMITTED',
  'DOCUMENTS_UNDER_REVIEW',
  'DOCUMENTS_PENDING',
  'DOCUMENTS_APPROVED',
  'ASSIGNED',
  'IN_PROGRESS',
  'ON_HOLD',
];

export interface DeletionFacts {
  applicationsInProgress: number;
  ordersWithBalance: number;
  upcomingBookings: number;
}

/** Why the account can't be deleted yet, in words for staff and the customer. Empty = it can. */
export function deletionBlockers(f: DeletionFacts): string[] {
  const out: string[] = [];
  const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
  if (f.applicationsInProgress) out.push(`${n(f.applicationsInProgress, 'application is', 'applications are')} still in progress`);
  if (f.ordersWithBalance) out.push(`${n(f.ordersWithBalance, 'order has', 'orders have')} a balance due`);
  if (f.upcomingBookings) out.push(`${n(f.upcomingBookings, 'consultation is', 'consultations are')} coming up`);
  return out;
}

/** The user row after deletion: no way to identify or reach the person, and no way to sign in. */
export function anonymisedUser(now: Date) {
  return {
    name: DELETED_USER_NAME,
    email: null,
    mobile: null,
    passwordHash: null,
    googleId: null,
    avatarUrl: null,
    emailVerified: false,
    mobileVerified: false,
    totpSecret: null,
    totpEnabledAt: null,
    totpLastStep: null,
    totpFailures: 0,
    totpLockedUntil: null,
    notificationPrefs: Prisma.DbNull,
    status: 'DELETED' as const,
    deletedAt: now,
  } satisfies Prisma.UserUpdateInput;
}

export const anonymisedProfile = {
  panMasked: null,
  panEnc: null,
  address: null,
  city: null,
  state: null,
  pincode: null,
} satisfies Prisma.CustomerProfileUpdateManyMutationInput;

/** A proprietorship's name and PAN are the owner's own; invoices and certificates keep their own copies. */
export const anonymisedBusiness = {
  legalName: DELETED_BUSINESS_NAME,
  gstin: null,
  cin: null,
  pan: null,
  address: Prisma.DbNull,
  state: null,
} satisfies Prisma.BusinessEntityUpdateManyMutationInput;

export interface AnonymiseResult {
  /** Uploaded files and export ZIPs whose bytes must be deleted once the transaction has committed. */
  fileKeys: string[];
}

/**
 * Applies every rule in one transaction (the caller's). Storage can't roll back, so file bytes are only
 * listed here and deleted by the caller after the commit; the rows are already marked deleted, so a file
 * that survives a crash in between can no longer be downloaded.
 */
export async function anonymiseAccount(tx: Prisma.TransactionClient, userId: string, now: Date): Promise<AnonymiseResult> {
  const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, mobile: true } });
  const mine = { customerId: userId };

  const uploads = await tx.storedFile.findMany({ where: { ownerId: userId, deletedAt: null }, select: { fileKey: true } });
  const exportFiles = await tx.dataRequest.findMany({ where: { userId, fileKey: { not: null } }, select: { fileKey: true } });

  await tx.user.update({ where: { id: userId }, data: anonymisedUser(now) });
  await tx.customerProfile.updateMany({ where: { userId }, data: anonymisedProfile });
  await tx.businessEntity.updateMany({ where: { ownerId: userId }, data: anonymisedBusiness });
  await tx.businessEntity.updateMany({ where: { ownerId: userId, deletedAt: null }, data: { deletedAt: now } });

  // Signed out everywhere, nothing left to sign in or be reached with.
  await tx.refreshToken.deleteMany({ where: { userId } });
  await tx.deviceToken.deleteMany({ where: { userId } });
  await tx.notification.deleteMany({ where: { userId } });
  const targets = [user.email, user.mobile].filter((t): t is string => !!t);
  if (targets.length) {
    await tx.otpCode.deleteMany({ where: { target: { in: targets } } });
    await tx.lead.deleteMany({ where: { OR: [...(user.email ? [{ email: user.email }] : []), ...(user.mobile ? [{ mobile: user.mobile }] : [])] } });
  }

  // What the person wrote or uploaded. Application rows, codes and statuses stay (invoices point at their orders).
  await tx.application.updateMany({ where: mine, data: { formData: {} } });
  await tx.applicationDocument.updateMany({ where: { application: mine }, data: { fileName: null } });
  await tx.storedFile.updateMany({ where: { ownerId: userId, deletedAt: null }, data: { originalName: 'deleted', deletedAt: now } });
  await tx.message.updateMany({ where: { senderId: userId }, data: { body: DELETED_TEXT } });
  await tx.ticket.updateMany({ where: mine, data: { subject: DELETED_TEXT, description: DELETED_TEXT } });
  await tx.booking.updateMany({ where: mine, data: { notes: null } });
  await tx.review.updateMany({ where: { booking: mine }, data: { text: null } });
  await tx.reminder.updateMany({ where: { userId, status: 'SCHEDULED' }, data: { status: 'CANCELLED' } });
  await tx.dataRequest.updateMany({ where: { userId, fileKey: { not: null } }, data: { fileKey: null } });
  // An export still being prepared would only hold the anonymised account now; its job finds it closed and stops.
  await tx.dataRequest.updateMany({
    where: { userId, type: 'EXPORT', status: { in: ['PENDING', 'PROCESSING'] } },
    data: { status: 'REJECTED', rejectionReason: 'The account was deleted', handledAt: now },
  });

  return { fileKeys: [...uploads.map((f) => f.fileKey), ...exportFiles.map((e) => e.fileKey!)] };
}
