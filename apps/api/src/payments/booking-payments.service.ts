import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { BookingCheckout, BookingView, DomainEventName, DomainEventPayloads, PaymentCallbackInput } from '@biznexa/types';
import { AuditService } from '../audit/audit.service';
import { expireStaleHolds, liveOverlap, lockConsultant } from '../bookings/booking-holds';
import { bookingViewSelect, toBookingView } from '../bookings/booking-view';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CheckoutService } from './checkout.service';
import { type GatewayPayment, PaymentGateway } from './payment-gateway';

type Emit = { [K in DomainEventName]: [K, DomainEventPayloads[K]] }[DomainEventName];

/**
 * What a booking payment's webhook did (stored on the `PaymentWebhookEvent` like the order outcomes):
 * `slot_taken` — paid after the hold ran out and someone else holds or booked the slot; `booking_not_pending`
 * — paid for a booking that is already confirmed or closed. Both keep the payment SUCCESS for a refund.
 */
export type BookingOutcome = 'applied' | 'duplicate' | 'ignored' | 'stale' | 'amount_mismatch' | 'extra_capture' | 'slot_taken' | 'booking_not_pending';

export interface BookingWebhookResult {
  outcome: BookingOutcome;
  paymentId: string;
  events: Emit[];
}

const SUCCEEDED = new Set<string>(['SUCCESS', 'REFUND_INITIATED', 'REFUNDED', 'PARTIALLY_REFUNDED']);
const paymentSelect = { id: true, amount: true, gatewayOrderId: true } satisfies Prisma.PaymentSelect;

/**
 * Paying for a booking (M8.8, D58) with the same rules as an application (D43–D45): the amount is the
 * booking's fee, one open payment is reused for retries, the gateway order is attached after the commit
 * with a compare-and-set (`CheckoutService.attachGatewayOrder`), the browser callback only marks the payment
 * PENDING, and only the signed webhook confirms the booking.
 */
