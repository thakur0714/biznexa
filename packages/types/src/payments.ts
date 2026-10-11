/**
 * Starting an online payment (M3.16). The API charges the total it computes itself (the order summary,
 * D40); the request carries no amounts, so `startPaymentInput` accepts an empty body only.
 */
import { z } from 'zod';

/** `POST /api/applications/:id/payment` body: none, or `{}`. Any field (an amount, a coupon…) is refused with a 400. */
export const startPaymentInput = z.preprocess((body) => body ?? {}, z.object({}).strict());
export type StartPaymentInput = z.input<typeof startPaymentInput>;

export const PAYMENT_GATEWAYS = ['RAZORPAY', 'MOCK'] as const;

/** What the browser needs to open the gateway's checkout for this payment. */
export const paymentCheckoutSchema = z.object({
  /** Our `Payment` id (also the gateway order's `receipt`). */
  paymentId: z.string().uuid(),
  /** `MOCK` in development and tests: no real checkout can open. */
  gateway: z.enum(PAYMENT_GATEWAYS),
  /** Public key for the checkout (never the secret). */
  key: z.string(),
  gatewayOrderId: z.string(),
  /** Integer paise: the order total computed by the server. */
  amount: z.number().int().positive(),
  currency: z.literal('INR'),
  applicationId: z.string().uuid(),
  applicationCode: z.string(),
  orderCode: z.string(),
  /** Shown in the checkout, e.g. "GST Registration — Basic". */
  description: z.string(),
  /** Fills the checkout's contact fields from the customer's account. */
  prefill: z.object({ name: z.string().nullable(), email: z.string().nullable(), contact: z.string().nullable() }),
});
export type PaymentCheckout = z.infer<typeof paymentCheckoutSchema>;

/**
 * `POST /api/applications/:id/payment/callback` body (M3.18): what Razorpay Checkout's `handler` received.
 * Only a hint that the customer finished checkout — a valid signature moves the payment CREATED → PENDING
 * ("confirming"); it is **never** marked paid here. Only the signed webhook does that (PROMPT §7.5, D44).
 */
export const paymentCallbackInput = z
  .object({
    paymentId: z.string().uuid(),
    gatewayOrderId: z.string().min(1).max(64),
    gatewayPaymentId: z.string().min(1).max(64),
    signature: z.string().min(1).max(256),
  })
  .strict();
export type PaymentCallbackInput = z.infer<typeof paymentCallbackInput>;

export const PAYMENT_STATUSES = ['CREATED', 'PENDING', 'SUCCESS', 'FAILED', 'REFUND_INITIATED', 'REFUNDED', 'PARTIALLY_REFUNDED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/**
 * Where an application's payment stands, for the payment page (M3.18):
 * - `UNPAID` — payment not started (still a draft);
 * - `AWAITING` — a payment is open but checkout hasn't reported back (or the customer closed it);
 * - `CONFIRMING` — checkout reported success; waiting for the gateway's webhook;
 * - `FAILED` — the last attempt failed; the customer can try again;
 * - `PAID` — the webhook confirmed the money (order PAID / PARTIALLY_PAID);
 * - `CLOSED` — cancelled or refunded: nothing to pay online.
 */
export const PAYMENT_OUTCOMES = ['UNPAID', 'AWAITING', 'CONFIRMING', 'FAILED', 'PAID', 'CLOSED'] as const;
export type PaymentOutcome = (typeof PAYMENT_OUTCOMES)[number];

/** The outcome from the order's status and its latest payment's status. The order wins: it only becomes PAID through the webhook. */
export function paymentOutcome(orderStatus: string, latestPayment: PaymentStatus | null): PaymentOutcome {
  if (orderStatus === 'PAID' || orderStatus === 'PARTIALLY_PAID') return 'PAID';
  if (orderStatus === 'CREATED') return 'UNPAID';
  if (orderStatus !== 'PAYMENT_PENDING') return 'CLOSED';
  if (latestPayment === 'FAILED') return 'FAILED';
  // SUCCESS while the order is still pending can't last: the webhook pays both in one transaction.
  if (latestPayment === 'PENDING' || latestPayment === 'SUCCESS') return 'CONFIRMING';
  return 'AWAITING';
}

/** `GET /api/applications/:id/payment` and the callback's response: what the payment page polls. */
export const paymentStatusSchema = z.object({
  outcome: z.enum(PAYMENT_OUTCOMES),
  applicationId: z.string().uuid(),
  applicationCode: z.string(),
  applicationStatus: z.string(),
  orderCode: z.string(),
  orderStatus: z.string(),
  /** Integer paise. */
  total: z.number().int(),
  amountPaid: z.number().int(),
  /** The order's latest payment (none before "Pay"). */
  payment: z
    .object({
      id: z.string().uuid(),
      status: z.enum(PAYMENT_STATUSES),
      amount: z.number().int(),
      method: z.string().nullable(),
      /** The gateway's reason, for a failed attempt. */
      failureReason: z.string().nullable(),
      paidAt: z.string().datetime().nullable(),
    })
    .nullable(),
});
export type PaymentStatusView = z.infer<typeof paymentStatusSchema>;
