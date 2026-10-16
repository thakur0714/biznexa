'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  formatDate,
  formatINR,
  type CustomerPaymentListResponse,
} from '@biznexa/types';
import { ClientApiError } from '@biznexa/api-client/browser';
import { useApi } from '@biznexa/api-client/react';
import { Badge, Button, EmptyState, LinkButton, Notice, type Tone } from '@biznexa/ui';
import { Icon } from '@/components/icons';

function paymentStatusTone(status: string): Tone {
  switch (status) {
    case 'SUCCESS':
      return 'success';
    case 'PENDING':
    case 'PARTIALLY_REFUNDED':
    case 'REFUND_INITIATED':
      return 'warning';
    case 'FAILED':
      return 'danger';
    case 'REFUNDED':
      return 'neutral';
    default:
      return 'info';
  }
}

function paymentStatusLabel(status: string): string {
  switch (status) {
    case 'SUCCESS':
      return 'Paid';
    case 'PENDING':
      return 'Pending';
    case 'FAILED':
      return 'Failed';
    case 'REFUNDED':
      return 'Refunded';
    case 'PARTIALLY_REFUNDED':
      return 'Partially Refunded';
    case 'REFUND_INITIATED':
      return 'Refund Initiated';
    case 'CREATED':
      return 'Created';
    default:
      return status;
  }
}

