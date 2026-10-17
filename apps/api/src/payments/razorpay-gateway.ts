import type { IncomingHttpHeaders } from 'node:http';
import {
  assertOrderInput,
  assertRefundInput,
  type CheckoutResult,
  type CreateGatewayOrderInput,
  type GatewayOrder,
  type GatewayPayment,
  type GatewayPaymentStatus,
  type GatewayRefund,
  type GatewayRefundInput,
  type GatewayWebhookEvent,
  hmacHex,
  PaymentGateway,
  PaymentGatewayError,
  signatureMatches,
} from './payment-gateway';

export interface RazorpayConfig {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  /** Overridable for tests. */
  baseUrl?: string;
  timeoutMs?: number;
}

/** The fields we read from Razorpay's payment entity (REST answers and webhook payloads). */
export interface RazorpayPayment {
  id: string;
  order_id: string | null;
  amount: number;
  amount_refunded: number;
  currency: string;
  status: GatewayPaymentStatus;
  method: string | null;
  error_description: string | null;
  created_at: number;
}

/** The fields we read from Razorpay's refund entity (REST answers and `refund.*` webhook payloads). */
export interface RazorpayRefund {
  id: string;
  payment_id: string;
  amount: number;
  status: GatewayRefund['status'];
  receipt?: string | null;
  notes?: Record<string, string> | unknown[];
  error_description?: string | null;
}

/** Only ids made of these characters are put into a URL path. */
const SAFE_ID = /^[A-Za-z0-9_]+$/;

/**
 * Razorpay over its REST API (no SDK): Basic auth with the key id/secret, JSON bodies,
 * amounts in paise. Signatures are hex HMAC-SHA256 — `order_id|payment_id` with the key secret
 * for checkout, the raw body with the webhook secret for webhooks.
 */