@Injectable()
export class BookingPaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: PaymentGateway,
    private readonly checkout: CheckoutService,
    private readonly audit: AuditService,
  ) {}

  async start(customerId: string, bookingId: string, now = new Date()): Promise<BookingCheckout> {
    const opened = await this.prisma.$transaction(async (tx) => {
      const owned = await tx.booking.findFirst({ where: { id: bookingId, customerId }, select: { id: true } });
      if (!owned) throw new NotFoundException('Booking not found');
      // Concurrent clicks share one payment.
      await tx.$queryRaw`SELECT id FROM "Booking" WHERE id = ${bookingId} FOR UPDATE`;
      const booking = await tx.booking.findUniqueOrThrow({
        where: { id: bookingId },
        select: { id: true, code: true, status: true, fee: true, holdExpiresAt: true, type: true, consultant: { select: { user: { select: { name: true } } } } },
      });
      if (booking.status === 'CONFIRMED') throw new ConflictException('This booking is already paid.');
      if (booking.status !== 'PENDING_PAYMENT' || !booking.holdExpiresAt || booking.holdExpiresAt <= now) {
        throw new ConflictException('This slot is no longer held for you. Pick a slot again.');
      }
      const open = await tx.payment.findFirst({
        where: { bookingId, status: { in: ['CREATED', 'PENDING'] }, gateway: this.gateway.name, amount: booking.fee },
        orderBy: { createdAt: 'desc' },
        select: paymentSelect,
      });
      const payment = open ?? (await tx.payment.create({ data: { bookingId, gateway: this.gateway.name, amount: booking.fee, status: 'CREATED' }, select: paymentSelect }));
      const customer = await tx.user.findUniqueOrThrow({ where: { id: customerId }, select: { name: true, email: true, mobile: true } });
      return { booking, payment, customer, holdExpiresAt: booking.holdExpiresAt };
    });
    const { booking, payment, customer } = opened;
    const gatewayOrderId = payment.gatewayOrderId ?? (await this.checkout.attachGatewayOrder(payment, { paymentId: payment.id, bookingCode: booking.code }));
    return {
      paymentId: payment.id,
      gateway: this.gateway.name,
      key: this.gateway.checkoutKey,
      gatewayOrderId,
      amount: payment.amount,
      currency: 'INR',
      bookingId: booking.id,
      bookingCode: booking.code,
      holdExpiresAt: opened.holdExpiresAt.toISOString(),
      description: `${booking.type.charAt(0)}${booking.type.slice(1).toLowerCase()} consultation with ${booking.consultant.user.name}`,
      prefill: { name: customer.name, email: customer.email, contact: customer.mobile },
    };
  }

  /** Checkout's success handler: a valid signature moves the payment CREATED → PENDING ("confirming"), nothing else (D45). */
  async callback(customerId: string, bookingId: string, input: PaymentCallbackInput): Promise<BookingView> {
    const booking = await this.prisma.booking.findFirst({ where: { id: bookingId, customerId }, select: { id: true } });
    if (!booking) throw new NotFoundException('Booking not found');
    const payment = await this.prisma.payment.findFirst({ where: { id: input.paymentId, bookingId, gatewayOrderId: input.gatewayOrderId }, select: { id: true } });
    const valid = payment && this.gateway.verifyPaymentSignature({ orderId: input.gatewayOrderId, paymentId: input.gatewayPaymentId, signature: input.signature });
    if (!valid) throw new BadRequestException('This payment confirmation could not be verified.');
    await this.prisma.payment.updateMany({ where: { id: payment.id, status: 'CREATED' }, data: { status: 'PENDING' } });
    return toBookingView(await this.prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, select: bookingViewSelect }));
  }

  /**
   * A signed `payment.captured` / `payment.failed` for a booking's payment, inside the webhook's transaction
   * (the event row is already claimed). Takes the consultant row lock, the lock booking creation takes.
   */
  async applyWebhook(tx: Prisma.TransactionClient, type: 'payment.captured' | 'payment.failed', paymentId: string, bookingId: string, gp: GatewayPayment, body: unknown, now = new Date()): Promise<BookingWebhookResult> {
    const { consultantId } = await tx.booking.findUniqueOrThrow({ where: { id: bookingId }, select: { consultantId: true } });
    await lockConsultant(tx, consultantId);
    const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId }, select: { id: true, amount: true, status: true, gatewayPaymentId: true } });

    if (type === 'payment.failed') {
      if (SUCCEEDED.has(payment.status)) return { outcome: 'stale', paymentId, events: [] };
      if (payment.status === 'FAILED' && payment.gatewayPaymentId === gp.id) return { outcome: 'duplicate', paymentId, events: [] };
      // The booking keeps its hold until it runs out; the customer can try again.
      await tx.payment.update({
        where: { id: paymentId },
        data: { status: 'FAILED', gatewayPaymentId: gp.id, method: gp.method, failureReason: gp.failureReason ?? 'Payment failed', rawWebhook: body as Prisma.InputJsonValue },
      });
      return { outcome: 'applied', paymentId, events: [] };
    }

    if (gp.status !== 'captured') return { outcome: 'ignored', paymentId, events: [] };
    if (SUCCEEDED.has(payment.status)) return { outcome: payment.gatewayPaymentId === gp.id ? 'duplicate' : 'extra_capture', paymentId, events: [] };
    if (gp.amount !== payment.amount || gp.currency !== 'INR') return { outcome: 'amount_mismatch', paymentId, events: [] };

    await tx.payment.update({
      where: { id: paymentId },
      data: { status: 'SUCCESS', gatewayPaymentId: gp.id, method: gp.method, failureReason: null, paidAt: now, rawWebhook: body as Prisma.InputJsonValue },
    });
    const booking = await tx.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: { id: true, code: true, status: true, customerId: true, consultantId: true, startAt: true, endAt: true, holdExpiresAt: true },
    });
    // The money was taken, so the payment stays SUCCESS for a refund; the booking is left alone.
    if (booking.status !== 'PENDING_PAYMENT' && booking.status !== 'EXPIRED') return { outcome: 'booking_not_pending', paymentId, events: [] };

    const held = booking.status === 'PENDING_PAYMENT' && booking.holdExpiresAt !== null && booking.holdExpiresAt > now;
    if (!held) {
      // Paid after the hold ran out: still confirmed if nobody else took the slot meanwhile.
      await expireStaleHolds(tx, consultantId, booking.startAt, booking.endAt, now, booking.id);
      if (await liveOverlap(tx, consultantId, booking.startAt, booking.endAt, now, booking.id)) {
        if (booking.status === 'PENDING_PAYMENT') await tx.booking.update({ where: { id: booking.id }, data: { status: 'EXPIRED' } });
        return { outcome: 'slot_taken', paymentId, events: [] };
      }
    }

    const meetingLink = `https://meet.jit.si/BizNexa-${randomUUID()}`;
    await tx.booking.update({ where: { id: booking.id }, data: { status: 'CONFIRMED', holdExpiresAt: null, meetingLink } });
    await tx.bookingStatusHistory.create({ data: { bookingId: booking.id, fromStatus: booking.status, toStatus: 'CONFIRMED', actorId: null, metadata: { paymentId } } });
    await this.audit.log(
      {
        actorId: null,
        action: 'booking.payment_received',
        entityType: 'Booking',
        entityId: booking.id,
        before: { status: booking.status, holdExpiresAt: booking.holdExpiresAt?.toISOString() ?? null },
        after: { status: 'CONFIRMED', paymentId, amount: payment.amount, gatewayPaymentId: gp.id },
      },
      tx,
    );
    return {
      outcome: 'applied',
      paymentId,
      events: [
        [
          'booking.confirmed',
          {
            bookingId: booking.id, code: booking.code, customerId: booking.customerId, consultantId: booking.consultantId,
            startAt: booking.startAt.toISOString(), endAt: booking.endAt.toISOString(), paymentId, amount: payment.amount,
          },
        ],
      ],
    };
  }
}
