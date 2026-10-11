import { randomBytes, randomUUID } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import {
  assertOrderInput,
  assertRefundInput,
  type CheckoutResult,
  type CreateGatewayOrderInput,
  type GatewayOrder,
  type GatewayPayment,
  type GatewayRefund,
  type GatewayRefundInput,
  type GatewayWebhookEvent,
  hmacHex,
  PaymentGateway,
  PaymentGatewayError,
  signatureMatches,
} from './payment-gateway';
import { readRazorpayWebhook } from './razorpay-gateway';

const id = (prefix: string) => `${prefix}_mock${randomBytes(7).toString('hex')}`;

/**
 * In-memory gateway for development and tests (refused in production by env validation).
 * It signs exactly like Razorpay, so signature checks run the real code path. Tests play the
 * customer with `pay()` / `fail()` and the gateway's servers with `webhook()` / `signWebhook()`.
 */
export class MockPaymentGateway extends PaymentGateway {
  readonly name = 'MOCK' as const;
  readonly checkoutKey = 'rzp_test_mock';
  readonly keySecret = 'mock-key-secret';
  readonly webhookSecret = 'mock-webhook-secret';

  readonly orders = new Map<string, GatewayOrder & { notes: Record<string, string> }>();
  readonly payments = new Map<string, GatewayPayment>();
  readonly refunds = new Map<string, GatewayRefund & { receipt?: string }>();
  /** Makes the next gateway call throw this error (e.g. to test retries). */
  failNextCall: PaymentGatewayError | null = null;

  async createOrder(input: CreateGatewayOrderInput): Promise<GatewayOrder> {
    this.throwIfFailing();
    assertOrderInput(input);
    const order = { id: id('order'), amount: input.amount, currency: 'INR' as const, receipt: input.receipt, status: 'created' as const, notes: input.notes ?? {} };
    this.orders.set(order.id, order);
    return { id: order.id, amount: order.amount, currency: order.currency, receipt: order.receipt, status: order.status };
  }

  verifyPaymentSignature({ orderId, paymentId, signature }: CheckoutResult): boolean {
    if (!orderId || !paymentId) return false;
    return signatureMatches(hmacHex(this.keySecret, `${orderId}|${paymentId}`), signature);
  }

  verifyWebhookSignature(rawBody: Buffer | string, signature: string | undefined): boolean {
    return signatureMatches(this.signWebhook(rawBody), signature);
  }

  readWebhook(rawBody: Buffer, headers: IncomingHttpHeaders): GatewayWebhookEvent | null {
    return readRazorpayWebhook(rawBody, headers, (body, signature) => this.verifyWebhookSignature(body, signature));
  }

  async fetchPayment(paymentId: string): Promise<GatewayPayment> {
    this.throwIfFailing();
    const payment = this.payments.get(paymentId);
    if (!payment) throw new PaymentGatewayError('The id provided does not exist', false, 400, 'BAD_REQUEST_ERROR');
    return { ...payment };
  }

  async refund(input: GatewayRefundInput): Promise<GatewayRefund> {
    this.throwIfFailing();
    assertRefundInput(input);
    const payment = this.payments.get(input.paymentId);
    if (!payment) throw new PaymentGatewayError('The id provided does not exist', false, 400, 'BAD_REQUEST_ERROR');
    if (payment.status !== 'captured') throw new PaymentGatewayError('Only captured payments can be refunded', false, 400, 'BAD_REQUEST_ERROR');
    const amount = input.amount ?? payment.amount - payment.amountRefunded;
    if (amount > payment.amount - payment.amountRefunded)
      throw new PaymentGatewayError('The refund amount provided is greater than amount captured', false, 400, 'BAD_REQUEST_ERROR');
    payment.amountRefunded += amount;
    if (payment.amountRefunded === payment.amount) payment.status = 'refunded';
    const refund = { id: id('rfnd'), paymentId: payment.id, amount, status: 'processed' as const, receipt: input.receipt };
    this.refunds.set(refund.id, refund);
    return { id: refund.id, paymentId: refund.paymentId, amount, status: refund.status };
  }

  /** The customer completes checkout: a captured payment and what the browser callback receives. */
  pay(orderId: string, method = 'upi'): CheckoutResult & { payment: GatewayPayment } {
    const order = this.orders.get(orderId);
    if (!order) throw new Error(`Unknown mock order ${orderId}`);
    const payment = this.addPayment(order, 'captured', method, null);
    order.status = 'paid';
    return { orderId, paymentId: payment.id, signature: hmacHex(this.keySecret, `${orderId}|${payment.id}`), payment: { ...payment } };
  }

  /** The customer's payment attempt fails (card declined, UPI timeout…). */
  fail(orderId: string, reason = 'Payment was declined by the bank', method = 'card'): GatewayPayment {
    const order = this.orders.get(orderId);
    if (!order) throw new Error(`Unknown mock order ${orderId}`);
    order.status = 'attempted';
    return { ...this.addPayment(order, 'failed', method, reason) };
  }

  /** The `X-Razorpay-Signature` header the gateway would send with this body. */
  signWebhook(rawBody: Buffer | string): string {
    return hmacHex(this.webhookSecret, rawBody);
  }

  /**
   * The webhook Razorpay would send about `payment` (from `pay()` / `fail()`): the exact body bytes and
   * headers, signed. Pass the same `eventId` to play a redelivery.
   */
  webhook(event: string, payment: GatewayPayment, eventId = `evt_mock${randomUUID().replace(/-/g, '').slice(0, 14)}`) {
    const entity = {
      id: payment.id,
      entity: 'payment',
      amount: payment.amount,
      currency: payment.currency,
      status: payment.status,
      order_id: payment.orderId,
      method: payment.method,
      amount_refunded: payment.amountRefunded,
      captured: payment.status === 'captured',
      error_description: payment.failureReason,
      created_at: Math.floor(payment.createdAt.getTime() / 1000),
    };
    const body = JSON.stringify({ entity: 'event', account_id: 'acc_mock', event, contains: ['payment'], payload: { payment: { entity } }, created_at: Math.floor(Date.now() / 1000) });
    return { body, headers: { 'content-type': 'application/json', 'x-razorpay-signature': this.signWebhook(body), 'x-razorpay-event-id': eventId } };
  }

  reset(): void {
    this.orders.clear();
    this.payments.clear();
    this.refunds.clear();
    this.failNextCall = null;
  }

  private addPayment(order: GatewayOrder, status: GatewayPayment['status'], method: string, failureReason: string | null): GatewayPayment {
    const payment: GatewayPayment = { id: id('pay'), orderId: order.id, amount: order.amount, amountRefunded: 0, currency: 'INR', status, method, failureReason, createdAt: new Date() };
    this.payments.set(payment.id, payment);
    return payment;
  }

  private throwIfFailing(): void {
    const err = this.failNextCall;
    if (err) {
      this.failNextCall = null;
      throw err;
    }
  }
}
