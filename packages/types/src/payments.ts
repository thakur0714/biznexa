/**
 * Starting an online payment (M3.16). The API charges the total it computes itself (the order summary,
 * D40); the request carries no amounts, so `startPaymentInput` accepts an empty body only.
 */
import { z } from 'zod';

/**
 * What a payment is for (M3.19): the whole order, the advance of a package that allows part payment, or
 * the balance after the advance. The server works out the amount for each; the client never sends one.
 */
export const PAYMENT_PLANS = ['FULL', 'ADVANCE', 'BALANCE'] as const;
export type PaymentPlan = (typeof PAYMENT_PLANS)[number];

/**
 * `POST /api/applications/:id/payment` body: none, `{}`, or `{ plan }`. Without a plan the balance is paid
 * when an advance has been, else the full amount. Any other field (an amount, a coupon…) is refused with a 400.
 */
export const startPaymentInput = z.preprocess((body) => body ?? {}, z.object({ plan: z.enum(PAYMENT_PLANS).optional() }).strict());
export type StartPaymentInput = z.output<typeof startPaymentInput>;

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
  /** Integer paise, computed by the server: the order total, the advance or the balance (`plan`). */
  amount: z.number().int().positive(),
  plan: z.enum(PAYMENT_PLANS),
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
 * - `PAID` — the webhook confirmed the money (order PAID, or PARTIALLY_PAID with no balance payment under way);
 * - `CLOSED` — cancelled or refunded: nothing to pay online.
 */
export const PAYMENT_OUTCOMES = ['UNPAID', 'AWAITING', 'CONFIRMING', 'FAILED', 'PAID', 'CLOSED'] as const;
export type PaymentOutcome = (typeof PAYMENT_OUTCOMES)[number];

/** Payment statuses that mean the money was taken (refunds come later). */
export const SUCCEEDED_PAYMENT_STATUSES: readonly PaymentStatus[] = ['SUCCESS', 'REFUND_INITIATED', 'REFUNDED', 'PARTIALLY_REFUNDED'];
const succeeded = (s: PaymentStatus) => SUCCEEDED_PAYMENT_STATUSES.includes(s);

/**
 * The outcome from the order's status and the status of its current attempt (`currentAttempt`). The order
 * wins: it only becomes PAID / PARTIALLY_PAID through the webhook. After an advance, a balance attempt
 * under way is reported like any other attempt; with none, the outcome is `PAID` (the advance).
 */
export function paymentOutcome(orderStatus: string, attempt: PaymentStatus | null): PaymentOutcome {
  if (orderStatus === 'PAID') return 'PAID';
  if (orderStatus === 'CREATED') return 'UNPAID';
  if (orderStatus === 'PARTIALLY_PAID' && (attempt === null || succeeded(attempt))) return 'PAID';
  if (orderStatus !== 'PAYMENT_PENDING' && orderStatus !== 'PARTIALLY_PAID') return 'CLOSED';
  if (attempt === 'FAILED') return 'FAILED';
  // SUCCESS while the order is still pending can't last: the webhook pays both in one transaction.
  if (attempt === 'PENDING' || (attempt !== null && succeeded(attempt))) return 'CONFIRMING';
  return 'AWAITING';
}

/**
 * The payment the page should talk about, from the order's payments **newest first**: the latest one,
 * except after an advance, where it is the latest unpaid attempt **for the balance** made after the last
 * successful payment (an old window for another amount is dead), else that successful payment.
 */
export function currentAttempt<P extends { status: PaymentStatus; amount: number; createdAt: Date | string }>(
  order: { status: string; total: number; amountPaid: number },
  payments: readonly P[],
): P | null {
  if (order.status !== 'PARTIALLY_PAID') return payments[0] ?? null;
  const balance = order.total - order.amountPaid;
  const lastPaid = payments.find((p) => succeeded(p.status));
  const after = (p: P) => !lastPaid || new Date(p.createdAt).getTime() > new Date(lastPaid.createdAt).getTime();
  return payments.find((p) => !succeeded(p.status) && p.amount === balance && after(p)) ?? lastPaid ?? payments[0] ?? null;
}

/**
 * What an unpaid attempt was for, so "Try again" repeats it: the balance once something is paid, else the
 * full amount when it charges the total, else the advance. Null for a payment that went through.
 */
