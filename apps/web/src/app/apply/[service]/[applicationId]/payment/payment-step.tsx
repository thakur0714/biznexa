'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatDate, formatINR, type ApplicationDetail, type PaymentStatusView } from '@biznexa/types';
import { ClientApiError } from '@biznexa/api-client/browser';
import { useApi } from '@biznexa/api-client/react';
import { Breadcrumbs, Button, LinkButton, Notice } from '@biznexa/ui';
import { Icon } from '@/components/icons';
import type { ServiceDetail } from '@/lib/api';
import { useCheckout } from '../use-checkout';

const money = (paise: number) => formatINR(paise, true);

/** Where "Track Application" goes until the application detail page with its timeline (M5.4). */
const TRACK_HREF = '/dashboard';

/** Poll every 2 s for the first 20 s (a webhook usually lands within seconds), then every 5 s, for 2 minutes. */
const FAST_MS = 2_000;
const SLOW_MS = 5_000;
const FAST_FOR_MS = 20_000;
const GIVE_UP_MS = 120_000;

const METHOD: Record<string, string> = { upi: 'UPI', card: 'Card', netbanking: 'Net banking', wallet: 'Wallet', emi: 'EMI' };

type View = 'success' | 'confirming' | 'slow' | 'failed' | 'awaiting' | 'unpaid' | 'closed';

/**
 * Where the payment stands, after Razorpay Checkout (M3.18). The page only reads `GET …/payment`: it shows
 * "confirming" while waiting and the success page once the gateway's signed webhook has paid the order — so
 * the result is the same if the customer closed the browser and came back later. `?confirming=1` means
 * Checkout reported success, so a failed earlier attempt or a payment not yet seen is shown as "confirming"
 * until the webhook arrives or the wait runs out.
 */
