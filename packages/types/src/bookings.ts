/**
 * Consultation bookings (M8.8, D58). The customer picks a type and one of the consultant's slots; the booking
 * is created PENDING_PAYMENT and holds the slot for `BOOKING_HOLD_MINUTES`. Only the gateway's signed webhook
 * makes it CONFIRMED. The fee is always the consultant's, read by the server; the client never sends an amount.
 */
import { z } from 'zod';
import { consultationTypeSchema } from './consultants';
import { istYear } from './applications';
import { PAYMENT_GATEWAYS, PAYMENT_STATUSES } from './payments';

export const BOOKING_STATUSES = ['PENDING_PAYMENT', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'RESCHEDULED', 'EXPIRED'] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/** `BKG-2026-000123`: year of creation in IST + running number (like order codes). */
export function formatBookingCode(n: number, at: Date): string {
  return `BKG-${istYear(at)}-${String(n).padStart(6, '0')}`;
}

/** `POST /api/bookings`: `startAt` must be exactly one of the slots `GET /api/public/consultants/:slug/slots` lists. */
export const createBookingInputSchema = z
  .object({
    consultantSlug: z.string().trim().min(1).max(120),
    type: consultationTypeSchema,
    startAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type CreateBookingInput = z.infer<typeof createBookingInputSchema>;

export const bookingMeetingLinkSchema = z.object({ meetingLink: z.string().url().max(2048).refine((u) => ['https:', 'http:'].includes(new URL(u).protocol), 'Enter a valid meeting URL') }).strict();
export type BookingMeetingLinkInput = z.infer<typeof bookingMeetingLinkSchema>;

export const bookingViewSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  status: z.enum(BOOKING_STATUSES),
  type: consultationTypeSchema,
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  /** Integer paise. */
  fee: z.number().int(),
  /** Until when a PENDING_PAYMENT booking holds its slot; null once settled. */
  holdExpiresAt: z.string().datetime().nullable(),
  meetingLink: z.string().url().nullable(),
  consultant: z.object({ slug: z.string(), name: z.string() }),
  /** The latest payment attempt, if any. */
  payment: z.object({ id: z.string().uuid(), status: z.enum(PAYMENT_STATUSES), amount: z.number().int() }).nullable(),
  createdAt: z.string().datetime(),
});
export type BookingView = z.infer<typeof bookingViewSchema>;

export const bookingListSchema = z.object({ items: z.array(bookingViewSchema) });
export type BookingList = z.infer<typeof bookingListSchema>;

/** What the browser needs to open the gateway's checkout for a booking (same flow as `PaymentCheckout`). */
export const bookingCheckoutSchema = z.object({
  paymentId: z.string().uuid(),
  gateway: z.enum(PAYMENT_GATEWAYS),
  key: z.string(),
  gatewayOrderId: z.string(),
  amount: z.number().int().positive(),
  currency: z.literal('INR'),
  bookingId: z.string().uuid(),
  bookingCode: z.string(),
  holdExpiresAt: z.string().datetime(),
  description: z.string(),
  prefill: z.object({ name: z.string().nullable(), email: z.string().nullable(), contact: z.string().nullable() }),
});
export type BookingCheckout = z.infer<typeof bookingCheckoutSchema>;
