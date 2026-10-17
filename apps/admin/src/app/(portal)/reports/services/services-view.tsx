'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Badge, Button, EmptyState, Notice } from '@biznexa/ui';
import { useApi } from '@biznexa/api-client/react';
import {
  type ReportPreset,
  type ReportServicesResponse,
  formatDate,
  formatINR,
  PERMS,
} from '@biznexa/types';
import { useAuth } from '@/lib/auth';
import { ReportsNav } from '../reports-nav';
import { ExportButton } from '../export-button';

const PRESETS: { id: ReportPreset; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'last 7 days', label: 'Last 7 Days' },
  { id: 'this month', label: 'This Month' },
  { id: 'last month', label: 'Last Month' },
];

export function ServicesReportView() {
  const { user } = useAuth();
  const { call } = useApi();

  const [preset, setPreset] = useState<ReportPreset>('last 7 days');
  const [data, setData] = useState<ReportServicesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  const canViewReports = Boolean(user?.permissions.includes(PERMS.REPORTS_VIEW));

  useEffect(() => {
    if (!canViewReports) return;
    let cancel = false;

    call((api) =>
      api.GET('/api/admin/reports/services', {
        params: { query: { preset } },
      }),
    )
      .then((res) => {
        if (!cancel) {
          setData(res as ReportServicesResponse);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancel) {
          setError(err instanceof Error ? err.message : 'Failed to load services report');
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
          Access Denied: You need the reports.view permission to view service reports.
        </Notice>
      </div>
    );
  }

  const isEmpty =
    data?.summary.totalOrders === 0 &&
    data.summary.totalRevenue === 0 &&
    data.popularServices.length === 0 &&
    data.applicationsByStatus.length === 0;

  const totalStatusCount = data
    ? data.applicationsByStatus.reduce((acc, s) => acc + s.count, 0)
    : 0;

  return (
    <div className="max-w-[1020px] space-y-8">
      <ReportsNav />

      {/* Controls & Filter Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-night">Services Report</h2>
          {data && (
            <p className="mt-0.5 text-xs text-muted">
              Period (IST): {formatDate(new Date(data.range.from))} — {formatDate(new Date(data.range.to))}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
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
          <ExportButton type="services" preset={preset} />
        </div>
      </div>

      {/* Error state */}
      {error && (
        <Notice tone="error">
          <div className="flex items-center justify-between">
            <span>{error}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setLoading(true);
                setReload((r) => r + 1);
              }}
            >
              Retry
            </Button>
          </div>
        </Notice>
      )}

      {/* Loading state skeleton */}
      {loading && !data && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl border border-rule bg-paper" />
          ))}
        </div>
      )}

      {data && (
        <>
          {/* KPI Summary Cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-rule bg-white p-5 shadow-xs">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">Total Orders</p>
              <p className="mt-2 text-3xl font-extrabold tracking-tight text-night">
                {data.summary.totalOrders}
              </p>
              <p className="mt-1 text-xs text-muted">In selected period</p>
            </div>

            <div className="rounded-xl border border-rule bg-white p-5 shadow-xs">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">Total Revenue</p>
              <p className="mt-2 text-3xl font-extrabold tracking-tight text-ink">
                {formatINR(data.summary.totalRevenue)}
              </p>
              <p className="mt-1 text-xs text-muted">Net orders revenue</p>
            </div>

            <div className="rounded-xl border border-rule bg-white p-5 shadow-xs">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">Avg Turnaround</p>
              <p className="mt-2 text-3xl font-extrabold tracking-tight text-night">
                {data.summary.avgTurnaroundDays > 0 ? `${data.summary.avgTurnaroundDays} d` : '—'}
              </p>
              <p className="mt-1 text-xs text-muted">Submitted to completion</p>
            </div>

            <div className="rounded-xl border border-rule bg-white p-5 shadow-xs">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">SLA Breaches</p>
              <div className="mt-2 flex items-baseline gap-2">
                <span
                  className={`text-3xl font-extrabold tracking-tight ${
                    data.summary.totalSlaBreaches > 0 ? 'text-amber-600' : 'text-night'
                  }`}
                >
                  {data.summary.totalSlaBreaches}
                </span>
                {data.summary.totalSlaBreaches > 0 && (
                  <Badge tone="warning">Action Needed</Badge>
                )}
              </div>
              <p className="mt-1 text-xs text-muted">Overdue applications</p>
            </div>
          </div>

          {isEmpty ? (
            <div className="rounded-xl border border-rule bg-white p-8">
              <EmptyState
                title="No service records for this period"
                description="There were no orders, status changes, or SLA events in the selected date range."
              />
            </div>
          ) : (
            <>
              {/* Popular Services Table */}
              <div className="rounded-xl border border-rule bg-white shadow-xs">
                <div className="border-b border-rule px-5 py-4">
                  <h3 className="text-base font-bold text-night">Popular Services</h3>
                  <p className="mt-0.5 text-xs text-muted">
                    Ranked by revenue and order volume in the selected date range.
                  </p>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-rule bg-paper/60 text-xs font-semibold text-muted">
                        <th className="px-5 py-3">#</th>
                        <th className="px-5 py-3">Service</th>
                        <th className="px-5 py-3">Category</th>
                        <th className="px-5 py-3 text-right">Orders</th>
                        <th className="px-5 py-3 text-right">Revenue</th>
                        <th className="px-5 py-3 text-right">Avg Turnaround</th>
                        <th className="px-5 py-3 text-right">SLA Breaches</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-rule">
                      {data.popularServices.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-5 py-8 text-center text-muted">
                            No service orders in this period.
                          </td>
                        </tr>
                      ) : (
                        data.popularServices.map((svc, idx) => (
                          <tr key={svc.serviceId} className="hover:bg-paper/40 transition-colors">
                            <td className="px-5 py-3 font-mono text-xs text-muted">{idx + 1}</td>
                            <td className="px-5 py-3 font-medium text-night">
                              <Link
                                href={`/services/${svc.serviceId}`}
                                className="hover:text-ink hover:underline"
                              >
                                {svc.serviceName}
                              </Link>
                            </td>
                            <td className="px-5 py-3 text-muted">{svc.categoryName}</td>
                            <td className="px-5 py-3 text-right font-medium text-night">{svc.orders}</td>
                            <td className="px-5 py-3 text-right font-semibold text-night">
                              {formatINR(svc.revenue)}
                            </td>
                            <td className="px-5 py-3 text-right text-night">
                              {svc.avgTurnaroundDays !== null ? `${svc.avgTurnaroundDays} d` : '—'}
                            </td>
                            <td className="px-5 py-3 text-right">
                              {svc.slaBreaches > 0 ? (
                                <Badge tone="warning">{svc.slaBreaches}</Badge>
                              ) : (
                                <span className="text-muted">0</span>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Applications by Status & SLA Breaches Grid */}
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                {/* Applications by Status */}
                <div className="rounded-xl border border-rule bg-white shadow-xs">
                  <div className="border-b border-rule px-5 py-4">
                    <h3 className="text-base font-bold text-night">Applications by Status</h3>
                    <p className="mt-0.5 text-xs text-muted">
                      Status breakdown of applications created in this period.
                    </p>
                  </div>
                  <div className="p-5">
                    {data.applicationsByStatus.length === 0 ? (
                      <p className="py-4 text-center text-xs text-muted">No applications created in this period.</p>
                    ) : (
                      <div className="space-y-3">
                        {data.applicationsByStatus.map((item) => {
                          const percent = totalStatusCount > 0 ? Math.round((item.count / totalStatusCount) * 100) : 0;
                          return (
                            <div key={item.status} className="space-y-1">
                              <div className="flex items-center justify-between text-xs">
                                <span className="font-medium text-night">{item.label}</span>
                                <span className="text-muted">
                                  {item.count} ({percent}%)
                                </span>
                              </div>
                              <div className="h-2 w-full overflow-hidden rounded-full bg-paper">
                                <div
                                  className="h-full bg-ink transition-all"
                                  style={{ width: `${percent}%` }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                {/* SLA Breaches per Service */}
                <div className="rounded-xl border border-rule bg-white shadow-xs">
                  <div className="border-b border-rule px-5 py-4">
                    <h3 className="text-base font-bold text-night">SLA Breaches per Service</h3>
                    <p className="mt-0.5 text-xs text-muted">
                      Active applications overdue against their SLA target.
                    </p>
                  </div>
                  <div className="p-5">
                    {data.slaBreaches.length === 0 ? (
                      <div className="py-6 text-center">
                        <Badge tone="success">All SLAs on Track</Badge>
                        <p className="mt-2 text-xs text-muted">No overdue applications across any service.</p>
                      </div>
                    ) : (
                      <div className="divide-y divide-rule">
                        {data.slaBreaches.map((b) => (
                          <div key={b.serviceId} className="flex items-center justify-between py-2.5">
                            <div>
                              <p className="text-sm font-medium text-night">{b.serviceName}</p>
                              <p className="text-xs text-muted">{b.categoryName}</p>
                            </div>
                            <Badge tone="warning">{b.breachCount} breached</Badge>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
