'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { formatDate, formatINR, PERMS, type AdminPaymentDetail, type AdminPaymentRow, type PaymentStatus, type RefundStatus } from '@biznexa/types';
import { Badge, Button, Dialog, EmptyState, Field, Notice, useToast, type Tone } from '@biznexa/ui';
import { useApi } from '@biznexa/api-client/react';
import { DataTable } from '@/components/data-table';
import { NotAllowed } from '@/components/portal-shell';
import { useAuth } from '@/lib/auth';
import { canSee, findNavItem } from '@/lib/nav';
import { money, RefundDialog } from './refund-dialog';

export function PaymentsView() {
  const { user } = useAuth();
  const item = findNavItem('payments');
  if (!user || !item) return null;
  if (!canSee(item, user.permissions)) return <NotAllowed />;
  return <PaymentsList />;
}

const STATUS_BADGES: Record<PaymentStatus, { label: string; tone: Tone }> = {
  SUCCESS: { label: 'Success', tone: 'success' },
  FAILED: { label: 'Failed', tone: 'danger' },
  CREATED: { label: 'Created', tone: 'neutral' },
  PENDING: { label: 'Pending', tone: 'warning' },
  REFUND_INITIATED: { label: 'Refund Initiated', tone: 'info' },
  REFUNDED: { label: 'Refunded', tone: 'neutral' },
  PARTIALLY_REFUNDED: { label: 'Partially Refunded', tone: 'warning' },
};

const REFUND_BADGES: Record<RefundStatus, { label: string; tone: Tone }> = {
  INITIATED: { label: 'In progress', tone: 'info' },
  PROCESSED: { label: 'Processed', tone: 'success' },
  FAILED: { label: 'Failed', tone: 'danger' },
};

type StatusGroup = 'all' | 'success' | 'failed' | 'pending';

