import { describe, expect, it } from 'vitest';
import {
  adminPaymentListQuerySchema,
  attemptPlan,
  currentAttempt,
  customerPaymentListQuerySchema,
  customerPaymentListResponseSchema,
  customerPaymentRowSchema,
  paymentCallbackInput,
  paymentCheckoutSchema,
  paymentOutcome,
  startPaymentInput,
} from './payments';

describe('startPaymentInput', () => {
  it('accepts no body or an empty one', () => {
    expect(startPaymentInput.safeParse(undefined).success).toBe(true);
    expect(startPaymentInput.safeParse({}).success).toBe(true);
  });

  it('takes a plan, never an amount', () => {
    for (const plan of ['FULL', 'ADVANCE', 'BALANCE']) expect(startPaymentInput.safeParse({ plan }).success).toBe(true);
    expect(startPaymentInput.safeParse({ plan: 'HALF' }).success).toBe(false);
    expect(startPaymentInput.safeParse({ plan: 'ADVANCE', amount: 100 }).success).toBe(false);
  });

  it('refuses any field, so a client cannot send an amount', () => {
    for (const body of [{ amount: 100 }, { total: 1 }, { couponId: 'x' }, { gatewayOrderId: 'order_1' }]) {
      expect(startPaymentInput.safeParse(body).success).toBe(false);
    }
  });
});

describe('paymentCheckoutSchema', () => {
  const ok = {
    paymentId: '6f1c1b8e-6d0e-4a59-9b1e-3f1a2b3c4d5e',
    gateway: 'RAZORPAY',
    key: 'rzp_test_x',
    gatewayOrderId: 'order_1',
    amount: 568000,
    plan: 'FULL',
    currency: 'INR',
    applicationId: '6f1c1b8e-6d0e-4a59-9b1e-3f1a2b3c4d5f',
    applicationCode: 'BN10025',
    orderCode: 'ORD-2026-000001',
    description: 'GST Registration — Basic',
    prefill: { name: 'A', email: null, contact: null },
  };

  it('accepts a checkout and refuses non-paise or zero amounts', () => {
    expect(paymentCheckoutSchema.safeParse(ok).success).toBe(true);
    expect(paymentCheckoutSchema.safeParse({ ...ok, amount: 10.5 }).success).toBe(false);
    expect(paymentCheckoutSchema.safeParse({ ...ok, amount: 0 }).success).toBe(false);
    expect(paymentCheckoutSchema.safeParse({ ...ok, currency: 'USD' }).success).toBe(false);
  });
});

describe('paymentCallbackInput', () => {
  const ok = { paymentId: '6f1c1b8e-6d0e-4a59-9b1e-3f1a2b3c4d5e', gatewayOrderId: 'order_1', gatewayPaymentId: 'pay_1', signature: 'abc' };

  it('accepts what Checkout hands back', () => {
    expect(paymentCallbackInput.safeParse(ok).success).toBe(true);
  });

  it('refuses missing ids and any extra field (no amounts, no statuses)', () => {
    expect(paymentCallbackInput.safeParse({ ...ok, signature: '' }).success).toBe(false);
    expect(paymentCallbackInput.safeParse({ ...ok, paymentId: 'nope' }).success).toBe(false);
    expect(paymentCallbackInput.safeParse({ ...ok, status: 'SUCCESS' }).success).toBe(false);
    expect(paymentCallbackInput.safeParse({ ...ok, amount: 100 }).success).toBe(false);
  });
});

describe('paymentOutcome', () => {
  it('is PAID only when the order is paid, whatever the payment says', () => {
    expect(paymentOutcome('PAID', 'SUCCESS')).toBe('PAID');
    expect(paymentOutcome('PARTIALLY_PAID', 'SUCCESS')).toBe('PAID');
    // A later capture in the same checkout pays the order even though an earlier attempt failed.
    expect(paymentOutcome('PAID', 'FAILED')).toBe('PAID');
    expect(paymentOutcome('PAYMENT_PENDING', 'SUCCESS')).toBe('CONFIRMING');
  });

  it('follows the latest payment while payment is pending', () => {
    expect(paymentOutcome('PAYMENT_PENDING', null)).toBe('AWAITING');
    expect(paymentOutcome('PAYMENT_PENDING', 'CREATED')).toBe('AWAITING');
    expect(paymentOutcome('PAYMENT_PENDING', 'PENDING')).toBe('CONFIRMING');
    expect(paymentOutcome('PAYMENT_PENDING', 'FAILED')).toBe('FAILED');
  });

  it('is UNPAID for a draft order and CLOSED for cancelled or refunded ones', () => {
    expect(paymentOutcome('CREATED', null)).toBe('UNPAID');
    expect(paymentOutcome('CANCELLED', 'FAILED')).toBe('CLOSED');
    expect(paymentOutcome('REFUNDED', 'REFUNDED')).toBe('CLOSED');
  });
});