export function CustomerPaymentsView() {
  const api = useApi();
  const [data, setData] = useState<CustomerPaymentListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<{ id: string; message: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .call<CustomerPaymentListResponse>((c) =>
        c.GET('/api/payments', {
          params: { query: { page, limit: 20 } },
        }),
      )
      .then(
        (res) => {
          if (!cancelled) {
            setData(res);
            setError(null);
            setLoading(false);
          }
        },
        (err: unknown) => {
          if (!cancelled) {
            const msg = err instanceof ClientApiError ? err.message : 'Failed to load your payments';
            setError(msg);
            setLoading(false);
          }
        },
      );
    return () => {
      cancelled = true;
    };
  }, [api, page, refreshKey]);

  const handleDownloadInvoice = async (invoiceId: string) => {
    setDownloadingId(invoiceId);
    setDownloadError(null);
    try {
      const res = await api.call<{ url: string }>((c) =>
        c.POST('/api/invoices/{id}/link', {
          params: { path: { id: invoiceId }, query: { disposition: 'attachment' } },
        }),
      );
      if (res?.url) {
        window.open(res.url, '_blank');
      }
    } catch (err: unknown) {
      const msg = err instanceof ClientApiError ? err.message : 'Unable to download invoice PDF. Please try again.';
      setDownloadError({ id: invoiceId, message: msg });
    } finally {
      setDownloadingId(null);
    }
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-night sm:text-3xl">Payments</h1>
        <p className="mt-1 text-sm text-muted">
          Track your payments, download tax invoices, and clear pending balances.
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-rule bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">Total Paid</span>
            <div className="rounded-md bg-emerald-50 p-2 text-emerald-600">
              <Icon name="receipt" size={20} />
            </div>
          </div>
          <div className="num mt-3 text-2xl font-bold text-emerald-700 sm:text-3xl">
            {data ? formatINR(data.totalPaid) : '—'}
          </div>
          <p className="mt-1 text-xs text-muted">Successful payments across all orders</p>
        </div>

        <div className="rounded-lg border border-rule bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">
              Outstanding Balance
            </span>
            <div
              className={`rounded-md p-2 ${
                data && data.outstandingBalance > 0 ? 'bg-amber-50 text-amber-600' : 'bg-paper text-muted'
              }`}
            >
              <Icon name="rupee" size={20} />
            </div>
          </div>
          <div
            className={`num mt-3 text-2xl font-bold sm:text-3xl ${
              data && data.outstandingBalance > 0 ? 'text-amber-700' : 'text-night'
            }`}
          >
            {data ? formatINR(data.outstandingBalance) : '—'}
          </div>
          <p className="mt-1 text-xs text-muted">
            {data && data.outstandingBalance > 0
              ? 'Balance due before service delivery'
              : 'All active orders are fully paid'}
          </p>
        </div>
      </div>

      {/* Error Notice */}
      {error && (
        <Notice tone="error">
          <div className="flex items-center justify-between gap-4">
            <span>{error}</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setLoading(true);
                setRefreshKey((k) => k + 1);
              }}
            >
              Retry
            </Button>

          </div>
        </Notice>
      )}

      {/* Download Error Notice */}
      {downloadError && (
        <Notice tone="error">
          {downloadError.message}
        </Notice>
      )}


      {/* Payment History List */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-night">Payment History</h2>
          {data && (
            <span className="text-xs text-muted">
              {data.total} {data.total === 1 ? 'payment' : 'payments'}
            </span>
          )}
        </div>

        {loading && !data ? (
          <div className="rounded-lg border border-rule bg-white p-12 text-center text-sm text-muted">
            Loading payments…
          </div>
        ) : !data || data.items.length === 0 ? (
          <EmptyState
            title="No payments yet"
            description="Payments you make for your applications and services will appear here."
            action={
              <LinkButton href="/services" variant="primary">
                Explore Services
              </LinkButton>
            }
          />
        ) : (
          <>
            {/* Desktop Table View */}
            <div className="hidden overflow-hidden rounded-lg border border-rule bg-white shadow-sm sm:block">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-rule bg-paper/60 text-xs font-semibold uppercase tracking-[0.06em] text-muted">
                  <tr>
                    <th scope="col" className="px-4 py-3">Date</th>
                    <th scope="col" className="px-4 py-3">Order &amp; Details</th>
                    <th scope="col" className="px-4 py-3">Method</th>
                    <th scope="col" className="px-4 py-3">Status</th>
                    <th scope="col" className="px-4 py-3 text-right">Amount</th>
                    <th scope="col" className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rule">
                  {data.items.map((item) => {
                    const payBalanceUrl =
                      item.order.serviceSlug && item.order.applicationId
                        ? `/apply/${item.order.serviceSlug}/${item.order.applicationId}/payment`
                        : item.order.applicationId
                        ? `/dashboard/applications/${item.order.applicationId}`
                        : null;

                    return (
                      <tr key={item.id} className="hover:bg-paper/30">
                        <td className="whitespace-nowrap px-4 py-3 text-xs text-muted">
                          {formatDate(item.createdAt)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-mono text-xs font-semibold text-night">
                            {item.order.applicationId ? (
                              <Link
                                href={`/dashboard/applications/${item.order.applicationId}`}
                                className="hover:underline text-ink"
                              >
                                {item.order.code}
                              </Link>
                            ) : (
                              item.order.code
                            )}
                          </div>
                          {item.order.balance > 0 && (
                            <div className="num mt-0.5 text-xs text-amber-700">
                              Balance: {formatINR(item.order.balance)}
                            </div>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-xs uppercase text-muted">
                          {item.method ?? item.gateway}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <Badge tone={paymentStatusTone(item.status)}>
                            {paymentStatusLabel(item.status)}
                          </Badge>
                        </td>
                        <td className="num whitespace-nowrap px-4 py-3 text-right font-bold text-night">
                          {formatINR(item.amount)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {item.invoice && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleDownloadInvoice(item.invoice!.id)}
                                disabled={downloadingId === item.invoice.id}
                                title={`Download Invoice ${item.invoice.number}`}
                              >
                                <Icon name="download" size={14} />
                                <span>{downloadingId === item.invoice.id ? 'Loading…' : 'Invoice'}</span>
                              </Button>
                            )}
                            {item.order.balance > 0 && payBalanceUrl && (
                              <LinkButton href={payBalanceUrl} variant="primary" size="sm">
                                Pay balance
                              </LinkButton>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Card View (360px compatible) */}
            <div className="space-y-3 sm:hidden">
              {data.items.map((item) => {
                const payBalanceUrl =
                  item.order.serviceSlug && item.order.applicationId
                    ? `/apply/${item.order.serviceSlug}/${item.order.applicationId}/payment`
                    : item.order.applicationId
                    ? `/dashboard/applications/${item.order.applicationId}`
                    : null;

                return (
                  <div
                    key={item.id}
                    className="rounded-lg border border-rule bg-white p-4 shadow-sm space-y-3"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted">{formatDate(item.createdAt)}</span>
                      <Badge tone={paymentStatusTone(item.status)}>
                        {paymentStatusLabel(item.status)}
                      </Badge>
                    </div>

                    <div className="flex items-baseline justify-between border-b border-rule pb-3">
                      <div>
                        <div className="num text-xl font-bold text-night">{formatINR(item.amount)}</div>
                        <div className="mt-0.5 text-xs text-muted uppercase tracking-wider">
                          via {item.method ?? item.gateway}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-xs font-semibold text-night">
                          {item.order.applicationId ? (
                            <Link
                              href={`/dashboard/applications/${item.order.applicationId}`}
                              className="text-ink hover:underline"
                            >
                              {item.order.code}
                            </Link>
                          ) : (
                            item.order.code
                          )}
                        </div>
                        {item.order.balance > 0 && (
                          <div className="num mt-0.5 text-xs text-amber-700">
                            Bal: {formatINR(item.order.balance)}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                      {item.invoice && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleDownloadInvoice(item.invoice!.id)}
                          disabled={downloadingId === item.invoice.id}
                        >
                          <Icon name="download" size={14} />
                          <span>{downloadingId === item.invoice.id ? 'Loading…' : 'Invoice PDF'}</span>
                        </Button>
                      )}
                      {item.order.balance > 0 && payBalanceUrl && (
                        <LinkButton href={payBalanceUrl} variant="primary" size="sm">
                          Pay balance ({formatINR(item.order.balance)})
                        </LinkButton>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-rule pt-4 text-sm">
                <span className="text-xs text-muted">
                  Page {data.page} of {totalPages}
                </span>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={data.page <= 1 || loading}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    Previous
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={data.page >= totalPages || loading}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
