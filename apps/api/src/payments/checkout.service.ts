import { BadGatewayException, BadRequestException, ConflictException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import {
  MIN_ONLINE_PAYMENT,
  assertTransition,
  attemptPlan,
  currentAttempt,
  paymentOutcome,
  type OrderSummary,
  type PaymentCallbackInput,
  type PaymentCheckout,
  type PaymentPlan,
  type PaymentStatusView,
} from '@biznexa/types';
import { ApplicationsService } from '../applications/applications.service';
import { OrderSummaryService } from '../applications/order-summary.service';
import { AuditService } from '../audit/audit.service';
import { EventBus } from '../events/event-bus';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { PaymentGateway, PaymentGatewayError } from './payment-gateway';

const paymentSelect = { id: true, amount: true, gatewayOrderId: true } satisfies Prisma.PaymentSelect;
type OpenPayment = Prisma.PaymentGetPayload<{ select: typeof paymentSelect }>;

interface Opened {
  payment: OpenPayment;
  plan: PaymentPlan;
  /** True when this call moved the application DRAFT → PAYMENT_PENDING. */
  started: boolean;
  application: { id: string; code: string };
  orderCode: string;
  description: string;
  customer: { name: string | null; email: string | null; mobile: string | null };
}

/**
 * Start payment (M3.16). One transaction, under a lock on the order row (then the coupon row — M3.17 must
 * lock in the same order): checks the form is complete, re-prices the order with `OrderSummaryService.price`
 * (coupon re-validated), creates a `Payment` (CREATED) for **that** total and moves the order and the
 * application to PAYMENT_PENDING. The gateway order is created after the commit, so no row lock is held
 * across a network call; it carries our `Payment` id as `receipt` and is attached with a compare-and-set,
 * so concurrent clicks share one payment and one gateway order. Calling again while PAYMENT_PENDING (retry,
 * reload, gateway outage) reuses the open payment at the frozen order total.
 *
 * Part payment (M3.19, D46): `plan` ADVANCE charges `OrderSummary.advance.amount` instead of the total, when
 * every package allows it; once the advance is paid (order PARTIALLY_PAID) the only plan is BALANCE,
 * `total − amountPaid`, as a new payment. An open payment is reused only when it is for the same amount.
 */
@Injectable()
export class CheckoutService {
  private readonly log = new Logger(CheckoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: PaymentGateway,
    private readonly orders: OrderSummaryService,
    private readonly applications: ApplicationsService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
  ) {}

  async start(customerId: string, applicationId: string, plan?: PaymentPlan): Promise<PaymentCheckout> {
    const opened = await this.prisma.$transaction((tx) => this.open(tx, customerId, applicationId, plan));
    if (opened.started) {
      await this.events.emit('application.status_changed', { applicationId: opened.application.id, from: 'DRAFT', to: 'PAYMENT_PENDING', actorId: customerId });
    }
    const notes = { paymentId: opened.payment.id, orderCode: opened.orderCode, applicationCode: opened.application.code, plan: opened.plan };
    const gatewayOrderId = opened.payment.gatewayOrderId ?? (await this.attachGatewayOrder(opened.payment, notes));
    return {
      paymentId: opened.payment.id,
      gateway: this.gateway.name,
      key: this.gateway.checkoutKey,
      gatewayOrderId,
      amount: opened.payment.amount,
      plan: opened.plan,
      currency: 'INR',
      applicationId: opened.application.id,
      applicationCode: opened.application.code,
      orderCode: opened.orderCode,
      description: opened.description,
      prefill: { name: opened.customer.name, email: opened.customer.email, contact: opened.customer.mobile },
    };
  }

  private async open(tx: Prisma.TransactionClient, customerId: string, applicationId: string, requested?: PaymentPlan): Promise<Opened> {
    const owned = await tx.application.findFirst({ where: { id: applicationId, customerId }, select: { orderId: true } });
    if (!owned?.orderId) throw new NotFoundException('Application not found');

    // Serialises payment start with the order summary and coupon changes (they take the same lock).
    // The application is read after the lock, so a concurrent start that just committed is seen.
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${owned.orderId} FOR UPDATE`;
    const app = await tx.application.findUniqueOrThrow({
      where: { id: applicationId },
      select: { id: true, code: true, status: true, serviceId: true, formSchemaVersion: true, formData: true },
    });
    const order = await tx.order.findUniqueOrThrow({
      where: { id: owned.orderId },
      select: { id: true, code: true, status: true, total: true, amountPaid: true, couponId: true, items: { orderBy: { id: 'asc' }, select: { description: true } } },
    });
    const customer = await tx.user.findUniqueOrThrow({ where: { id: customerId }, select: { name: true, email: true, mobile: true } });
    const context = { application: { id: app.id, code: app.code }, orderCode: order.code, customer };

    if (order.status === 'CREATED' && app.status === 'DRAFT') {
      const plan = firstPaymentPlan(requested);
      await this.applications.assertFormComplete(tx, app);

      // Held until commit, so the coupon's rules and limits cannot change between this check and the charge.
      if (order.couponId) await tx.$queryRaw`SELECT id FROM "Coupon" WHERE id = ${order.couponId} FOR UPDATE`;
      const summary = await this.orders.price(tx, customerId, app.id);
      assertChargeable(summary);
      const amount = amountFor(plan, summary);

      const payment = await tx.payment.create({
        data: { orderId: order.id, gateway: this.gateway.name, amount, status: 'CREATED' },
        select: paymentSelect,
      });
      await tx.order.update({ where: { id: order.id }, data: { status: 'PAYMENT_PENDING' } });
      assertTransition('application', app.status, 'PAYMENT_PENDING');
      await tx.application.update({
        where: { id: app.id },
        data: { status: 'PAYMENT_PENDING', history: { create: { status: 'PAYMENT_PENDING', changedById: customerId, note: 'Payment started' } } },
      });
      await this.audit.log(
        {
          actorId: customerId,
          action: 'application.payment_start',
          entityType: 'Application',
          entityId: app.id,
          before: { status: app.status, orderStatus: order.status },
          after: { status: 'PAYMENT_PENDING', orderStatus: 'PAYMENT_PENDING', paymentId: payment.id, amount: payment.amount, plan },
        },
        tx,
      );
      return { ...context, payment, plan, started: true, description: describe(summary.lines, plan) };
    }

    if (order.status === 'PAYMENT_PENDING' && app.status === 'PAYMENT_PENDING') {
      const plan = firstPaymentPlan(requested);
      // Totals and the advance are frozen once payment has started (D40); the summary reads them as stored.
      const summary = await this.orders.price(tx, customerId, app.id);
      const payment = await this.openPayment(tx, order.id, amountFor(plan, summary));
      return { ...context, payment, plan, started: false, description: describe(order.items, plan) };
    }

    if (order.status === 'PARTIALLY_PAID' && app.status !== 'CANCELLED') {
      const plan = requested ?? 'BALANCE';
      if (plan !== 'BALANCE') throw new ConflictException('The advance for this order is paid; only the balance is left to pay.');
      const payment = await this.openPayment(tx, order.id, order.total - order.amountPaid);
      return { ...context, payment, plan, started: false, description: describe(order.items, plan) };
    }

    throw new ConflictException(
      order.status === 'PAID' ? 'This order is already paid.' : 'This application can’t be paid for online. Contact us if you need help.',
    );
  }

  /** The open payment for exactly this amount on this gateway (retry, reload, outage), or a new one. */
  private async openPayment(tx: Prisma.TransactionClient, orderId: string, amount: number): Promise<OpenPayment> {
    const open = await tx.payment.findFirst({
      where: { orderId, status: { in: ['CREATED', 'PENDING'] }, gateway: this.gateway.name, amount },
      orderBy: { createdAt: 'desc' },
      select: paymentSelect,
    });
    return open ?? tx.payment.create({ data: { orderId, gateway: this.gateway.name, amount, status: 'CREATED' }, select: paymentSelect });
  }

  /** Where the application's payment stands (M3.18): what the payment page polls until the webhook has paid the order. */
  async status(customerId: string, applicationId: string): Promise<PaymentStatusView> {
    const app = await this.prisma.application.findFirst({
      where: { id: applicationId, customerId },
      select: {
        id: true,
        code: true,
        status: true,
        order: {
          select: {
            code: true,
            status: true,
            total: true,
            amountPaid: true,
            payments: {
              orderBy: { createdAt: 'desc' },
              select: { id: true, status: true, amount: true, method: true, failureReason: true, paidAt: true, createdAt: true },
            },
          },
        },
      },
    });
    if (!app?.order) throw new NotFoundException('Application not found');
    const { order } = app;
    const attempt = currentAttempt(order, order.payments);
    return {
      outcome: paymentOutcome(order.status, attempt?.status ?? null),
      applicationId: app.id,
      applicationCode: app.code,
      applicationStatus: app.status,
      orderCode: order.code,
      orderStatus: order.status,
      total: order.total,
      amountPaid: order.amountPaid,
      balance: order.total - order.amountPaid,
      payment: attempt && {
        id: attempt.id,
        status: attempt.status,
        amount: attempt.amount,
        method: attempt.method,
        failureReason: attempt.failureReason,
        paidAt: attempt.paidAt?.toISOString() ?? null,
        plan: attemptPlan(attempt, order),
      },
    };
  }

  /**
   * Checkout's success handler (M3.18). The signature only proves the customer finished checkout, so a
   * valid one moves the payment CREATED → PENDING ("confirming") and nothing else: the order is paid and the
   * application submitted only by the signed webhook (D44), which also works if the browser never gets here.
   */
  async callback(customerId: string, applicationId: string, input: PaymentCallbackInput): Promise<PaymentStatusView> {
    const app = await this.prisma.application.findFirst({ where: { id: applicationId, customerId }, select: { orderId: true } });
    if (!app?.orderId) throw new NotFoundException('Application not found');
    const payment = await this.prisma.payment.findFirst({
      where: { id: input.paymentId, orderId: app.orderId, gatewayOrderId: input.gatewayOrderId },
      select: { id: true },
    });
    const valid =
      payment &&
      this.gateway.verifyPaymentSignature({ orderId: input.gatewayOrderId, paymentId: input.gatewayPaymentId, signature: input.signature });
    if (!valid) throw new BadRequestException('This payment confirmation could not be verified.');

    // Only from CREATED: the webhook may already have set SUCCESS or FAILED, and those stand.
    await this.prisma.payment.updateMany({ where: { id: payment.id, status: 'CREATED' }, data: { status: 'PENDING' } });
    return this.status(customerId, applicationId);
  }

  /**
   * Creates the gateway order for a payment that has none yet; the first one attached wins. Also used for
   * booking payments (M8.8), so both follow the same no-lock-across-the-network, compare-and-set rules.
   */
  async attachGatewayOrder(payment: { id: string; amount: number }, notes: Record<string, string>): Promise<string> {
    let gatewayOrder;
    try {
      gatewayOrder = await this.gateway.createOrder({ amount: payment.amount, receipt: payment.id, notes });
    } catch (e) {
      if (!(e instanceof PaymentGatewayError)) throw e;
      // The payment stays CREATED (and the application PAYMENT_PENDING): calling again retries with the same payment.
      this.log.warn(`Gateway order for payment ${payment.id} failed (${e.retryable ? 'retryable' : 'refused'}): ${e.message}`);
      if (e.retryable) throw new ServiceUnavailableException('We couldn’t reach the payment service. Please try again in a moment.');
      throw new BadGatewayException('The payment service didn’t accept this payment. Please try again, or contact us if it keeps happening.');
    }
    if (gatewayOrder.amount !== payment.amount) {
      this.log.error(`Gateway order ${gatewayOrder.id} is for ${gatewayOrder.amount} paise, payment ${payment.id} for ${payment.amount}`);
      throw new BadGatewayException('The payment service didn’t accept this payment. Please try again, or contact us if it keeps happening.');
    }

    const { count } = await this.prisma.payment.updateMany({ where: { id: payment.id, gatewayOrderId: null }, data: { gatewayOrderId: gatewayOrder.id } });
    if (count === 1) return gatewayOrder.id;
    // A concurrent call attached its gateway order first; ours is never shown to anyone and expires unpaid.
    const winner = await this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id }, select: { gatewayOrderId: true } });
    return winner.gatewayOrderId!;
  }
}

const describe = (lines: { description: string }[], plan: PaymentPlan) => {
  const what = lines.map((l) => l.description).join(', ');
  if (plan === 'FULL') return what;
  return `${plan === 'ADVANCE' ? 'Advance' : 'Balance'} · ${what}`;
};

/** Before anything is paid the plan is FULL or ADVANCE; there is no balance yet. */
function firstPaymentPlan(plan: PaymentPlan = 'FULL'): 'FULL' | 'ADVANCE' {
  if (plan === 'BALANCE') throw new ConflictException('Nothing has been paid for this order yet, so there is no balance to pay.');
  return plan;
}

/** The customer agreed to a total with the coupon; don't charge a different one without showing it. */
function assertChargeable(summary: OrderSummary) {
  if (summary.couponNotice) throw new ConflictException(`${summary.couponNotice} Check the new total before paying.`);
  if (summary.total < MIN_ONLINE_PAYMENT) throw new ConflictException('This order has nothing to pay online. Contact us and we will start it for you.');
}

/** The amount for a plan before anything is paid: the total, or the advance when every package allows one. */
function amountFor(plan: 'FULL' | 'ADVANCE', summary: OrderSummary): number {
  if (plan === 'FULL') return summary.total;
  if (!summary.advance) throw new ConflictException('This order can’t be paid in part. Pay the full amount instead.');
  return summary.advance.amount;
}