describe('part payments: outcome and current attempt (M3.19)', () => {
  const at = (min: number) => new Date(Date.UTC(2026, 9, 11, 10, min));
  const pay = (status: Parameters<typeof attemptPlan>[0]['status'], amount: number, min: number) => ({ status, amount, createdAt: at(min) });
  const partly = { status: 'PARTIALLY_PAID', total: 100000, amountPaid: 60000 };

  it('after an advance: PAID with no balance attempt, else follows the balance attempt', () => {
    expect(paymentOutcome('PARTIALLY_PAID', null)).toBe('PAID');
    expect(paymentOutcome('PARTIALLY_PAID', 'SUCCESS')).toBe('PAID');
    expect(paymentOutcome('PARTIALLY_PAID', 'CREATED')).toBe('AWAITING');
    expect(paymentOutcome('PARTIALLY_PAID', 'PENDING')).toBe('CONFIRMING');
    expect(paymentOutcome('PARTIALLY_PAID', 'FAILED')).toBe('FAILED');
  });

  it('picks the latest payment while nothing is paid', () => {
    const list = [pay('CREATED', 60000, 3), pay('FAILED', 100000, 2)];
    expect(currentAttempt({ status: 'PAYMENT_PENDING', total: 100000, amountPaid: 0 }, list)).toBe(list[0]);
    expect(currentAttempt({ status: 'PAYMENT_PENDING', total: 100000, amountPaid: 0 }, [])).toBeNull();
  });

  it('after an advance: the latest balance-sized attempt made after it, else the advance itself', () => {
    const advance = pay('SUCCESS', 60000, 2);
    // A window for the full amount opened before the advance was paid is dead.
    const deadFull = pay('CREATED', 100000, 1);
    expect(currentAttempt(partly, [advance, deadFull])).toBe(advance);
    const balance = pay('FAILED', 40000, 3);
    expect(currentAttempt(partly, [balance, advance, deadFull])).toBe(balance);
    const retry = pay('CREATED', 40000, 4);
    expect(currentAttempt(partly, [retry, balance, advance])).toBe(retry);
    // An unpaid payment of the balance's size from before the advance doesn't count.
    expect(currentAttempt(partly, [advance, pay('CREATED', 40000, 1)])).toBe(advance);
  });

  it('says what an unpaid attempt was for', () => {
    expect(attemptPlan({ status: 'FAILED', amount: 100000 }, { total: 100000, amountPaid: 0 })).toBe('FULL');
    expect(attemptPlan({ status: 'CREATED', amount: 60000 }, { total: 100000, amountPaid: 0 })).toBe('ADVANCE');
    expect(attemptPlan({ status: 'FAILED', amount: 40000 }, { total: 100000, amountPaid: 60000 })).toBe('BALANCE');
    expect(attemptPlan({ status: 'SUCCESS', amount: 60000 }, { total: 100000, amountPaid: 60000 })).toBeNull();
  });
});

describe('adminPaymentListQuerySchema dates (M4.15)', () => {
  it('takes calendar days and refuses anything else', () => {
    expect(adminPaymentListQuerySchema.parse({ from: '2026-10-01', to: '2026-10-13' })).toMatchObject({ from: '2026-10-01', to: '2026-10-13' });
    for (const bad of ['2026-02-30', '2026-13-01', '13-10-2026', '2026-10-13T00:00:00.000Z', 'yesterday']) {
      expect(adminPaymentListQuerySchema.safeParse({ from: bad }).success).toBe(false);
    }
  });
});

describe('customer payments schemas (M5.10)', () => {
  it('validates query params and sets defaults', () => {
    expect(customerPaymentListQuerySchema.parse({})).toEqual({ page: 1, limit: 25 });
    expect(customerPaymentListQuerySchema.parse({ page: '2', limit: '10' })).toEqual({ page: 2, limit: 10 });
    expect(customerPaymentListQuerySchema.safeParse({ page: '0' }).success).toBe(false);
    expect(customerPaymentListQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
  });

  it('validates customer payment row and list response', () => {
    const validRow = {
      id: 'a0000000-0000-0000-0000-000000000001',
      amount: 50000,
      status: 'SUCCESS',
      method: 'upi',
      gateway: 'RAZORPAY',
      createdAt: '2026-10-16T12:00:00.000Z',
      order: {
        id: 'b0000000-0000-0000-0000-000000000001',
        code: 'ORD-2026-000001',
        total: 100000,
        amountPaid: 50000,
        balance: 50000,
        applicationId: 'c0000000-0000-0000-0000-000000000001',
        serviceSlug: 'gst-registration',
      },
      invoice: {
        id: 'd0000000-0000-0000-0000-000000000001',
        number: 'BN/2627/000001',
      },
      refunds: [
        {
          id: 'e0000000-0000-0000-0000-000000000001',
          amount: 25000,
          status: 'PROCESSED',
          createdAt: '2026-10-17T10:00:00.000Z',
          processedAt: '2026-10-17T11:00:00.000Z',
          creditNote: { id: 'f0000000-0000-0000-0000-000000000001', number: 'CN/2627/000001', issuedAt: '2026-10-17T11:00:00.000Z', pdfReady: true },
        },
      ],
    };
    expect(customerPaymentRowSchema.safeParse(validRow).success).toBe(true);
    expect(
      customerPaymentListResponseSchema.safeParse({
        items: [validRow],
        total: 1,
        page: 1,
        limit: 25,
        totalPaid: 50000,
        outstandingBalance: 50000,
      }).success,
    ).toBe(true);
  });
});