export function attemptPlan(payment: { status: PaymentStatus; amount: number }, order: { total: number; amountPaid: number }): PaymentPlan | null {
  if (succeeded(payment.status)) return null;
  if (order.amountPaid > 0) return 'BALANCE';
  return payment.amount === order.total ? 'FULL' : 'ADVANCE';
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
  /** `total − amountPaid`: after an advance, what is left to pay. */
  balance: z.number().int(),
  /** The current attempt (`currentAttempt`; none before "Pay"). */
  payment: z
    .object({
      id: z.string().uuid(),
      status: z.enum(PAYMENT_STATUSES),
      amount: z.number().int(),
      method: z.string().nullable(),
      /** The gateway's reason, for a failed attempt. */
      failureReason: z.string().nullable(),
      paidAt: z.string().datetime().nullable(),
      /** What an unpaid attempt was for, so "Try again" repeats it; null once it went through. */
      plan: z.enum(PAYMENT_PLANS).nullable(),
    })
    .nullable(),
});
export type PaymentStatusView = z.infer<typeof paymentStatusSchema>;

const isoDate = z.string().datetime();

const calendarDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-13')
  .refine((d) => {
    const t = Date.parse(`${d}T00:00:00Z`);
    return !Number.isNaN(t) && new Date(t).toISOString().startsWith(d); // rejects 2026-02-30 too
  }, 'Not a real date');

// ---------------------------------------------------------------------------------------------------------
// Refunds (M4.13, D53).

export const REFUND_STATUSES = ['INITIATED', 'PROCESSED', 'FAILED'] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

/** Payment statuses an admin may refund from. A refund in flight (REFUND_INITIATED) must finish first. */
export const REFUNDABLE_PAYMENT_STATUSES: readonly PaymentStatus[] = ['SUCCESS', 'PARTIALLY_REFUNDED'];

/** The gateways refuse refunds under ₹1. */
export const MIN_REFUND_PAISE = 100;

/**
 * `POST /api/admin/payments/:id/refunds` body. The amount is integer paise; the server checks it against what
 * is left to refund. The request must carry an `Idempotency-Key` header (`idempotencyKeySchema`).
 */
export const refundCreateInput = z
  .object({
    amount: z.number().int('Amount must be whole paise').min(MIN_REFUND_PAISE, 'The smallest refund is ₹1'),
    reason: z.string().trim().min(3, 'Please give a reason (at least 3 characters)').max(500, 'Keep the reason under 500 characters'),
  })
  .strict();
export type RefundCreateInput = z.infer<typeof refundCreateInput>;

/** `Idempotency-Key` header: a retried request with the same key returns the first refund instead of making another. */
export const idempotencyKeySchema = z
  .string({ required_error: 'Send an Idempotency-Key header' })
  .trim()
  .min(8, 'Idempotency-Key must be 8–100 characters')
  .max(100, 'Idempotency-Key must be 8–100 characters')
  .regex(/^[A-Za-z0-9_:.-]+$/, 'Idempotency-Key may use letters, digits and _ : . - only');

export const creditNoteSummarySchema = z.object({
  id: z.string().uuid(),
  /** `CN/2627/000001` */
  number: z.string(),
  issuedAt: isoDate,
  /** False until the PDF is generated; the download link is refused until then. */
  pdfReady: z.boolean(),
});
export type CreditNoteSummary = z.infer<typeof creditNoteSummarySchema>;

export const refundSchema = z.object({
  id: z.string().uuid(),
  amount: z.number().int(),
  reason: z.string(),
  status: z.enum(REFUND_STATUSES),
  gatewayRefundId: z.string().nullable(),
  /** Why the gateway refused or failed the refund. */
  failureReason: z.string().nullable(),
  createdAt: isoDate,
  processedAt: isoDate.nullable(),
  /** Issued when the refund is PROCESSED and the payment has an invoice. */
  creditNote: creditNoteSummarySchema.nullable(),
});
export type RefundView = z.infer<typeof refundSchema>;

/** What the customer sees of a refund: no gateway ids, no internal reason. */
export const customerRefundSchema = refundSchema.pick({ id: true, amount: true, status: true, createdAt: true, processedAt: true, creditNote: true });
export type CustomerRefundView = z.infer<typeof customerRefundSchema>;

/**
 * A payment's status from its refunds (M4.13): a refund in flight → REFUND_INITIATED; processed refunds adding
 * up to the amount → REFUNDED; some processed → PARTIALLY_REFUNDED; otherwise SUCCESS (a failed refund puts
 * the payment back where it was).
 */
export function paymentStatusAfterRefunds(amount: number, refunds: readonly { amount: number; status: RefundStatus }[]): PaymentStatus {
  if (refunds.some((r) => r.status === 'INITIATED')) return 'REFUND_INITIATED';
  const processed = refunds.filter((r) => r.status === 'PROCESSED').reduce((a, r) => a + r.amount, 0);
  if (processed >= amount) return 'REFUNDED';
  return processed > 0 ? 'PARTIALLY_REFUNDED' : 'SUCCESS';
}