function PaymentsList() {
  const api = useApi();
  const toast = useToast();
  const { user } = useAuth();
  const canRefund = !!user?.permissions.includes(PERMS.PAYMENTS_REFUND);
  const [refunding, setRefunding] = useState(false);
  const [refundOpenings, setRefundOpenings] = useState(0);
  const [data, setData] = useState<{ items: AdminPaymentRow[]; total: number } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [statusGroup, setStatusGroup] = useState<StatusGroup>('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminPaymentDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .call((c) =>
        c.GET('/api/admin/payments', {
          params: {
            query: {
              status: statusGroup,
              from: fromDate || undefined,
              to: toDate || undefined,
              q: query || undefined,
              page,
              limit: 25,
            },
          },
        }),
      )
      .then(
        (res) => {
          if (!cancelled) {
            setData(res);
            setLoadError(null);
          }
        },
        (err: Error) => !cancelled && setLoadError(err.message),
      );
    return () => {
      cancelled = true;
    };
  }, [api, statusGroup, fromDate, toDate, query, page, reload]);

  const loadPaymentDetail = useCallback(
    async (id: string) => {
      setSelectedId(id);
      setDetail(null);
      setDetailError(null);
      setLoadingDetail(true);
      try {
        const res = await api.call<AdminPaymentDetail>((c) =>
          c.GET('/api/admin/payments/{id}', { params: { path: { id } } }),
        );
        setDetail(res);
      } catch (err) {
        setDetailError((err as Error).message);
      } finally {
        setLoadingDetail(false);
      }
    },
    [api],
  );

  const downloadInvoice = async (invoiceId: string) => {
    try {
      const link = await api.call<{ url: string }>((c) =>
        c.POST('/api/invoices/{id}/link', {
          params: { path: { id: invoiceId }, query: { disposition: 'attachment' } },
        }),
      );
      window.open(link.url, '_blank');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const downloadCreditNote = async (creditNoteId: string) => {
    try {
      const link = await api.call<{ url: string }>((c) =>
        c.POST('/api/credit-notes/{id}/link', {
          params: { path: { id: creditNoteId }, query: { disposition: 'attachment' } },
        }),
      );
      window.open(link.url, '_blank');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const handleExportCsv = async () => {
    setExporting(true);
    try {
      const blob = await api.call<Blob>((c) =>
        c.GET('/api/admin/payments/export', {
          params: { query: { status: statusGroup, from: fromDate || undefined, to: toDate || undefined, q: query || undefined } },
          parseAs: 'blob',
        }),
      );
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `payments-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      toast('Payments CSV exported.', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setExporting(false);
    }
  };

  const columns = useMemo(() => {
    const col = createColumnHelper<AdminPaymentRow>();
    return [
      col.accessor('createdAt', {
        header: 'Created / Paid',
        cell: ({ row: { original: p } }) => (
          <div>
            <p className="font-semibold text-night">{formatDate(p.createdAt)}</p>
            <p className="text-xs text-muted">{p.paidAt ? `Paid ${formatDate(p.paidAt)}` : 'Unpaid'}</p>
          </div>
        ),
      }),
      col.accessor('orderCode', {
        header: 'Order & App',
        cell: ({ row: { original: p } }) => (
          <div>
            <p className="font-mono font-semibold text-night">{p.orderCode ?? '—'}</p>
            <p className="font-mono text-xs text-muted">{p.applicationCode ?? '—'}</p>
          </div>
        ),
      }),
      col.accessor('customerName', {
        header: 'Customer',
        cell: ({ row: { original: p } }) => (
          <div>
            <p className="font-medium text-night">{p.customerName ?? '—'}</p>
            <p className="text-xs text-muted">{p.customerEmail ?? '—'}</p>
          </div>
        ),
      }),
      col.accessor('amount', {
        header: 'Amount',
        meta: { className: 'text-right' },
        cell: ({ getValue }) => <span className="font-semibold">{formatINR(getValue())}</span>,
      }),
      col.accessor('method', {
        header: 'Method',
        cell: ({ getValue }) => (getValue() ? <span className="uppercase text-xs font-medium">{getValue()}</span> : <span className="text-muted">—</span>),
      }),
      col.accessor('status', {
        header: 'Status',
        cell: ({ getValue }) => <Badge tone={STATUS_BADGES[getValue()]?.tone ?? 'neutral'}>{STATUS_BADGES[getValue()]?.label ?? getValue()}</Badge>,
      }),
      col.display({
        id: 'actions',
        header: () => <span className="sr-only">Actions</span>,
        meta: { className: 'text-right' },
        cell: ({ row: { original: p } }) => (
          <Button variant="ghost" size="sm" onClick={() => loadPaymentDetail(p.id)} aria-label={`View payment ${p.id}`}>
            Details
          </Button>
        ),
      }),
    ];
  }, [loadPaymentDetail]);

  const tabs: { key: StatusGroup; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'success', label: 'Success' },
    { key: 'failed', label: 'Failed' },
    { key: 'pending', label: 'Pending' },
  ];
  const hasLoadError = Boolean(loadError);
  const isLoading = !hasLoadError && !data;
  const hasNoPayments = !hasLoadError && !!data && data.items.length === 0;
  const hasPayments = !hasLoadError && !!data && data.items.length > 0;
  const showDetailLoading = loadingDetail;
  const showDetailError = !showDetailLoading && Boolean(detailError);
  const showPaymentDetail = !showDetailLoading && !detailError && Boolean(detail);

  return (
    <div className="max-w-[1200px]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-[-0.02em]">Payments</h1>
          <p className="mt-1 text-muted">View customer payment attempts, transaction details, and export CSV reports.</p>
        </div>
        <Button variant="outline" onClick={handleExportCsv} disabled={exporting || !data || data.items.length === 0}>
          {exporting ? 'Exporting…' : 'Export CSV'}
        </Button>
      </div>

      <div className="mt-6 flex border-b border-rule" role="tablist" aria-label="Payment status tabs">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={statusGroup === t.key}
            onClick={() => {
              setStatusGroup(t.key);
              setPage(1);
            }}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              statusGroup === t.key ? 'border-ink text-night font-semibold' : 'border-transparent text-muted hover:text-night'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Field
          id="payment-search"
          label="Search"
          type="search"
          placeholder="Order, app code or customer"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
        />
        <Field
          id="payment-from"
          label="From date"
          type="date"
          value={fromDate}
          onChange={(e) => {
            setFromDate(e.target.value);
            setPage(1);
          }}
        />
        <Field
          id="payment-to"
          label="To date"
          type="date"
          value={toDate}
          onChange={(e) => {
            setToDate(e.target.value);
            setPage(1);
          }}
        />
      </div>

      <div className="mt-4">
        {hasLoadError && (
          <div className="space-y-3">
            <Notice tone="error">{loadError}</Notice>
            <Button variant="outline" size="sm" onClick={() => setReload((n) => n + 1)}>
              Try again
            </Button>
          </div>
        )}
        {isLoading && (
          <output className="block text-muted">
            Loading payments…
          </output>
        )}
        {hasNoPayments && (
          <EmptyState
            title="No payments found"
            description="No transactions match the selected filters or date range."
            action={
              Boolean(query || fromDate || toDate || statusGroup !== 'all') && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setQuery('');
                    setFromDate('');
                    setToDate('');
                    setStatusGroup('all');
                    setPage(1);
                  }}
                >
                  Clear filters
                </Button>
              )
            }
          />
        )}
        {hasPayments && (
          <div>
            <DataTable
              caption="Payments"
              data={data.items}
              columns={columns}
              getRowId={(p) => p.id}
              minWidth={900}
              empty={
                <EmptyState
                  title="No payments match"
                  description="Try adjusting your filters or date range."
                  action={
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setQuery('');
                        setFromDate('');
                        setToDate('');
                        setStatusGroup('all');
                        setPage(1);
                      }}
                    >
                      Clear filters
                    </Button>
                  }
                />
              }
            />
            {data.total > 25 && (
              <div className="mt-4 flex items-center justify-between border-t border-rule pt-4 text-sm">
                <p className="text-muted">
                  Showing {(page - 1) * 25 + 1}–{Math.min(page * 25, data.total)} of {data.total} payments
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                    Previous
                  </Button>
                  <Button variant="outline" size="sm" disabled={page * 25 >= data.total} onClick={() => setPage((p) => p + 1)}>
                    Next
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <Dialog open={selectedId !== null} onClose={() => setSelectedId(null)} title="Payment Detail" description="Transaction info, order details and invoices.">
        {showDetailLoading && (
          <output className="block py-4 text-muted">
            Loading detail…
          </output>
        )}
        {showDetailError && (
          <Notice tone="error">{detailError}</Notice>
        )}
        {showPaymentDetail && detail && (
          <div className="space-y-5 py-2">
            <div className="flex items-center justify-between border-b border-rule pb-3">
              <div>
                <p className="text-xs text-muted">Amount</p>
                <p className="text-2xl font-bold text-night">{formatINR(detail.amount)}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={STATUS_BADGES[detail.status]?.tone ?? 'neutral'}>{STATUS_BADGES[detail.status]?.label ?? detail.status}</Badge>
                {canRefund && detail.refundable > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setRefundOpenings((n) => n + 1);
                      setRefunding(true);
                    }}
                  >
                    Refund
                  </Button>
                )}
              </div>
            </div>

            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs font-medium text-muted">Order Code</dt>
                <dd className="font-mono font-semibold text-night">{detail.orderCode ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted">Application Code</dt>
                <dd className="font-mono font-semibold text-night">{detail.applicationCode ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted">Customer Name</dt>
                <dd className="font-medium text-night">{detail.customerName ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted">Customer Email</dt>
                <dd className="text-night">{detail.customerEmail ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted">Gateway</dt>
                <dd className="text-night">{detail.gateway}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted">Payment Method</dt>
                <dd className="uppercase text-night">{detail.method ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted">Gateway Order ID</dt>
                <dd className="font-mono text-xs text-night">{detail.gatewayOrderId ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted">Gateway Payment ID</dt>
                <dd className="font-mono text-xs text-night">{detail.gatewayPaymentId ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted">Created At</dt>
                <dd className="text-night">{formatDate(detail.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted">Paid At</dt>
                <dd className="text-night">{detail.paidAt ? formatDate(detail.paidAt) : 'Unpaid'}</dd>
              </div>
            </dl>

            {detail.failureReason && (
              <div className="rounded-md bg-danger-050 p-3 text-sm text-danger">
                <p className="font-semibold">Failure Reason</p>
                <p className="mt-0.5">{detail.failureReason}</p>
              </div>
            )}

            {detail.invoice && (
              <div className="flex items-center justify-between rounded-md border border-rule bg-paper p-3 text-sm">
                <div>
                  <p className="font-semibold text-night">Invoice {detail.invoice.number}</p>
                  <p className="text-xs text-muted">Issued {formatDate(detail.invoice.issuedAt)}</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => downloadInvoice(detail.invoice!.id)}>
                  Download Invoice
                </Button>
              </div>
            )}

            {detail.refunds.length > 0 && (
              <div className="border-t border-rule pt-3">
                <p className="font-semibold text-sm text-night">Refunds</p>
                <ul className="mt-2 divide-y divide-rule rounded-md border border-rule bg-white" aria-label="Refunds">
                  {detail.refunds.map((r) => (
                    <li key={r.id} className="p-3 text-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-night">{money(r.amount)}</p>
                          <p className="text-xs text-muted">
                            {r.reason} · {formatDate(r.createdAt)}
                            {r.processedAt ? ` · processed ${formatDate(r.processedAt)}` : ''}
                          </p>
                          {r.status === 'FAILED' && r.failureReason && <p className="mt-0.5 text-xs text-danger">{r.failureReason}</p>}
                        </div>
                        <Badge tone={REFUND_BADGES[r.status].tone}>{REFUND_BADGES[r.status].label}</Badge>
                      </div>
                      {r.creditNote && (
                        <div className="mt-2 flex items-center justify-between gap-3 text-xs">
                          <span className="text-muted">
                            Credit note <span className="font-mono text-night">{r.creditNote.number}</span>
                          </span>
                          {r.creditNote.pdfReady ? (
                            <Button variant="ghost" size="sm" onClick={() => downloadCreditNote(r.creditNote!.id)} aria-label={`Download credit note ${r.creditNote.number}`}>
                              Download
                            </Button>
                          ) : (
                            <span className="text-muted">PDF being prepared…</span>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Dialog>

      {detail && canRefund && (
        <RefundDialog
          key={refundOpenings}
          payment={detail}
          open={refunding}
          onClose={() => setRefunding(false)}
          onRefunded={(r) => {
            setRefunding(false);
            toast(r.status === 'FAILED' ? 'The refund failed.' : `Refund of ${money(r.amount)} started. It completes when the gateway confirms it.`, r.status === 'FAILED' ? 'error' : 'success');
            void loadPaymentDetail(detail.id);
            setReload((n) => n + 1);
          }}
        />
      )}
    </div>
  );
}
