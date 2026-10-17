'use client';

import { useState, type FormEvent } from 'react';
import { formatINR, MIN_REFUND_PAISE, type AdminPaymentDetail, type RefundView } from '@biznexa/types';
import { Button, Dialog, Field, Notice, TextArea } from '@biznexa/ui';
import { useApi } from '@biznexa/api-client/react';

/** Refund amounts are shown to the paisa when they have paise (₹1,250.50, not ₹1,251). */
export const money = (paise: number) => formatINR(paise, paise % 100 !== 0);

export type RefundMode = 'full' | 'partial';
export interface RefundFormValues {
  mode: RefundMode;
  /** Rupees as typed, for a partial refund. */
  amount: string;
  reason: string;
}

/** `1,234.50` → 123450 paise; NaN when it isn't an amount with at most 2 decimals. */
export function rupeesToPaise(value: string): number {
  const v = value.replace(/[₹,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return NaN;
  return Math.round(Number(v) * 100);
}

/** The amount to refund in paise and the form's errors, checked with the API's rules before sending. */
export function checkRefundForm(values: RefundFormValues, refundable: number): { amount: number; errors: Partial<Record<'amount' | 'reason', string>> } {
  const errors: Partial<Record<'amount' | 'reason', string>> = {};
  const amount = values.mode === 'full' ? refundable : rupeesToPaise(values.amount);
  if (values.mode === 'partial') {
    if (!values.amount.trim()) errors.amount = 'Enter the amount to refund';
    else if (Number.isNaN(amount)) errors.amount = 'Enter an amount in rupees, like 1500 or 1500.50';
    else if (amount < MIN_REFUND_PAISE) errors.amount = 'The smallest refund is ₹1';
    else if (amount > refundable) errors.amount = `At most ${money(refundable)} can be refunded`;
  }
  const reason = values.reason.trim();
  if (reason.length < 3) errors.reason = 'Please give a reason (at least 3 characters)';
  else if (reason.length > 500) errors.reason = 'Keep the reason under 500 characters';
  return { amount, errors };
}

/**
 * Full or partial refund of a payment (M4.13). One Idempotency-Key per opening of the dialog (mount it with a
 * new React `key` each time), so pressing "Refund" again after a lost answer can't refund twice; reopening
 * the dialog starts a new refund.
 */
export function RefundDialog({ payment, open, onClose, onRefunded }: { payment: AdminPaymentDetail; open: boolean; onClose: () => void; onRefunded: (refund: RefundView) => void }) {
  const api = useApi();
  const [values, setValues] = useState<RefundFormValues>({ mode: 'full', amount: '', reason: '' });
  const [errors, setErrors] = useState<Partial<Record<'amount' | 'reason', string>>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // The parent remounts the dialog (a new `key`) each time it opens, so each opening gets a fresh key.
  const [key] = useState(() => crypto.randomUUID());

  const refundable = payment.refundable;
  const set = (patch: Partial<RefundFormValues>) => setValues((v) => ({ ...v, ...patch }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const checked = checkRefundForm(values, refundable);
    setErrors(checked.errors);
    if (Object.keys(checked.errors).length) return;
    setSaving(true);
    setServerError(null);
    try {
      const refund = await api.call<RefundView>((c) =>
        c.POST('/api/admin/payments/{id}/refunds', {
          params: { path: { id: payment.id }, header: { 'Idempotency-Key': key } },
          body: { amount: checked.amount, reason: values.reason.trim() },
        }),
      );
      onRefunded(refund);
    } catch (err) {
      setServerError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const { amount } = checkRefundForm(values, refundable);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Refund payment"
      description={`Paid ${money(payment.amount)} · up to ${money(refundable)} can be refunded.`}
      footer={
        <>
          <Button variant="ghost" type="button" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="refund-form" disabled={saving}>
            {saving ? 'Refunding…' : Number.isFinite(amount) && amount > 0 ? `Refund ${money(amount)}` : 'Refund'}
          </Button>
        </>
      }
    >
      <form id="refund-form" onSubmit={submit} noValidate className="space-y-4 py-2">
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-night">Amount</legend>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="refund-mode" checked={values.mode === 'full'} onChange={() => set({ mode: 'full' })} />
            Full refund of what is left ({money(refundable)})
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="refund-mode" checked={values.mode === 'partial'} onChange={() => set({ mode: 'partial' })} />
            Partial refund
          </label>
        </fieldset>
        {values.mode === 'partial' && (
          <Field
            id="refund-amount"
            label="Amount to refund (₹)"
            inputMode="decimal"
            value={values.amount}
            onChange={(e) => set({ amount: e.target.value })}
            error={errors.amount}
            hint="GST and government fees are refunded in proportion; the credit note shows the split."
          />
        )}
        <TextArea id="refund-reason" label="Reason" value={values.reason} onChange={(e) => set({ reason: e.target.value })} error={errors.reason} hint="Kept in the audit log and printed on the credit note." />
        {serverError && <Notice tone="error">{serverError}</Notice>}
      </form>
    </Dialog>
  );
}
