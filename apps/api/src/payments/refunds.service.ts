import { BadGatewayException, BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  formatINR,
  paymentStatusAfterRefunds,
  refundableAmount,
  REFUNDABLE_PAYMENT_STATUSES,
  type DomainEventName,
  type DomainEventPayloads,
  type PaymentStatus,
  type RefundCreateInput,
  type RefundView,
} from '@biznexa/types';
import { AuditService } from '../audit/audit.service';
import { EventBus } from '../events/event-bus';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { type GatewayWebhookEvent, PaymentGateway, PaymentGatewayError } from './payment-gateway';

type Emit = { [K in DomainEventName]: [K, DomainEventPayloads[K]] }[DomainEventName];

/**
 * What a `refund.*` webhook did (stored on its `PaymentWebhookEvent` row): `applied`; `duplicate` (already
 * applied); `ignored` (not a refund event we act on); `stale` (a failure reported after the refund was
 * processed); `unknown_refund` (no refund of ours matches); `amount_mismatch` (the gateway's amount differs);
 * `processed_after_failure` (we had marked it FAILED — the money went back after all, someone must check).
 */
export type RefundOutcome = 'applied' | 'duplicate' | 'ignored' | 'stale' | 'unknown_refund' | 'amount_mismatch' | 'processed_after_failure';

export interface RefundWebhookResult {
  outcome: RefundOutcome;
  paymentId?: string;
  events: Emit[];
}

export const refundSelect = {
  id: true,
  amount: true,
  reason: true,
  status: true,
  gatewayRefundId: true,
  failureReason: true,
  createdAt: true,
  processedAt: true,
  creditNote: { select: { id: true, number: true, issuedAt: true, pdfKey: true } },
} satisfies Prisma.RefundSelect;
type RefundRow = Prisma.RefundGetPayload<{ select: typeof refundSelect }>;