export function PaymentStep({ service, applicationId }: { service: ServiceDetail; applicationId: string }) {
  const api = useApi();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [status, setStatus] = useState<PaymentStatusView | null>(null);
  const [loadError, setLoadError] = useState('');
  const [confirming, setConfirming] = useState(params.get('confirming') === '1');
  const [pollFrom, setPollFrom] = useState(() => Date.now());
  const [timedOut, setTimedOut] = useState(false);
  /** The application is checked against this service's URL once, on the first load. */
  const checked = useRef(false);

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const keepPolling = (s: PaymentStatusView) => s.outcome === 'CONFIRMING' || s.outcome === 'AWAITING' || (s.outcome === 'FAILED' && confirming);

    async function tick() {
      try {
        const path = { params: { path: { id: applicationId } } };
        const s = await api.call<PaymentStatusView>((c) => c.GET('/api/applications/{id}/payment', path));
        if (!live) return;
        if (!checked.current) {
          const detail = await api.call<ApplicationDetail>((c) => c.GET('/api/applications/{id}', path));
          if (detail.serviceId !== service.id) throw new ClientApiError(404, 'Application not found');
          checked.current = true;
        }
        if (!live) return;
        setStatus(s);
        setLoadError('');
        if (!keepPolling(s)) return;
      } catch (e) {
        if (!live) return;
        // A missing application won't appear; a network blip is retried on the next tick.
        if (e instanceof ClientApiError && e.status < 500 && e.status !== 429) return setLoadError(e.message);
      }
      const elapsed = Date.now() - pollFrom;
      if (elapsed >= GIVE_UP_MS) return setTimedOut(true);
      timer = setTimeout(() => void tick(), elapsed < FAST_FOR_MS ? FAST_MS : SLOW_MS);
    }

    void tick();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [api, applicationId, service.id, confirming, pollFrom]);

  const pollAgain = useCallback(() => {
    setTimedOut(false);
    setPollFrom(Date.now());
  }, []);

  const onConfirming = useCallback(() => {
    setConfirming(true);
    // Keeps "confirming" across a reload.
    router.replace(`${pathname}?confirming=1`, { scroll: false });
    pollAgain();
  }, [router, pathname, pollAgain]);

  const { pay, state: payState, error: payError, checkout } = useCheckout(applicationId, { onConfirming, onStarted: pollAgain });

  const serviceHref = `/services/${service.category.slug}/${service.slug}`;
  const stepHref = `/apply/${service.slug}/${applicationId}`;
  const summaryHref = `${stepHref}/summary`;
  const view = status && viewFor(status.outcome, confirming, timedOut);
  const busy = payState === 'starting' || payState === 'open' || payState === 'confirming';

  return (
    <div className="mx-auto max-w-[760px] px-4 py-10 sm:px-6">
      <Breadcrumbs
        items={[
          { href: serviceHref, label: service.name },
          { href: summaryHref, label: 'Order summary' },
          { label: 'Payment' },
        ]}
      />

      {loadError && (
        <div className="mt-6 space-y-4">
          <h1 className="text-3xl font-bold tracking-[-0.025em]">Payment</h1>
          <Notice tone="error">{loadError}</Notice>
          <LinkButton href="/dashboard" variant="outline">
            Go to dashboard
          </LinkButton>
        </div>
      )}

      {!status && !loadError && (
        <>
          <h1 className="mt-4 text-3xl font-bold tracking-[-0.025em]">Payment</h1>
          <p className="mt-6 text-sm text-muted" role="status">
            Checking your payment…
          </p>
        </>
      )}

      {status && view === 'success' && (
        <section aria-labelledby="pay-title" className="mt-4">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-seal-050 text-seal">
              <Icon name="check" size={22} />
            </span>
            <h1 id="pay-title" className="text-3xl font-bold tracking-[-0.025em]">
              Payment successful
            </h1>
          </div>
          <p className="mt-3 text-muted">
            {status.applicationStatus === 'DOCUMENTS_PENDING'
              ? 'Your application is submitted and waiting for your documents.'
              : 'Your application is submitted. Our team will start on it shortly.'}
          </p>

          <div className="mt-6 rounded-lg border border-rule bg-white p-5 sm:p-6">
            <p className="text-sm text-muted">Application ID</p>
            <p className="num mt-1 text-3xl font-bold tracking-[-0.01em]">{status.applicationCode}</p>
            <p className="mt-1 text-sm text-muted">Quote this whenever you contact us about this application.</p>
            <dl className="num mt-5 space-y-2 border-t border-rule pt-4 text-sm">
              <Row label="Amount paid" value={money(status.amountPaid)} />
              <Row label="Order" value={status.orderCode} />
              {status.payment?.paidAt && <Row label="Paid on" value={formatDate(status.payment.paidAt)} />}
              {status.payment?.method && <Row label="Paid by" value={METHOD[status.payment.method] ?? status.payment.method} />}
            </dl>
          </div>

          {status.applicationStatus === 'DOCUMENTS_PENDING' && (
            <div className="mt-6">
              <Notice tone="info">
                Some required documents are still to upload. We can start once they’re in.{' '}
                <Link href={`${stepHref}/documents`} className="font-semibold underline">
                  Upload documents
                </Link>
              </Notice>
            </div>
          )}

          <div className="mt-8 flex flex-col gap-3 border-t border-rule pt-6 sm:flex-row sm:items-center">
            <LinkButton href={TRACK_HREF} variant="primary">
              Track Application
            </LinkButton>
            <LinkButton href={serviceHref} variant="ghost">
              Back to {service.name}
            </LinkButton>
          </div>
        </section>
      )}

      {status && view === 'confirming' && (
        <section aria-labelledby="pay-title" className="mt-4">
          <h1 id="pay-title" className="text-3xl font-bold tracking-[-0.025em]">
            Confirming your payment…
          </h1>
          <div className="mt-6 flex items-start gap-3 rounded-lg border border-rule bg-white p-5 sm:p-6" role="status" aria-live="polite">
            <span className="mt-0.5 h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-rule border-t-ink motion-reduce:animate-none" aria-hidden="true" />
            <div className="text-sm">
              <p className="font-semibold">We’re waiting for the bank’s confirmation. This usually takes a few seconds.</p>
              <p className="mt-1 text-muted">
                Please don’t pay again. You can close this page: application <span className="num">{status.applicationCode}</span> is submitted as soon as the
                payment is confirmed, and your dashboard will show it.
              </p>
            </div>
          </div>
        </section>
      )}

      {status && view === 'slow' && (
        <section aria-labelledby="pay-title" className="mt-4">
          <h1 id="pay-title" className="text-3xl font-bold tracking-[-0.025em]">
            Still confirming your payment
          </h1>
          <div className="mt-6 space-y-4">
            <Notice tone="info">
              This is taking longer than usual. Please don’t pay again — if money left your account, the payment is confirmed automatically and application{' '}
              <span className="num">{status.applicationCode}</span> will show as submitted in your dashboard. Contact us with order{' '}
              <span className="num">{status.orderCode}</span> if it doesn’t within an hour.
            </Notice>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button type="button" variant="primary" onClick={pollAgain}>
                Check again
              </Button>
              <LinkButton href="/dashboard" variant="outline">
                Go to dashboard
              </LinkButton>
            </div>
          </div>
        </section>
      )}

      {status && (view === 'failed' || view === 'awaiting') && (
        <section aria-labelledby="pay-title" className="mt-4">
          <div className="flex items-center gap-3">
            {view === 'failed' && (
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-danger-050 text-danger">
                <Icon name="x" size={22} />
              </span>
            )}
            <h1 id="pay-title" className="text-3xl font-bold tracking-[-0.025em]">
              {view === 'failed' ? 'Payment didn’t go through' : 'Payment not completed'}
            </h1>
          </div>
          <div className="mt-6 space-y-4">
            {view === 'failed' ? (
              <Notice tone="error">
                {status.payment?.failureReason ? `${status.payment.failureReason.replace(/\.$/, '')}. ` : ''}Your application <span className="num">{status.applicationCode}</span> is
                saved and waiting for payment. You can try again, with the same or another method.
              </Notice>
            ) : (
              <Notice tone="info">
                We haven’t received a payment for application <span className="num">{status.applicationCode}</span> yet. If you’ve just paid, this page updates by
                itself; otherwise you can pay now.
              </Notice>
            )}
            {payState === 'mock' && checkout && (
              <Notice tone="info">
                Test mode: the mock payment gateway is in use, so no payment window opens. Order <span className="num">{checkout.orderCode}</span> is waiting for
                payment of <span className="num">{money(checkout.amount)}</span>.
              </Notice>
            )}
            {payError && <Notice tone="error">{payError}</Notice>}
            <div className="flex flex-col-reverse gap-3 border-t border-rule pt-6 sm:flex-row sm:items-center sm:justify-between">
              <LinkButton href={summaryHref} variant="ghost">
                Back to order summary
              </LinkButton>
              <Button type="button" variant="primary" onClick={() => void pay()} disabled={busy} aria-busy={payState === 'starting'}>
                {payState === 'starting' ? 'Opening payment…' : view === 'failed' ? `Try again · ${money(status.total)}` : `Pay ${money(status.total)}`}
              </Button>
            </div>
          </div>
        </section>
      )}

      {status && (view === 'unpaid' || view === 'closed') && (
        <section aria-labelledby="pay-title" className="mt-4">
          <h1 id="pay-title" className="text-3xl font-bold tracking-[-0.025em]">
            Payment
          </h1>
          <div className="mt-6 space-y-4">
            <Notice tone="info">
              {view === 'unpaid'
                ? 'Payment for this application hasn’t started yet. Check your order summary and pay from there.'
                : 'This order can’t be paid online. Contact us if you need help.'}
            </Notice>
            <LinkButton href={view === 'unpaid' ? summaryHref : '/dashboard'} variant="outline">
              {view === 'unpaid' ? 'Go to order summary' : 'Go to dashboard'}
            </LinkButton>
          </div>
        </section>
      )}
    </div>
  );
}

/** What to show for an outcome. After Checkout reported success, anything short of PAID reads as "confirming" until the wait runs out. */
function viewFor(outcome: PaymentStatusView['outcome'], confirming: boolean, timedOut: boolean): View {
  switch (outcome) {
    case 'PAID':
      return 'success';
    case 'CLOSED':
      return 'closed';
    case 'UNPAID':
      return 'unpaid';
    case 'CONFIRMING':
      return timedOut ? 'slow' : 'confirming';
    case 'FAILED':
      // An earlier attempt failed but a later one in the same Checkout succeeded: wait for its webhook.
      return confirming && !timedOut ? 'confirming' : 'failed';
    case 'AWAITING':
      if (!confirming) return 'awaiting';
      return timedOut ? 'slow' : 'confirming';
  }
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