/** Paise still refundable: the amount minus every refund that has not FAILED (in flight counts). */
export function refundableAmount(amount: number, refunds: readonly { amount: number; status: RefundStatus }[]): number {
  return Math.max(0, amount - refunds.filter((r) => r.status !== 'FAILED').reduce((a, r) => a + r.amount, 0));
}

export const adminPaymentListQuerySchema = z.object({
  status: z.enum(['all', 'success', 'failed', 'pending']).default('all'),
  /** Calendar days in India (YYYY-MM-DD), both inclusive. */
  from: calendarDay.optional(),
  to: calendarDay.optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type AdminPaymentListQuery = z.infer<typeof adminPaymentListQuerySchema>;

export const adminPaymentRowSchema = z.object({
  id: z.string().uuid(),
  gateway: z.string(),
  gatewayOrderId: z.string().nullable(),
  gatewayPaymentId: z.string().nullable(),
  amount: z.number().int(),
  method: z.string().nullable(),
  status: z.enum(PAYMENT_STATUSES),
  failureReason: z.string().nullable(),
  paidAt: isoDate.nullable(),
  createdAt: isoDate,
  orderCode: z.string().nullable(),
  applicationCode: z.string().nullable(),
  customerName: z.string().nullable(),
  customerEmail: z.string().nullable(),
});
export type AdminPaymentRow = z.infer<typeof adminPaymentRowSchema>;

export const adminPaymentListResponseSchema = z.object({
  items: z.array(adminPaymentRowSchema),
  total: z.number().int(),
  page: z.number().int(),
  limit: z.number().int(),
});

export const adminPaymentDetailSchema = z.object({
  id: z.string().uuid(),
  gateway: z.string(),
  gatewayOrderId: z.string().nullable(),
  gatewayPaymentId: z.string().nullable(),
  amount: z.number().int(),
  method: z.string().nullable(),
  status: z.enum(PAYMENT_STATUSES),
  failureReason: z.string().nullable(),
  paidAt: isoDate.nullable(),
  createdAt: isoDate,
  orderCode: z.string().nullable(),
  applicationCode: z.string().nullable(),
  customerName: z.string().nullable(),
  customerEmail: z.string().nullable(),
  customerMobile: z.string().nullable(),
  /** Integer paise that can still be refunded: the amount minus every refund not FAILED. 0 unless the status allows a refund. */
  refundable: z.number().int(),
  refunds: z.array(refundSchema),
  invoice: z
    .object({
      id: z.string().uuid(),
      number: z.string(),
      issuedAt: isoDate,
    })
    .nullable(),
});
export type AdminPaymentDetail = z.infer<typeof adminPaymentDetailSchema>;

export const customerPaymentListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type CustomerPaymentListQuery = z.infer<typeof customerPaymentListQuerySchema>;

export const customerPaymentRowSchema = z.object({
  id: z.string().uuid(),
  amount: z.number().int(),
  status: z.enum(PAYMENT_STATUSES),
  method: z.string().nullable(),
  gateway: z.string(),
  createdAt: isoDate,
  order: z.object({
    id: z.string().uuid(),
    code: z.string(),
    total: z.number().int(),
    amountPaid: z.number().int(),
    balance: z.number().int(),
    applicationId: z.string().uuid().nullable().optional(),
    serviceSlug: z.string().nullable().optional(),
  }),
  invoice: z
    .object({
      id: z.string().uuid(),
      number: z.string(),
    })
    .nullable(),
  /** Refunds of this payment, newest first (M4.13). */
  refunds: z.array(customerRefundSchema),
});
export type CustomerPaymentRow = z.infer<typeof customerPaymentRowSchema>;

export const customerPaymentListResponseSchema = z.object({
  items: z.array(customerPaymentRowSchema),
  total: z.number().int(),
  page: z.number().int(),
  limit: z.number().int(),
  totalPaid: z.number().int(),
  /** Refunds the gateway has processed (M4.13); `totalPaid` stays what was paid, the card shows the net. */
  totalRefunded: z.number().int(),
  outstandingBalance: z.number().int(),
});
export type CustomerPaymentListResponse = z.infer<typeof customerPaymentListResponseSchema>;

/**
 * `POST /api/payments/mock/{paymentId}/pay` (dev/test only, mock gateway): what Checkout's `handler` would have
 * received, after the mock gateway captured the payment and delivered its signed webhook (M8.8).
 */
export const mockPaymentResultSchema = z.object({
  gatewayOrderId: z.string(),
  gatewayPaymentId: z.string(),
  signature: z.string(),
});
export type MockPaymentResult = z.infer<typeof mockPaymentResultSchema>;
