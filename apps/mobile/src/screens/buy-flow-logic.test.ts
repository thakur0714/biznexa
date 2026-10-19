import { describe, expect, it } from 'vitest';
import { formSchema } from '@biznexa/types';
import { isPaymentConfirmed, nextBuyFlowStep, validateWholeForm } from './buy-flow-logic';

const form = formSchema.parse({ steps: [
  { title: 'Contact', fields: [{ name: 'email', label: 'Email', type: 'email', required: true }] },
  { title: 'Business', fields: [{ name: 'name', label: 'Name', type: 'text', required: true, minLength: 2 }] },
] });

describe('buy flow logic', () => {
  it('advances through form and documents while payment stays terminal', () => {
    expect(nextBuyFlowStep('form')).toBe('documents');
    expect(nextBuyFlowStep('documents')).toBe('payment');
    expect(nextBuyFlowStep('payment')).toBe('payment');
    expect(nextBuyFlowStep('complete')).toBe('complete');
  });

  it('uses shared M3 form validation for one step and final submit', () => {
    expect(validateWholeForm(form, {}).success).toBe(false);
    expect(validateWholeForm(form, { email: 'not-email' }).success).toBe(false);
    expect(validateWholeForm(form, { email: 'person@example.com' }).success).toBe(false);
    expect(validateWholeForm(form, { email: 'person@example.com', name: 'AB' }).success).toBe(true);
  });

  it('only treats the API PAID outcome as payment success', () => {
    const status = { outcome: 'CONFIRMING', applicationId: 'id', applicationCode: 'BN12345', applicationStatus: 'PAYMENT_PENDING', orderCode: 'ORD-2026-000001', orderStatus: 'PAYMENT_PENDING', total: 100, amountPaid: 0, balance: 100, payment: null } as const;
    expect(isPaymentConfirmed(status)).toBe(false);
    expect(isPaymentConfirmed({ ...status, outcome: 'PAID', orderStatus: 'PAID' })).toBe(true);
  });
});
