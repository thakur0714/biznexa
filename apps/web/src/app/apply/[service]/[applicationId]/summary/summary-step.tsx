'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { applyCouponInput, formatINR, type ApplicationDetail, type DocumentChecklist, type OrderSummary, type PaymentStatusView } from '@biznexa/types';
import { ClientApiError } from '@biznexa/api-client/browser';
import { useApi } from '@biznexa/api-client/react';
import { Breadcrumbs, Button, Field, LinkButton, Notice } from '@biznexa/ui';
import type { ServiceDetail } from '@/lib/api';
import { useCheckout } from '../use-checkout';

/** Amounts with paise: GST is rarely a whole number of rupees. */
const money = (paise: number) => formatINR(paise, true);

const SUPPLY_TEXT: Record<NonNullable<OrderSummary['placeOfSupply']>['source'], string> = {
  BUSINESS: 'your business’s state',
  PROFILE: 'the state in your profile',
  SELLER: 'no state on record for you',
};

/**
 * The order summary step (M3.13) and "Pay" (M3.16). Every amount comes from the API, which recomputes the
 * order from the package prices, the coupon and the place of supply; the page sends only a coupon code.
 * "Pay" asks the API to start the payment and opens Razorpay Checkout for the gateway order it returns;
 * when Checkout reports success the payment page takes over (M3.18).
 */
