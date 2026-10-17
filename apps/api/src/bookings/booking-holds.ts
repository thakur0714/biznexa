import { Prisma } from '../generated/prisma/client';

/**
 * Shared by booking creation (M8.8) and the payment webhook, which must agree on what holds a slot.
 * A booking holds its slot while CONFIRMED, or PENDING_PAYMENT with `holdExpiresAt` still in the future.
 */
export const liveBookingWhere = (now: Date): Prisma.BookingWhereInput => ({
  OR: [{ status: 'CONFIRMED' }, { status: 'PENDING_PAYMENT', holdExpiresAt: { gt: now } }],
});

/**
 * Serialises every change to one consultant's bookings (create a hold, confirm a payment). Taken first in
 * the transaction; everything about the consultant's bookings is read after it.
 */
export async function lockConsultant(tx: Prisma.TransactionClient, consultantId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "Consultant" WHERE id = ${consultantId} FOR UPDATE`;
}

/**
 * Moves PENDING_PAYMENT bookings whose hold ran out and that overlap `startAt`..`endAt` to EXPIRED, so the
 * `Booking_no_overlap` exclusion constraint (which only sees PENDING_PAYMENT / CONFIRMED rows) lets the slot
 * be taken again. Call under `lockConsultant`.
 */
export async function expireStaleHolds(tx: Prisma.TransactionClient, consultantId: string, startAt: Date, endAt: Date, now: Date, exceptId?: string) {
  await tx.booking.updateMany({
    where: {
      consultantId,
      status: 'PENDING_PAYMENT',
      OR: [{ holdExpiresAt: null }, { holdExpiresAt: { lte: now } }],
      startAt: { lt: endAt },
      endAt: { gt: startAt },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    data: { status: 'EXPIRED' },
  });
}

/** Another live booking overlapping `startAt`..`endAt`, if any. Call under `lockConsultant`. */
export function liveOverlap(tx: Prisma.TransactionClient, consultantId: string, startAt: Date, endAt: Date, now: Date, exceptId?: string) {
  return tx.booking.findFirst({
    where: { consultantId, startAt: { lt: endAt }, endAt: { gt: startAt }, ...liveBookingWhere(now), ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
}

/** True when `e` is the database refusing an overlapping live booking (the exclusion constraint). */
export function isOverlapViolation(e: unknown): boolean {
  const text = e instanceof Error ? `${e.message} ${JSON.stringify((e as { meta?: unknown }).meta ?? '')}` : String(e);
  return text.includes('Booking_no_overlap') || text.includes('23P01');
}
