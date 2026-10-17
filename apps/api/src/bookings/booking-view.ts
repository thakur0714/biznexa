import { bookingViewSchema, type BookingView } from '@biznexa/types';
import { Prisma } from '../generated/prisma/client';

export const bookingViewSelect = {
  id: true,
  code: true,
  status: true,
  type: true,
  startAt: true,
  endAt: true,
  fee: true,
  holdExpiresAt: true,
  meetingLink: true,
  createdAt: true,
  consultant: { select: { slug: true, user: { select: { name: true } } } },
  payments: { orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, status: true, amount: true } },
} satisfies Prisma.BookingSelect;

type Row = Prisma.BookingGetPayload<{ select: typeof bookingViewSelect }>;

export function toBookingView(row: Row): BookingView {
  return bookingViewSchema.parse({
    id: row.id,
    code: row.code,
    status: row.status,
    type: row.type,
    startAt: row.startAt.toISOString(),
    endAt: row.endAt.toISOString(),
    fee: row.fee,
    holdExpiresAt: row.status === 'PENDING_PAYMENT' && row.holdExpiresAt ? row.holdExpiresAt.toISOString() : null,
    meetingLink: row.meetingLink,
    consultant: { slug: row.consultant.slug, name: row.consultant.user.name },
    payment: row.payments[0] ?? null,
    createdAt: row.createdAt.toISOString(),
  });
}
