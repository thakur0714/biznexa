import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { IncomingHttpHeaders } from 'node:http';
import { assertTransition, type ApplicationStatus, type DomainEventName, type DomainEventPayloads } from '@biznexa/types';
import { ApplicationDocumentsService } from '../applications/application-documents.service';
import { AuditService } from '../audit/audit.service';
import { EventBus } from '../events/event-bus';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { type GatewayPayment, type GatewayWebhookEvent, PaymentGateway, PaymentGatewayError } from './payment-gateway';
import { type RefundOutcome, RefundsService } from './refunds.service';
import { type BookingOutcome, BookingPaymentsService } from './booking-payments.service';

/**
 * What a webhook did, stored on its `PaymentWebhookEvent` row:
 * `applied` — state changed; `duplicate` — this event or this payment's result was already applied;
 * `ignored` — an event we don't act on; `stale` — a failure reported after the payment succeeded;
 * `unknown_order` — no payment of ours has that gateway order; `amount_mismatch` — the gateway's amount
 * or currency differs from ours (not marked paid); `extra_capture` / `order_not_pending` — money was taken
 * a second time or for an order that can't take it; `overpaid` — it would take the order past its total
 * (e.g. the full amount after the advance was paid in another window). These three need a refund.
 */
type Outcome = 'applied' | 'duplicate' | 'ignored' | 'stale' | 'unknown_order' | 'amount_mismatch' | 'extra_capture' | 'order_not_pending' | 'overpaid' | RefundOutcome | BookingOutcome;

/** Logged as errors: someone has to look at these (refund, reconcile). */
const NEEDS_ATTENTION = new Set<Outcome>([
  'unknown_order', 'amount_mismatch', 'extra_capture', 'order_not_pending', 'overpaid', 'unknown_refund', 'processed_after_failure',
  'slot_taken', 'booking_not_pending',
]);
const SUCCEEDED = new Set<string>(['SUCCESS', 'REFUND_INITIATED', 'REFUNDED', 'PARTIALLY_REFUNDED']);

type Emit = { [K in DomainEventName]: [K, DomainEventPayloads[K]] }[DomainEventName];

interface Result {
  outcome: Outcome;
  paymentId?: string;
  /** Emitted after the commit. */
  events: Emit[];
}

const paymentSelect = { id: true, orderId: true, amount: true, status: true, gatewayPaymentId: true, gateway: true } satisfies Prisma.PaymentSelect;
type PaymentRow = Prisma.PaymentGetPayload<{ select: typeof paymentSelect }>;

interface PaidApplication {
  id: string;
  status: ApplicationStatus;
  serviceId: string;
  packageId: string;
}

interface Receipt {
  paymentId: string;
  amount: number;
  gatewayPaymentId: string;
  at: Date;
  /** PAID, or PARTIALLY_PAID for an advance. */
  orderStatus: 'PAID' | 'PARTIALLY_PAID';
}

/**
 * Payment webhooks (M3.17, D44). A payment is confirmed only here, by an event whose signature passed over
 * the raw body. Each event is applied in **one transaction**: its `(gateway, eventId)` row is claimed first
 * (a redelivery — even a concurrent one — finds it and changes nothing), then the payment is found by its
 * gateway order and the **order row is locked, then the coupon row** (the order M3.16 uses). The payment
 * status read after the lock is the second guard, for a different event about the same payment.
 *
 * `payment.captured` → Payment SUCCESS, order PAID, each application SUBMITTED (then DOCUMENTS_PENDING when
 * mandatory documents are missing), coupon redemption + `usedCount`, history and audit; `payment.succeeded`.
 * Part payments (M3.19): an advance makes the order PARTIALLY_PAID and does everything else above; the
 * balance then makes it PAID and only adds to `amountPaid` (audit `order.balance_received`).
 * `payment.failed` → Payment FAILED (order stays PAYMENT_PENDING for another try); `payment.failed`.
 * `refund.processed` / `refund.failed` → `RefundsService.applyWebhook` (M4.13), in the same transaction.
 * A booking's payment (M8.8) → `BookingPaymentsService.applyWebhook`, in the same transaction.
 * Any signed event answers 200 so the gateway stops retrying; problems are kept on the event row and logged.
 */
@Injectable()
export class PaymentWebhookService {
  private readonly log = new Logger(PaymentWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: PaymentGateway,
    private readonly documents: ApplicationDocumentsService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly refunds: RefundsService,
    private readonly bookings: BookingPaymentsService,
  ) {}