export function toRefundView(r: RefundRow): RefundView {
  return {
    id: r.id,
    amount: r.amount,
    reason: r.reason,
    status: r.status,
    gatewayRefundId: r.gatewayRefundId,
    failureReason: r.failureReason,
    createdAt: r.createdAt.toISOString(),
    processedAt: r.processedAt?.toISOString() ?? null,
    creditNote: r.creditNote ? { id: r.creditNote.id, number: r.creditNote.number, issuedAt: r.creditNote.issuedAt.toISOString(), pdfReady: !!r.creditNote.pdfKey } : null,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Refunds (M4.13, D53). An admin asks for a full or partial refund; it is recorded INITIATED and the payment
 * REFUND_INITIATED **in one transaction under the payment's row lock**, so two requests at once can't refund
 * more than was paid (the second sees the first). The gateway is called after the commit, never holding the
 * lock. The gateway's `refund.processed` / `refund.failed` webhook settles it (`applyWebhook`, called by
 * `PaymentWebhookService` in its event transaction); the payment's status is always worked out again from
 * all its refunds (`paymentStatusAfterRefunds`), so a failed refund puts it back where it was.
 */
@Injectable()
export class RefundsService {
  private readonly log = new Logger(RefundsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: PaymentGateway,
    private readonly audit: AuditService,
    private readonly events: EventBus,
  ) {}

  /**
   * Starts a refund. The same `idempotencyKey` for the same payment returns the first refund (409 if it was
   * for a different amount or reason) and never calls the gateway again.
   */
  async create(paymentId: string, input: RefundCreateInput, idempotencyKey: string, actorId: string): Promise<RefundView> {
    const started = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${paymentId} FOR UPDATE`;
      const payment = await tx.payment.findUnique({
        where: { id: paymentId },
        select: {
          id: true,
          amount: true,
          status: true,
          gateway: true,
          gatewayPaymentId: true,
          orderId: true,
          order: { select: { customerId: true } },
          refunds: { select: { id: true, amount: true, status: true, reason: true, idempotencyKey: true } },
        },
      });
      if (!payment) throw new NotFoundException('Payment not found');

      const same = payment.refunds.find((r) => r.idempotencyKey === idempotencyKey);
      if (same) {
        if (same.amount !== input.amount || same.reason !== input.reason) throw new ConflictException('This Idempotency-Key was already used for a different refund');
        return { replay: true as const, refundId: same.id };
      }
      if (!REFUNDABLE_PAYMENT_STATUSES.includes(payment.status)) {
        throw new ConflictException(
          payment.status === 'REFUND_INITIATED' ? 'A refund of this payment is still in progress. Wait for it to finish.' : `A ${payment.status.toLowerCase().replace('_', ' ')} payment cannot be refunded`,
        );
      }
      if (!payment.gatewayPaymentId || payment.gateway !== this.gateway.name) throw new ConflictException(`This payment was not taken through ${this.gateway.name} and cannot be refunded here`);
      const refundable = refundableAmount(payment.amount, payment.refunds);
      if (input.amount > refundable) throw new BadRequestException(`At most ${formatINR(refundable, refundable % 100 !== 0)} of this payment can be refunded`);

      const refund = await tx.refund.create({
        data: { paymentId, amount: input.amount, reason: input.reason, initiatedById: actorId, idempotencyKey },
        select: { id: true },
      });
      await tx.payment.update({ where: { id: paymentId }, data: { status: 'REFUND_INITIATED' } });
      await this.audit.log(
        {
          actorId,
          action: 'payment.refund_initiated',
          entityType: 'Payment',
          entityId: paymentId,
          before: { status: payment.status, refundable },
          after: { status: 'REFUND_INITIATED', refundable: refundable - input.amount, refundId: refund.id, amount: input.amount, reason: input.reason },
        },
        tx,
      );
      return {
        replay: false as const,
        refundId: refund.id,
        gatewayPaymentId: payment.gatewayPaymentId,
        orderId: payment.orderId,
        customerId: payment.order?.customerId ?? null,
      };
    });
    if (started.replay) return this.view(started.refundId);

    const { refundId } = started;
    await this.events.emit('refund.initiated', { refundId, paymentId, orderId: started.orderId, customerId: started.customerId, amount: input.amount, actorId });

    try {
      const g = await this.gateway.refund({ paymentId: started.gatewayPaymentId, amount: input.amount, receipt: refundId, notes: { refund_id: refundId } });
      // The webhook may have got here first and set it already.
      await this.prisma.refund.updateMany({ where: { id: refundId, gatewayRefundId: null }, data: { gatewayRefundId: g.id } });
    } catch (e) {
      if (!(e instanceof PaymentGatewayError)) throw e;
      if (e.retryable) {
        // Unknown whether the gateway made the refund: it stays INITIATED, and the webhook (matched by our
        // refund id in its notes) settles it if it did. Never retried blindly — that could refund twice.
        this.log.error(`Refund ${refundId}: gateway did not answer (${e.message}); left INITIATED for the webhook`);
      } else {
        const failed = await this.prisma.$transaction((tx) => this.markFailed(tx, refundId, e.message, actorId));
        for (const [name, payload] of failed) await this.events.emit(name, payload as never);
        throw new BadGatewayException(`The payment gateway refused the refund: ${e.message}`);
      }
    }
    return this.view(refundId);
  }

  async view(refundId: string): Promise<RefundView> {
    return toRefundView(await this.prisma.refund.findUniqueOrThrow({ where: { id: refundId }, select: refundSelect }));
  }

  /** A `refund.processed` / `refund.failed` webhook, inside the transaction that claimed its event row. */
  async applyWebhook(tx: Prisma.TransactionClient, event: GatewayWebhookEvent): Promise<RefundWebhookResult> {
    const g = event.refund;
    if (!g || (event.type !== 'refund.processed' && event.type !== 'refund.failed')) return { outcome: 'ignored', events: [] };

    // Ours by the gateway's id, or — when the webhook beat us to saving it — by our id in its notes/receipt.
    const ours = [g.notes?.refund_id, g.receipt].find((id): id is string => !!id && UUID.test(id));
    const found =
      (await tx.refund.findUnique({ where: { gatewayRefundId: g.id }, select: { id: true, paymentId: true } })) ??
      (ours ? await tx.refund.findUnique({ where: { id: ours }, select: { id: true, paymentId: true } }) : null);
    if (!found) return { outcome: 'unknown_refund', events: [] };

    await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${found.paymentId} FOR UPDATE`;
    const refund = await tx.refund.findUniqueOrThrow({ where: { id: found.id }, select: { id: true, amount: true, status: true, gatewayRefundId: true, paymentId: true } });
    const paymentId = refund.paymentId;
    if (refund.gatewayRefundId && refund.gatewayRefundId !== g.id) return { outcome: 'unknown_refund', paymentId, events: [] };
    if (g.amount !== refund.amount) return { outcome: 'amount_mismatch', paymentId, events: [] };

    if (event.type === 'refund.failed') {
      if (refund.status === 'FAILED') return { outcome: 'duplicate', paymentId, events: [] };
      if (refund.status === 'PROCESSED') return { outcome: 'stale', paymentId, events: [] };
      const events = await this.markFailed(tx, refund.id, g.failureReason ?? 'The payment gateway could not process the refund', null, g.id);
      return { outcome: 'applied', paymentId, events };
    }

    if (refund.status === 'PROCESSED') return { outcome: 'duplicate', paymentId, events: [] };
    const now = new Date();
    await tx.refund.update({ where: { id: refund.id }, data: { status: 'PROCESSED', gatewayRefundId: g.id, processedAt: now, failureReason: null } });
    const { before, after, payment } = await this.settlePayment(tx, paymentId);
    await this.audit.log(
      {
        actorId: null,
        action: 'payment.refund_processed',
        entityType: 'Payment',
        entityId: paymentId,
        before: { status: before, refundStatus: refund.status },
        after: { status: after, refundId: refund.id, amount: refund.amount, gatewayRefundId: g.id },
      },
      tx,
    );
    return {
      outcome: refund.status === 'FAILED' ? 'processed_after_failure' : 'applied',
      paymentId,
      events: [['refund.processed', { refundId: refund.id, paymentId, orderId: payment.orderId, customerId: payment.order?.customerId ?? null, amount: refund.amount, paymentStatus: after }]],
    };
  }

  /** INITIATED → FAILED, the payment's status worked out again, audit. Returns the event to emit after commit. */
  private async markFailed(tx: Prisma.TransactionClient, refundId: string, reason: string, actorId: string | null, gatewayRefundId?: string): Promise<Emit[]> {
    const refund = await tx.refund.findUniqueOrThrow({ where: { id: refundId }, select: { paymentId: true, amount: true, status: true } });
    await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${refund.paymentId} FOR UPDATE`;
    const updated = await tx.refund.updateMany({ where: { id: refundId, status: 'INITIATED' }, data: { status: 'FAILED', failureReason: reason, ...(gatewayRefundId && { gatewayRefundId }) } });
    if (updated.count === 0) return [];
    const { before, after, payment } = await this.settlePayment(tx, refund.paymentId);
    await this.audit.log(
      {
        actorId,
        action: 'payment.refund_failed',
        entityType: 'Payment',
        entityId: refund.paymentId,
        before: { status: before, refundStatus: 'INITIATED' },
        after: { status: after, refundId, amount: refund.amount, reason },
      },
      tx,
    );
    return [['refund.failed', { refundId, paymentId: refund.paymentId, orderId: payment.orderId, customerId: payment.order?.customerId ?? null, amount: refund.amount, reason }]];
  }

  /** Sets the payment's status from all its refunds; call with the payment row locked. */
  private async settlePayment(tx: Prisma.TransactionClient, paymentId: string) {
    const payment = await tx.payment.findUniqueOrThrow({
      where: { id: paymentId },
      select: { amount: true, status: true, orderId: true, order: { select: { customerId: true } }, refunds: { select: { amount: true, status: true } } },
    });
    const after: PaymentStatus = paymentStatusAfterRefunds(payment.amount, payment.refunds);
    if (after !== payment.status) await tx.payment.update({ where: { id: paymentId }, data: { status: after } });
    return { before: payment.status, after, payment };
  }
}