export function SummaryStep({ service, applicationId }: { service: ServiceDetail; applicationId: string }) {
  const api = useApi();
  const router = useRouter();
  const [summary, setSummary] = useState<OrderSummary | null>(null);
  const [pendingDocs, setPendingDocs] = useState(0);
  const [loadError, setLoadError] = useState('');
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState('');
  const [busy, setBusy] = useState(false);
  const [formIncomplete, setFormIncomplete] = useState(false);
  /** The last payment attempt, to say so when it failed. */
  const [lastPayment, setLastPayment] = useState<PaymentStatusView | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const path = { params: { path: { id: applicationId } } };
        const [detail, s, checklist, payment] = await Promise.all([
          api.call<ApplicationDetail>((c) => c.GET('/api/applications/{id}', path)),
          api.call<OrderSummary>((c) => c.GET('/api/applications/{id}/summary', path)),
          api.call<DocumentChecklist>((c) => c.GET('/api/applications/{id}/documents', path)),
          api.call<PaymentStatusView>((c) => c.GET('/api/applications/{id}/payment', path)),
        ]);
        if (detail.serviceId !== service.id) throw new ClientApiError(404, 'Application not found');
        if (live) {
          setSummary(s);
          setPendingDocs(checklist.pendingMandatory);
          setLastPayment(payment);
        }
      } catch (e) {
        if (live) setLoadError((e as ClientApiError).message);
      }
    })();
    return () => {
      live = false;
    };
  }, [api, applicationId, service.id]);

  async function applyCoupon(e: FormEvent) {
    e.preventDefault();
    setCodeError('');
    const parsed = applyCouponInput.safeParse({ code });
    if (!parsed.success) return setCodeError(parsed.error.issues[0].message);
    setBusy(true);
    try {
      const s = await api.call<OrderSummary>((c) =>
        c.PUT('/api/applications/{id}/coupon', { params: { path: { id: applicationId } }, body: { code: parsed.data.code } }),
      );
      setSummary(s);
      setCode('');
    } catch (err) {
      const e = err as ClientApiError;
      setCodeError(e.errors.find((f) => f.field === 'code')?.message ?? e.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeCoupon() {
    setCodeError('');
    setBusy(true);
    try {
      setSummary(await api.call<OrderSummary>((c) => c.DELETE('/api/applications/{id}/coupon', { params: { path: { id: applicationId } } })));
    } catch (err) {
      setCodeError((err as ClientApiError).message);
    } finally {
      setBusy(false);
    }
  }

  const paymentHref = `/apply/${service.slug}/${applicationId}/payment`;
  const onConfirming = useCallback(() => router.push(`${paymentHref}?confirming=1`), [router, paymentHref]);
  const reloadSummary = useCallback(
    () => api.call<OrderSummary>((cl) => cl.GET('/api/applications/{id}/summary', { params: { path: { id: applicationId } } })),
    [api, applicationId],
  );
  const onStarted = useCallback(async () => {
    setFormIncomplete(false);
    // Amounts are frozen from here on; show the summary as the API now sees it.
    setSummary(await reloadSummary());
  }, [reloadSummary]);
  const onError = useCallback(
    async (err: unknown) => {
      if (!(err instanceof ClientApiError)) return;
      setFormIncomplete(err.status === 400 && err.errors.length > 0);
      // Coupon removed, already paid…: show the current summary (with its notice) before trying again.
      if (err.status === 409) {
        try {
          setSummary(await reloadSummary());
        } catch {
          /* keep the summary on screen; the error explains */
        }
      }
    },
    [reloadSummary],
  );
  const { pay, state: payState, error: payError, checkout } = useCheckout(applicationId, { onStarted, onConfirming, onError });

  const serviceHref = `/services/${service.category.slug}/${service.slug}`;
  const stepHref = `/apply/${service.slug}/${applicationId}`;
  const rates = new Set(summary?.lines.map((l) => l.gstRate));
  const rate = rates.size === 1 ? [...rates][0] : null;
  const half = (r: number) => `${r / 2}%`;

  return (
    <div className="mx-auto max-w-[760px] px-4 py-10 sm:px-6">
      <Breadcrumbs
        items={[
          { href: serviceHref, label: service.name },
          { href: stepHref, label: 'Your details' },
          { href: `${stepHref}/documents`, label: 'Documents' },
          { label: 'Order summary' },
        ]}
      />
      <h1 className="mt-4 text-3xl font-bold tracking-[-0.025em]">Order summary</h1>
      {summary && (
        <p className="mt-1 text-sm text-muted">
          Application <span className="num">{summary.applicationCode}</span> · Order <span className="num">{summary.orderCode}</span>
        </p>
      )}

      {loadError && (
        <div className="mt-6 space-y-4">
          <Notice tone="error">{loadError}</Notice>
          <LinkButton href={serviceHref} variant="outline">
            Back to {service.name}
          </LinkButton>
        </div>
      )}

      {!summary && !loadError && <p className="mt-6 text-sm text-muted" role="status">Working out your total…</p>}

      {summary && (
        <>
          {!summary.editable && (
            <div className="mt-6">
              <Notice tone="info">Payment for this order has started, so its amounts are fixed.</Notice>
            </div>
          )}
          {summary.couponNotice && (
            <div className="mt-6">
              <Notice tone="error">{summary.couponNotice}</Notice>
            </div>
          )}

          <section className="mt-6 rounded-lg border border-rule bg-white p-5 sm:p-6" aria-labelledby="order-lines">
            <h2 id="order-lines" className="sr-only">
              Price breakdown
            </h2>
            <ul className="space-y-1">
              {summary.lines.map((l, i) => (
                <li key={i} className="font-semibold">
                  {l.description}
                  {l.sacCode && <span className="num ml-2 text-xs font-normal text-muted">SAC {l.sacCode}</span>}
                </li>
              ))}
            </ul>

            <dl className="num mt-4 space-y-2 text-sm">
              <Row label="Professional fee" value={money(summary.professionalFee)} />
              {summary.discount > 0 && (
                <Row label={summary.coupon ? `Discount (${summary.coupon.code})` : 'Discount'} value={`− ${money(summary.discount)}`} tone="text-seal" />
              )}
              {summary.discount > 0 && <Row label="Taxable value" value={money(summary.taxableValue)} />}
              {summary.taxType === 'CGST_SGST' ? (
                <>
                  <Row label={rate != null ? `CGST (${half(rate)})` : 'CGST'} value={money(summary.cgst)} />
                  <Row label={rate != null ? `SGST (${half(rate)})` : 'SGST'} value={money(summary.sgst)} />
                </>
              ) : (
                <Row label={rate != null ? `IGST (${rate}%)` : 'IGST'} value={money(summary.igst)} />
              )}
              {summary.governmentFee > 0 && <Row label="Government fee (no GST)" value={money(summary.governmentFee)} />}
              <div className="flex justify-between gap-4 border-t border-rule pt-3 text-base font-semibold">
                <dt>Total</dt>
                <dd>{money(summary.total)}</dd>
              </div>
            </dl>
            {summary.placeOfSupply && (
              <p className="mt-3 text-xs text-muted">
                Place of supply: {summary.placeOfSupply.state} ({SUPPLY_TEXT[summary.placeOfSupply.source]}).{' '}
                {summary.taxType === 'CGST_SGST' ? 'Same state as ours, so GST is split into CGST and SGST.' : 'A different state from ours, so IGST applies.'}
              </p>
            )}
          </section>

          {summary.editable && (
            <section className="mt-6 rounded-lg border border-rule bg-white p-5 sm:p-6" aria-labelledby="coupon-heading">
              <h2 id="coupon-heading" className="font-semibold">
                Coupon
              </h2>
              {summary.coupon ? (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md bg-paper px-3 py-2 text-sm">
                  <span>
                    <strong className="num">{summary.coupon.code}</strong> applied — you save <span className="num">{money(summary.coupon.discount)}</span>
                  </span>
                  <Button type="button" variant="ghost" size="sm" onClick={() => void removeCoupon()} disabled={busy}>
                    Remove
                  </Button>
                </div>
              ) : (
                <form className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start" onSubmit={applyCoupon} noValidate>
                  <Field
                    id="coupon-code"
                    label="Coupon code"
                    className="flex-1"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    maxLength={32}
                    error={codeError}
                    disabled={busy}
                  />
                  <Button type="submit" variant="outline" className="sm:mt-[26px]" disabled={busy || !code.trim()} aria-busy={busy}>
                    {busy ? 'Checking…' : 'Apply'}
                  </Button>
                </form>
              )}
              {summary.coupon && codeError && (
                <p role="alert" className="mt-2 text-sm text-danger">
                  {codeError}
                </p>
              )}
            </section>
          )}

          {pendingDocs > 0 && (
            <p className="mt-6 text-sm text-muted">
              {pendingDocs === 1 ? 'One required document is' : `${pendingDocs} required documents are`} still to upload. You can pay now and upload{' '}
              {pendingDocs === 1 ? 'it' : 'them'} later from your dashboard; until then your application will show “Documents Pending”.
            </p>
          )}

          {lastPayment?.outcome === 'FAILED' && !payError && payState === 'idle' && (
            <div className="mt-6">
              <Notice tone="error">
                Your last payment attempt didn’t go through.
                {lastPayment.payment?.failureReason ? ` ${lastPayment.payment.failureReason.replace(/\.$/, '')}.` : ''} You can try again below.
              </Notice>
            </div>
          )}
          {payState === 'confirming' && (
            <p className="mt-6 text-sm text-muted" role="status">
              Payment received — checking it with the bank…
            </p>
          )}
          {payState === 'mock' && checkout && (
            <div className="mt-6" role="status">
              <Notice tone="info">
                Test mode: the mock payment gateway is in use, so no payment window opens. Order <span className="num">{checkout.orderCode}</span> is
                waiting for payment of <span className="num">{money(checkout.amount)}</span>.
              </Notice>
            </div>
          )}
          {payError && (
            <div className="mt-6 space-y-3">
              <Notice tone="error">{payError}</Notice>
              {formIncomplete && (
                <LinkButton href={stepHref} variant="outline">
                  Back to your details
                </LinkButton>
              )}
            </div>
          )}

          {summary.orderStatus === 'PAID' ? (
            <div className="mt-8 space-y-3 border-t border-rule pt-6">
              <Notice tone="success">This order is paid.</Notice>
              <LinkButton href={paymentHref} variant="outline">
                View payment
              </LinkButton>
            </div>
          ) : summary.orderStatus === 'CREATED' || summary.orderStatus === 'PAYMENT_PENDING' ? (
            payState !== 'confirming' && (
              <div className="mt-8 flex flex-col-reverse gap-3 border-t border-rule pt-6 sm:flex-row sm:items-center sm:justify-between">
                {summary.editable ? (
                  <LinkButton href={`${stepHref}/documents`} variant="ghost">
                    Back to documents
                  </LinkButton>
                ) : (
                  <span />
                )}
                <div className="flex flex-col gap-2 sm:items-end">
                  <Button
                    type="button"
                    variant="primary"
                    onClick={() => void pay()}
                    disabled={busy || payState === 'starting' || payState === 'open'}
                    aria-busy={payState === 'starting'}
                    aria-describedby="pay-note"
                  >
                    {payState === 'starting' ? 'Opening payment…' : `Pay ${money(summary.total)}`}
                  </Button>
                  <p id="pay-note" className="text-sm text-muted">
                    UPI, cards or net banking, through Razorpay.
                  </p>
                </div>
              </div>
            )
          ) : (
            <div className="mt-8 border-t border-rule pt-6">
              <Notice tone="info">This order can’t be paid online. Contact us if you need help.</Notice>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Row({ label, value, tone = '' }: { label: string; value: string; tone?: string }) {
  return (
    <div className={`flex justify-between gap-4 ${tone}`}>
      <dt className="text-muted">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