  async handle(rawBody: Buffer | undefined, headers: IncomingHttpHeaders): Promise<{ outcome: Outcome }> {
    if (!rawBody) {
      // The raw body is only kept when the app is created with `rawBody: true` (main.ts).
      this.log.error('Webhook received without its raw body; is the app created with rawBody: true?');
      throw new BadRequestException('Invalid webhook');
    }
    let event: GatewayWebhookEvent | null;
    try {
      event = this.gateway.readWebhook(rawBody, headers);
    } catch (e) {
      if (!(e instanceof PaymentGatewayError)) throw e;
      this.log.warn(`Signed webhook could not be read: ${e.message}`);
      throw new BadRequestException('Invalid webhook');
    }
    if (!event) throw new BadRequestException('Invalid webhook signature');

    const received = event;
    const result = await this.prisma.$transaction((tx) => this.apply(tx, received));
    if (NEEDS_ATTENTION.has(result.outcome)) {
      this.log.error(
        `Webhook ${event.id} (${event.type}, gateway payment ${event.payment?.id ?? event.refund?.paymentId ?? '-'}${event.refund ? `, gateway refund ${event.refund.id}` : ''}, payment ${result.paymentId ?? '-'}): ${result.outcome}`,
      );
    }
    for (const [name, payload] of result.events) await this.events.emit(name, payload as never);
    return { outcome: result.outcome };
  }

  private async apply(tx: Prisma.TransactionClient, event: GatewayWebhookEvent): Promise<Result> {
    const key = { gateway: this.gateway.name, eventId: event.id };
    const claimed = await tx.paymentWebhookEvent.createMany({
      data: [{ ...key, event: event.type, gatewayPaymentId: event.payment?.id ?? event.refund?.paymentId ?? null, payload: event.body as Prisma.InputJsonValue }],
      skipDuplicates: true,
    });
    if (claimed.count === 0) return { outcome: 'duplicate', events: [] };

    const result = event.type.startsWith('refund.') ? await this.refunds.applyWebhook(tx, event) : await this.applyToPayment(tx, event);
    await tx.paymentWebhookEvent.update({ where: { gateway_eventId: key }, data: { outcome: result.outcome, paymentId: result.paymentId ?? null } });
    return result;
  }

