import { describe, expect, it } from 'vitest';
import { paymentCallbackInput, paymentCheckoutSchema, paymentOutcome, startPaymentInput } from './payments';

describe('startPaymentInput', () => {
  it('accepts no body or an empty one', () => {
    expect(startPaymentInput.safeParse(undefined).success).toBe(true);
    expect(startPaymentInput.safeParse({}).success).toBe(true);
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
