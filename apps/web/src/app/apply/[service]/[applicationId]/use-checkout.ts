'use client';

import { useCallback, useState } from 'react';
import type { PaymentCheckout } from '@biznexa/types';
import { ClientApiError } from '@biznexa/api-client/browser';
import { useApi } from '@biznexa/api-client/react';
import { openRazorpayCheckout, type RazorpaySuccess } from '@/lib/razorpay';

/** idle → starting (API call) → open (Checkout showing) → confirming (Checkout reported success); `mock` in dev/test. */
export type PayState = 'idle' | 'starting' | 'open' | 'confirming' | 'mock';

/**
 * "Pay" and "Try again" (M3.16, M3.18): asks the API to start (or reuse) the payment and opens Razorpay
 * Checkout for it. When Checkout reports success, the signed result is sent to the callback endpoint — only
 * so the payment shows as "confirming"; the order is paid by the webhook — and `onConfirming` runs even if
 * that call fails. API errors are passed to `onError` for the page to explain.
 */
export function useCheckout(
  applicationId: string,
  { onStarted, onConfirming, onError }: { onStarted?: (c: PaymentCheckout) => void | Promise<void>; onConfirming: () => void; onError?: (e: unknown) => void | Promise<void> },
) {
  const api = useApi();
  const [state, setState] = useState<PayState>('idle');
  const [error, setError] = useState('');
  const [checkout, setCheckout] = useState<PaymentCheckout | null>(null);

  const confirm = useCallback(
    async (c: PaymentCheckout, r: RazorpaySuccess) => {
      setState('confirming');
      setError('');
      try {
        await api.call((cl) =>
          cl.POST('/api/applications/{id}/payment/callback', {
            params: { path: { id: applicationId } },
            body: { paymentId: c.paymentId, gatewayOrderId: r.razorpay_order_id, gatewayPaymentId: r.razorpay_payment_id, signature: r.razorpay_signature },
          }),
        );
      } catch {
        // Only a hint: the webhook confirms the payment whether or not this reached us.
      }
      onConfirming();
    },
    [api, applicationId, onConfirming],
  );

  const pay = useCallback(async () => {
    setError('');
    setState('starting');
    try {
      const c = await api.call<PaymentCheckout>((cl) => cl.POST('/api/applications/{id}/payment', { params: { path: { id: applicationId } }, body: {} }));
      setCheckout(c);
      await onStarted?.(c);
      if (c.gateway === 'MOCK') return setState('mock');
      setState('open');
      await openRazorpayCheckout(c, {
        onSuccess: (r) => void confirm(c, r),
        onDismiss: () => setState((s) => (s === 'open' ? 'idle' : s)),
        onFailure: (message) => setError(`${message} You can try again or choose another method.`),
      });
    } catch (err) {
      setState('idle');
      await onError?.(err);
      setError(err instanceof ClientApiError || err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    }
  }, [api, applicationId, confirm, onStarted, onError]);

  return { pay, state, error, checkout };
}
