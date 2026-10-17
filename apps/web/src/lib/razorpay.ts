import type { BookingCheckout, PaymentCheckout } from '@biznexa/types';

const SCRIPT_URL = 'https://checkout.razorpay.com/v1/checkout.js';

/** What Checkout hands back after a payment. Only a hint: the payment is confirmed by the webhook (PROMPT §7.5). */
export interface RazorpaySuccess {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

interface RazorpayInstance {
  open(): void;
  on(event: 'payment.failed', fn: (resp: { error: { description?: string } }) => void): void;
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance;
  }
}

let loading: Promise<void> | null = null;

/** Loads Razorpay's Checkout script once (it must come from Razorpay, not be bundled). */
function loadScript(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT_URL;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      loading = null;
      s.remove();
      reject(new Error('The payment window could not be loaded. Check your connection and try again.'));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/**
 * Opens Razorpay Checkout for a payment started by the API (M3.16; a booking's, M8.8). Every value comes from
 * the API's response; the amount is shown by Checkout but charged from the gateway order, which the server created.
 */
export async function openRazorpayCheckout(
  checkout: PaymentCheckout | BookingCheckout,
  handlers: { onSuccess: (r: RazorpaySuccess) => void; onDismiss: () => void; onFailure: (message: string) => void },
): Promise<void> {
  await loadScript();
  if (!window.Razorpay) throw new Error('The payment window could not be loaded. Try again.');
  const ref =
    'bookingCode' in checkout
      ? { code: checkout.bookingCode, notes: { bookingCode: checkout.bookingCode } }
      : { code: checkout.applicationCode, notes: { applicationCode: checkout.applicationCode, orderCode: checkout.orderCode } };
  const rzp = new window.Razorpay({
    key: checkout.key,
    order_id: checkout.gatewayOrderId,
    amount: checkout.amount,
    currency: checkout.currency,
    name: 'BizNexa',
    description: `${checkout.description} · ${ref.code}`,
    prefill: {
      ...(checkout.prefill.name && { name: checkout.prefill.name }),
      ...(checkout.prefill.email && { email: checkout.prefill.email }),
      ...(checkout.prefill.contact && { contact: checkout.prefill.contact }),
    },
    notes: ref.notes,
    handler: handlers.onSuccess,
    modal: { ondismiss: handlers.onDismiss, confirm_close: true },
  });
  // Checkout stays open after a failed attempt so the customer can try another method; just report it.
  rzp.on('payment.failed', (resp) => handlers.onFailure(resp.error.description ?? 'The payment did not go through.'));
  rzp.open();
}
