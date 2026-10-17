'use client';

import { useEffect, useState } from 'react';
import { Badge, Button, EmptyState, Notice } from '@biznexa/ui';
import { useApi } from '@biznexa/api-client/react';
import {
  type ReportPreset,
  type ReportSalesResponse,
  formatDate,
  formatINR,
  PERMS,
} from '@biznexa/types';
import { useAuth } from '@/lib/auth';
import { ReportsNav } from '../reports-nav';

const PRESETS: { id: ReportPreset; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'last 7 days', label: 'Last 7 Days' },
  { id: 'this month', label: 'This Month' },
  { id: 'last month', label: 'Last Month' },
];

export function SalesReportView() {
  const { user } = useAuth();
  const { call } = useApi();

  const [preset, setPreset] = useState<ReportPreset>('last 7 days');
  const [data, setData] = useState<ReportSalesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  const canViewReports = Boolean(user?.permissions.includes(PERMS.REPORTS_VIEW));

  useEffect(() => {
    if (!canViewReports) return;
    let cancel = false;

    call((api) =>
      api.GET('/api/admin/reports/sales', {
        params: { query: { preset } },
      }),
    )
      .then((res) => {
        if (!cancel) {
          setData(res as ReportSalesResponse);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancel) {
          setError(err instanceof Error ? err.message : 'Failed to load sales report');
        }
      })
      .finally(() => {
        if (!cancel) {
          setLoading(false);
        }
      });

    return () => {
      cancel = true;
    };
  }, [call, canViewReports, preset, reload]);

  if (!canViewReports) {
    return (
      <div className="max-w-[1020px] space-y-6">
        <ReportsNav />
        <Notice tone="error">
          Access Denied: You need the reports.view permission to view sales reports.
        </Notice>
      </div>
    );
  }

  const isEmpty = data?.total.orders === 0 && data.total.revenue === 0;

  return (
    <div className="max-w-[1020px] space-y-8">
      <ReportsNav />

      {/* Controls & Filter Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-night">Sales Report</h2>
          {data && (
            <p className="mt-0.5 text-xs text-muted">
              Period (IST): {formatDate(new Date(data.range.from))} — {formatDate(new Date(data.range.to))}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-rule bg-white p-1">
          {PRESETS.map((p) => {
            const active = preset === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setPreset(p.id);
                  setLoading(true);
                }}
                className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
                  active
                    ? 'bg-ink text-white shadow-xs'
                    : 'text-muted hover:bg-paper hover:text-night'
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Error state */}
      {error && (
        <Notice tone="error">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span>{error}</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setError(null);
                setLoading(true);
                setReload((r) => r + 1);
              }}
            >
              Retry
            </Button>
          </div>
        </Notice>
      )}

      {/* Loading Skeleton */}
      {loading && !data && (
        <div className="space-y-6 animate-pulse" data-testid="sales-loading">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="h-28 rounded-xl border border-rule bg-white p-5" />
            <div className="h-28 rounded-xl border border-rule bg-white p-5" />
            <div className="h-28 rounded-xl border border-rule bg-white p-5" />
            <div className="h-28 rounded-xl border border-rule bg-white p-5" />
          </div>
          <div className="h-48 rounded-xl border border-rule bg-white p-5" />
          <div className="h-48 rounded-xl border border-rule bg-white p-5" />
        </div>
      )}

      {/* Empty State */}
      {!loading && isEmpty && (
        <EmptyState
          title="No sales in selected period"
          description="There are no successful payments or orders recorded for this date range."
        />
      )}

      {/* Data Views */}
      {data && !isEmpty && (
        <div className="space-y-8">
          {/* Summary KPIs */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-rule bg-white p-5 shadow-xs">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted">
                Net Revenue
              </span>
              <div className="mt-2 text-2xl font-bold text-night num">
                {formatINR(data.total.revenue)}
              </div>
              <span className="mt-1 block text-xs text-muted">
                After refunds deducted
              </span>
            </div>

            <div className="rounded-xl border border-rule bg-white p-5 shadow-xs">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted">
                Total Orders
              </span>
              <div className="mt-2 text-2xl font-bold text-night num">
                {data.total.orders.toLocaleString('en-IN')}
              </div>
              <span className="mt-1 block text-xs text-muted">
                Created within period
              </span>
            </div>

            <div className="rounded-xl border border-rule bg-white p-5 shadow-xs">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted">
                Discounts Given
              </span>
              <div className="mt-2 text-2xl font-bold text-seal num">
                {formatINR(data.total.discountTotal)}
              </div>
              <span className="mt-1 block text-xs text-muted">
                Coupon & promotional savings
              </span>
            </div>

            <div className="rounded-xl border border-rule bg-white p-5 shadow-xs">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted">
                Refunds
              </span>
              <div className="mt-2 text-2xl font-bold text-danger num">
                {formatINR(data.total.refundTotal)}
              </div>
              <span className="mt-1 block text-xs text-muted">
                Processed refund amounts
              </span>
            </div>
          </div>

          {/* Monthly Trend Table */}
          <section className="rounded-xl border border-rule bg-white p-5 shadow-xs">
            <h3 className="font-semibold text-night">Monthly Breakdown</h3>
            {data.monthly.length === 0 ? (
              <p className="mt-3 text-sm text-muted">No monthly data available.</p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-rule text-xs font-semibold uppercase tracking-wider text-muted">
                      <th className="pb-3 pr-4">Month</th>
                      <th className="pb-3 px-4 text-right">Orders</th>
                      <th className="pb-3 pl-4 text-right">Revenue</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-rule/60">
                    {data.monthly.map((row) => (
                      <tr key={row.month} className="hover:bg-paper/40">
                        <td className="py-3 pr-4 font-medium text-night">{row.label}</td>
                        <td className="py-3 px-4 text-right text-muted num">{row.orders.toLocaleString('en-IN')}</td>
                        <td className="py-3 pl-4 text-right font-semibold text-ink num">{formatINR(row.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Service-wise Breakdown */}
          <section className="rounded-xl border border-rule bg-white p-5 shadow-xs">
            <h3 className="font-semibold text-night">Service-wise Breakdown</h3>
            {data.serviceWise.length === 0 ? (
              <p className="mt-3 text-sm text-muted">No service breakdown data available.</p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-rule text-xs font-semibold uppercase tracking-wider text-muted">
                      <th className="pb-3 pr-4">Service</th>
                      <th className="pb-3 px-4">Category</th>
                      <th className="pb-3 px-4 text-right">Orders</th>
                      <th className="pb-3 pl-4 text-right">Revenue</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-rule/60">
                    {data.serviceWise.map((svc) => (
                      <tr key={svc.serviceId} className="hover:bg-paper/40">
                        <td className="py-3 pr-4 font-semibold text-night">{svc.serviceName}</td>
                        <td className="py-3 px-4 text-muted">{svc.categoryName}</td>
                        <td className="py-3 px-4 text-right text-muted num">{svc.orders.toLocaleString('en-IN')}</td>
                        <td className="py-3 pl-4 text-right font-semibold text-ink num">{formatINR(svc.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Category-wise Breakdown */}
          <section className="rounded-xl border border-rule bg-white p-5 shadow-xs">
            <h3 className="font-semibold text-night">Category-wise Breakdown</h3>
            {data.categoryWise.length === 0 ? (
              <p className="mt-3 text-sm text-muted">No category breakdown data available.</p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-rule text-xs font-semibold uppercase tracking-wider text-muted">
                      <th className="pb-3 pr-4">Category</th>
                      <th className="pb-3 px-4 text-right">Orders</th>
                      <th className="pb-3 pl-4 text-right">Revenue</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-rule/60">
                    {data.categoryWise.map((cat) => (
                      <tr key={cat.categoryId} className="hover:bg-paper/40">
                        <td className="py-3 pr-4 font-semibold text-night">{cat.categoryName}</td>
                        <td className="py-3 px-4 text-right text-muted num">{cat.orders.toLocaleString('en-IN')}</td>
                        <td className="py-3 pl-4 text-right font-semibold text-ink num">{formatINR(cat.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Coupon Impact */}
          <section className="rounded-xl border border-rule bg-white p-5 shadow-xs">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between pb-3 border-b border-rule">
              <div>
                <h3 className="font-semibold text-night">Coupon Impact</h3>
                <p className="text-xs text-muted">
                  Total discount provided: <span className="font-semibold text-seal">{formatINR(data.couponImpact.discountGiven)}</span> across{' '}
                  <span className="font-semibold text-night">{data.couponImpact.ordersWithCoupon}</span> orders
                </p>
              </div>
            </div>

            {data.couponImpact.coupons.length === 0 ? (
              <p className="mt-4 text-sm text-muted">No coupons used during this period.</p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-rule text-xs font-semibold uppercase tracking-wider text-muted">
                      <th className="pb-3 pr-4">Coupon Code</th>
                      <th className="pb-3 px-4">Type</th>
                      <th className="pb-3 px-4 text-right">Orders Applied</th>
                      <th className="pb-3 pl-4 text-right">Total Discount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-rule/60">
                    {data.couponImpact.coupons.map((c) => (
                      <tr key={c.code} className="hover:bg-paper/40">
                        <td className="py-3 pr-4 font-mono font-bold text-ink">{c.code}</td>
                        <td className="py-3 px-4">
                          <Badge tone="neutral">{c.type}</Badge>
                        </td>
                        <td className="py-3 px-4 text-right text-muted num">{c.ordersCount.toLocaleString('en-IN')}</td>
                        <td className="py-3 pl-4 text-right font-semibold text-seal num">{formatINR(c.discountGiven)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
