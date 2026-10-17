import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';

/** Name stored in `Payment.gateway`. */
export type GatewayName = 'RAZORPAY' | 'MOCK';

export interface CreateGatewayOrderInput {
  /** Integer paise, at least 100 (₹1, the gateways' minimum). */
  amount: number;
  /** Our reference shown in the gateway dashboard, e.g. the `Payment` id (≤ 40 chars). */
  receipt: string;
  /** Up to 15 short key/value pairs kept on the gateway order (no PII). */
  notes?: Record<string, string>;
}

export interface GatewayOrder {
  id: string;
  amount: number;
  currency: 'INR';
  receipt: string | null;
  status: 'created' | 'attempted' | 'paid';
}

/**
 * Normalised payment state:
 * `created` (not attempted yet), `authorized` (money blocked, not captured), `captured` (paid),
 * `failed`, `refunded` (fully). A partly refunded payment stays `captured` with `amountRefunded > 0`.
 */
export type GatewayPaymentStatus = 'created' | 'authorized' | 'captured' | 'failed' | 'refunded';

export interface GatewayPayment {
  id: string;
  orderId: string | null;
  amount: number;
  amountRefunded: number;
  currency: string;
  status: GatewayPaymentStatus;
  /** upi, card, netbanking, wallet… */
  method: string | null;
  /** Gateway's reason for a failed payment, safe to show the customer. */
  failureReason: string | null;
  createdAt: Date;
}

export interface GatewayRefundInput {
  paymentId: string;
  /** Integer paise; the whole captured amount when left out. */
  amount?: number;
  /** Our reference, e.g. the `Refund` id, so gateway refunds can be matched back. */
  receipt?: string;
  notes?: Record<string, string>;
}

export interface GatewayRefund {
  id: string;
  paymentId: string;
  amount: number;
  status: 'pending' | 'processed' | 'failed';
  /** What we sent as `receipt` (our `Refund` id), when the gateway echoes it. */
  receipt?: string | null;
  notes?: Record<string, string>;
  /** The gateway's reason for a failed refund. */
  failureReason?: string | null;
}

/** A webhook whose signature passed, normalised. */
export interface GatewayWebhookEvent {
  /** Unique per event; every redelivery of the event repeats it. */
  id: string;
  /** The gateway's event name, e.g. `payment.captured`, `payment.failed`. */
  type: string;
  /** The payment the event is about, when it is about one. */
  payment: GatewayPayment | null;
  /** The refund a `refund.*` event is about (M4.13). */
  refund: GatewayRefund | null;
  /** The parsed body, to store as received. */
  body: unknown;
}

/** The values the checkout hands back to the browser after a payment. */
export interface CheckoutResult {
  orderId: string;
  paymentId: string;
  signature: string;
}

/**
 * A call to the gateway failed. `retryable` is true for network errors, timeouts and 5xx/429
 * (try again later); false when the gateway refused the request (bad id, amount too high…).
 * `message` never contains secrets and is safe to log.
 */
export class PaymentGatewayError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'PaymentGatewayError';
  }
}

/**
 * Online payments (PROMPT §10 Extensibility, D42). Business logic only talks to this interface,
 * so another gateway can be added later without touching orders, bookings or refunds.
 * Amounts are always integer paise in INR.
 *
 * A payment is confirmed only by a webhook whose signature passes `verifyWebhookSignature`;
 * `verifyPaymentSignature` merely tells the browser's callback the result is genuine (PROMPT §7.5).
 */
export abstract class PaymentGateway {
  abstract readonly name: GatewayName;
  /** Public key the browser/app checkout needs (never the secret). */
  abstract readonly checkoutKey: string;

  abstract createOrder(input: CreateGatewayOrderInput): Promise<GatewayOrder>;
  /** Checkout callback: does `signature` prove the gateway reported this payment for this order? */
  abstract verifyPaymentSignature(result: CheckoutResult): boolean;
  /** Webhook: `rawBody` must be the exact bytes received, not re-serialised JSON. */
  abstract verifyWebhookSignature(rawBody: Buffer | string, signature: string | undefined): boolean;
  /**
   * Webhook endpoint: checks the signature header over the exact bytes received and reads the event.
   * Returns null when the signature is missing or wrong; throws `PaymentGatewayError` (not retryable)
   * for a signed body it cannot read.
   */
  abstract readWebhook(rawBody: Buffer, headers: IncomingHttpHeaders): GatewayWebhookEvent | null;
  abstract fetchPayment(paymentId: string): Promise<GatewayPayment>;
  abstract refund(input: GatewayRefundInput): Promise<GatewayRefund>;
}

/** Checks gateway-independent rules before any network call, so every driver refuses the same input. */
export function assertOrderInput(input: CreateGatewayOrderInput): void {
  if (!Number.isInteger(input.amount) || input.amount < 100) throw new PaymentGatewayError('Amount must be whole paise, at least ₹1', false);
  if (!input.receipt || input.receipt.length > 40) throw new PaymentGatewayError('Receipt must be 1–40 characters', false);
  if (input.notes && Object.keys(input.notes).length > 15) throw new PaymentGatewayError('At most 15 notes', false);
}

export function assertRefundInput(input: GatewayRefundInput): void {
  if (!input.paymentId) throw new PaymentGatewayError('Payment id is required', false);
  if (input.amount !== undefined && (!Number.isInteger(input.amount) || input.amount < 100))
    throw new PaymentGatewayError('Refund amount must be whole paise, at least ₹1', false);
}

/** Hex HMAC-SHA256, the scheme Razorpay uses for both checkout and webhook signatures. */
export function hmacHex(secret: string, data: Buffer | string): string {
  return createHmac('sha256', secret).update(data).digest('hex');
}

/** Constant-time comparison of a received hex signature with the expected one. */
export function signatureMatches(expectedHex: string, received: string | undefined): boolean {
  if (!received || !/^[0-9a-f]+$/i.test(received)) return false;
  const a = Buffer.from(expectedHex, 'hex');
  const b = Buffer.from(received, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