export class RazorpayGateway extends PaymentGateway {
  readonly name = 'RAZORPAY' as const;
  readonly checkoutKey: string;
  private readonly auth: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(private readonly config: RazorpayConfig) {
    super();
    this.checkoutKey = config.keyId;
    this.auth = `Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`).toString('base64')}`;
    this.baseUrl = (config.baseUrl ?? 'https://api.razorpay.com').replace(/\/$/, '');
    this.timeoutMs = config.timeoutMs ?? 15_000;
  }

  async createOrder(input: CreateGatewayOrderInput): Promise<GatewayOrder> {
    assertOrderInput(input);
    const order = await this.request<{ id: string; amount: number; currency: 'INR'; receipt: string | null; status: GatewayOrder['status'] }>(
      'POST',
      '/v1/orders',
      { amount: input.amount, currency: 'INR', receipt: input.receipt, notes: input.notes ?? {} },
    );
    return { id: order.id, amount: order.amount, currency: order.currency, receipt: order.receipt, status: order.status };
  }

  verifyPaymentSignature({ orderId, paymentId, signature }: CheckoutResult): boolean {
    if (!orderId || !paymentId) return false;
    return signatureMatches(hmacHex(this.config.keySecret, `${orderId}|${paymentId}`), signature);
  }

  verifyWebhookSignature(rawBody: Buffer | string, signature: string | undefined): boolean {
    return signatureMatches(hmacHex(this.config.webhookSecret, rawBody), signature);
  }

  readWebhook(rawBody: Buffer, headers: IncomingHttpHeaders): GatewayWebhookEvent | null {
    return readRazorpayWebhook(rawBody, headers, (body, signature) => this.verifyWebhookSignature(body, signature));
  }

  async fetchPayment(paymentId: string): Promise<GatewayPayment> {
    return toGatewayPayment(await this.request<RazorpayPayment>('GET', `/v1/payments/${safeId(paymentId)}`));
  }

  async refund(input: GatewayRefundInput): Promise<GatewayRefund> {
    assertRefundInput(input);
    const body: Record<string, unknown> = { notes: input.notes ?? {} };
    if (input.amount !== undefined) body.amount = input.amount;
    if (input.receipt) body.receipt = input.receipt;
    const r = await this.request<RazorpayRefund>('POST', `/v1/payments/${safeId(input.paymentId)}/refund`, body);
    return toGatewayRefund(r);
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: { authorization: this.auth, ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const timedOut = (err as Error).name === 'TimeoutError';
      throw new PaymentGatewayError(timedOut ? `Razorpay did not answer within ${this.timeoutMs / 1000} s` : 'Could not reach Razorpay', true);
    }
    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = undefined;
    }
    if (!res.ok) {
      // Razorpay errors: { error: { code, description, … } }. The description never holds secrets.
      const error = (json as { error?: { code?: string; description?: string } } | undefined)?.error;
      const retryable = res.status >= 500 || res.status === 429;
      throw new PaymentGatewayError(`Razorpay ${method} ${path.split('/').slice(0, 3).join('/')}: ${error?.description ?? `HTTP ${res.status}`}`, retryable, res.status, error?.code);
    }
    if (json === undefined) throw new PaymentGatewayError('Razorpay sent an unreadable answer', true, res.status);
    return json as T;
  }
}

export function toGatewayPayment(p: RazorpayPayment): GatewayPayment {
  return {
    id: p.id,
    orderId: p.order_id ?? null,
    amount: p.amount,
    amountRefunded: p.amount_refunded ?? 0,
    currency: p.currency,
    status: p.status,
    method: p.method ?? null,
    failureReason: p.status === 'failed' ? (p.error_description ?? 'Payment failed') : null,
    createdAt: new Date(p.created_at * 1000),
  };
}

export function toGatewayRefund(r: RazorpayRefund): GatewayRefund {
  // Razorpay sends empty notes as `[]`.
  const notes = r.notes && !Array.isArray(r.notes) ? (r.notes as Record<string, string>) : {};
  return { id: r.id, paymentId: r.payment_id, amount: r.amount, status: r.status, receipt: r.receipt ?? null, notes, failureReason: r.error_description ?? null };
}

const header = (headers: IncomingHttpHeaders, name: string) => {
  const v = headers[name];
  return Array.isArray(v) ? v[0] : v;
};

/**
 * Razorpay webhooks: `X-Razorpay-Signature` is the webhook-secret HMAC of the raw body and
 * `X-Razorpay-Event-Id` is repeated on every redelivery. The body is
 * `{ event, payload: { payment?: { entity }, refund?: { entity } }, created_at, … }`.
 */
export function readRazorpayWebhook(
  rawBody: Buffer,
  headers: IncomingHttpHeaders,
  verify: (rawBody: Buffer, signature: string | undefined) => boolean,
): GatewayWebhookEvent | null {
  if (!verify(rawBody, header(headers, 'x-razorpay-signature'))) return null;

  let body: { event?: unknown; payload?: { payment?: { entity?: Partial<RazorpayPayment> }; refund?: { entity?: Partial<RazorpayRefund> } } };
  try {
    body = JSON.parse(rawBody.toString('utf8'));
  } catch {
    throw new PaymentGatewayError('Webhook body is not JSON', false);
  }
  if (!body || typeof body.event !== 'string') throw new PaymentGatewayError('Webhook body has no event name', false);

  const entity = body.payload?.payment?.entity;
  const payment =
    entity && typeof entity.id === 'string' && Number.isInteger(entity.amount) && typeof entity.status === 'string'
      ? toGatewayPayment({ amount_refunded: 0, currency: 'INR', method: null, error_description: null, order_id: null, created_at: 0, ...entity } as RazorpayPayment)
      : null;
  const r = body.payload?.refund?.entity;
  const refund =
    r && typeof r.id === 'string' && typeof r.payment_id === 'string' && Number.isInteger(r.amount) && typeof r.status === 'string' ? toGatewayRefund(r as RazorpayRefund) : null;
  // Without the header (never seen from Razorpay), the event name and payment/refund id still identify it.
  const id = header(headers, 'x-razorpay-event-id') ?? `${body.event}:${refund?.id ?? payment?.id ?? hmacHex('event', rawBody)}`;
  return { id, type: body.event, payment, refund, body };
}

function safeId(id: string): string {
  if (!SAFE_ID.test(id)) throw new PaymentGatewayError('Invalid gateway id', false);
  return id;
}