  private async applyToPayment(tx: Prisma.TransactionClient, event: GatewayWebhookEvent): Promise<Result> {
    const gp = event.payment;
    if (!gp || (event.type !== 'payment.captured' && event.type !== 'payment.failed')) return { outcome: 'ignored', events: [] };
    if (!gp.orderId) return { outcome: 'unknown_order', events: [] };

    const found = await tx.payment.findUnique({ where: { gatewayOrderId: gp.orderId }, select: { id: true, orderId: true, bookingId: true } });
    // A consultation booking's payment (M8.8): confirmed under the consultant's lock instead of the order's.
    if (found?.bookingId) return this.bookings.applyWebhook(tx, event.type, found.id, found.bookingId, gp, event.body);
    if (!found?.orderId) return { outcome: 'unknown_order', events: [] };

    // Same lock order as starting a payment: order, then coupon. Everything below is read after the lock.
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${found.orderId} FOR UPDATE`;
    const payment = await tx.payment.findUniqueOrThrow({ where: { id: found.id }, select: paymentSelect });

    return event.type === 'payment.captured' ? this.captured(tx, payment, gp, event.body) : this.failed(tx, payment, gp, event.body);
  }

  private async captured(tx: Prisma.TransactionClient, payment: PaymentRow, gp: GatewayPayment, body: unknown): Promise<Result> {
    const paymentId = payment.id;
    if (gp.status !== 'captured') return { outcome: 'ignored', paymentId, events: [] };
    if (SUCCEEDED.has(payment.status)) {
      return { outcome: payment.gatewayPaymentId === gp.id ? 'duplicate' : 'extra_capture', paymentId, events: [] };
    }
    // Never trust the event's amount: it must be exactly what we asked the customer to pay.
    if (gp.amount !== payment.amount || gp.currency !== 'INR') return { outcome: 'amount_mismatch', paymentId, events: [] };

    const now = new Date();
    await tx.payment.update({
      where: { id: paymentId },
      data: { status: 'SUCCESS', gatewayPaymentId: gp.id, method: gp.method, failureReason: null, paidAt: now, rawWebhook: body as Prisma.InputJsonValue },
    });

    const order = await tx.order.findUniqueOrThrow({
      where: { id: payment.orderId! },
      select: {
        id: true,
        status: true,
        total: true,
        amountPaid: true,
        discount: true,
        couponId: true,
        customerId: true,
        applications: { orderBy: { createdAt: 'asc' }, select: { id: true, status: true, serviceId: true, packageId: true } },
      },
    });
    // The money was taken (another payment already paid this order, or it was cancelled): the payment is
    // recorded as SUCCESS so it can be refunded, but the order and applications are left alone.
    if (order.status !== 'PAYMENT_PENDING' && order.status !== 'PARTIALLY_PAID') return { outcome: 'order_not_pending', paymentId, events: [] };
    const amountPaid = order.amountPaid + payment.amount;
    // Same for money beyond the total: the full amount paid in an old window after the advance, say.
    if (amountPaid > order.total) return { outcome: 'overpaid', paymentId, events: [] };
    const orderStatus = amountPaid === order.total ? 'PAID' : 'PARTIALLY_PAID';
    await tx.order.update({ where: { id: order.id }, data: { status: orderStatus, amountPaid } });

    if (order.status === 'PARTIALLY_PAID') {
      // The balance: the applications were submitted and the coupon redeemed with the advance.
      await this.audit.log(
        {
          actorId: null,
          action: 'order.balance_received',
          entityType: 'Order',
          entityId: order.id,
          before: { status: order.status, amountPaid: order.amountPaid },
          after: { status: orderStatus, amountPaid, paymentId, amount: payment.amount, gatewayPaymentId: gp.id },
        },
        tx,
      );
      return {
        outcome: 'applied',
        paymentId,
        events: [
          [
            'payment.succeeded',
            { paymentId, orderId: order.id, customerId: order.customerId, applicationIds: [], amount: payment.amount, gateway: payment.gateway, gatewayPaymentId: gp.id },
          ],
        ],
      };
    }

    // Redemptions are what coupon limits count (D38). The discount the customer was charged is honoured
    // even if the limit filled up between starting and completing the payment (D44).
    if (order.couponId && order.discount > 0) {
      await tx.$queryRaw`SELECT id FROM "Coupon" WHERE id = ${order.couponId} FOR UPDATE`;
      await tx.couponRedemption.create({ data: { couponId: order.couponId, userId: order.customerId, orderId: order.id, amount: order.discount } });
      await tx.coupon.update({ where: { id: order.couponId }, data: { usedCount: { increment: 1 } } });
    }

    const events: Emit[] = [];
    const submitted: string[] = [];
    const receipt: Receipt = { paymentId, amount: payment.amount, gatewayPaymentId: gp.id, at: now, orderStatus };
    // One application per order today; sequential because they share the transaction.
    for (const app of order.applications) {
      if (app.status === 'PAYMENT_PENDING') {
        events.push(...(await this.submit(tx, app, receipt)));
        submitted.push(app.id);
      } else {
        this.log.warn(`Application ${app.id} is ${app.status}, not PAYMENT_PENDING, when its order was paid; left as it is`);
      }
    }

    events.push([
      'payment.succeeded',
      { paymentId, orderId: order.id, customerId: order.customerId, applicationIds: submitted, amount: payment.amount, gateway: payment.gateway, gatewayPaymentId: gp.id },
    ]);
    return { outcome: 'applied', paymentId, events };
  }

  /** PAYMENT_PENDING → SUBMITTED, then → DOCUMENTS_PENDING when mandatory documents are still missing (M3.10 note). */
  private async submit(tx: Prisma.TransactionClient, app: PaidApplication, receipt: Receipt): Promise<Emit[]> {
    const steps: { status: ApplicationStatus; note: string }[] = [{ status: 'SUBMITTED', note: receipt.orderStatus === 'PAID' ? 'Payment received' : 'Advance received' }];
    const pending = await this.documents.pendingMandatory(app, tx);
    if (pending > 0) steps.push({ status: 'DOCUMENTS_PENDING', note: `Waiting for ${pending} required document${pending === 1 ? '' : 's'}` });

    const events: Emit[] = [];
    let from = app.status;
    for (const step of steps) {
      assertTransition('application', from, step.status);
      events.push(['application.status_changed', { applicationId: app.id, from, to: step.status, actorId: null }]);
      from = step.status;
    }
    const at = receipt.at.getTime();
    await tx.application.update({
      where: { id: app.id },
      data: {
        status: from,
        submittedAt: receipt.at,
        // Distinct times keep the timeline in order.
        history: { create: steps.map((s, i) => ({ status: s.status, note: s.note, changedById: null, changedAt: new Date(at + i) })) },
      },
    });
    await this.audit.log(
      {
        actorId: null,
        action: 'application.payment_received',
        entityType: 'Application',
        entityId: app.id,
        before: { status: app.status, orderStatus: 'PAYMENT_PENDING' },
        after: { status: from, orderStatus: receipt.orderStatus, paymentId: receipt.paymentId, amount: receipt.amount, gatewayPaymentId: receipt.gatewayPaymentId },
      },
      tx,
    );
    return events;
  }

  private async failed(tx: Prisma.TransactionClient, payment: PaymentRow, gp: GatewayPayment, body: unknown): Promise<Result> {
    const paymentId = payment.id;
    // A failed attempt reported after a successful one (events can arrive out of order) changes nothing.
    if (SUCCEEDED.has(payment.status)) return { outcome: 'stale', paymentId, events: [] };
    if (payment.status === 'FAILED' && payment.gatewayPaymentId === gp.id) return { outcome: 'duplicate', paymentId, events: [] };

    const reason = gp.failureReason ?? 'Payment failed';
    await tx.payment.update({
      where: { id: paymentId },
      data: { status: 'FAILED', gatewayPaymentId: gp.id, method: gp.method, failureReason: reason, rawWebhook: body as Prisma.InputJsonValue },
    });
    const order = await tx.order.findUniqueOrThrow({ where: { id: payment.orderId! }, select: { id: true, customerId: true } });
    return {
      outcome: 'applied',
      paymentId,
      events: [['payment.failed', { paymentId, orderId: order.id, customerId: order.customerId, amount: payment.amount, reason }]],
    };
  }
}
