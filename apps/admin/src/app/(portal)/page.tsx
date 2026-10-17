'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Badge, Button, EmptyState, Notice } from '@biznexa/ui';
import { useApi } from '@biznexa/api-client/react';
import {
  type ReportDashboardResponse,
  type ReportPreset,
  formatDate,
  formatINR,
  PERMS,
} from '@biznexa/types';
import { useAuth } from '@/lib/auth';
import { visibleNav } from '@/lib/nav';

const PRESETS: { id: ReportPreset; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'last 7 days', label: 'Last 7 Days' },
  { id: 'this month', label: 'This Month' },
  { id: 'last month', label: 'Last Month' },
];

export default function DashboardPage() {
  const { user } = useAuth();
  const { call } = useApi();

  const [preset, setPreset] = useState<ReportPreset>('last 7 days');
  const [data, setData] = useState<ReportDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  const canViewReports = Boolean(user?.permissions.includes(PERMS.REPORTS_VIEW));

  useEffect(() => {
    if (!canViewReports) return;
    let cancel = false;

    call((api) =>
      api.GET('/api/admin/reports/dashboard', {
        params: { query: { preset } },
      }),
    )
      .then((res) => {
        if (!cancel) {
          setData(res as ReportDashboardResponse);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancel) {
          setError(err instanceof Error ? err.message : 'Failed to load dashboard metrics');
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

  if (!user) return null;

  const sections = visibleNav(user.permissions)
    .flatMap((g) => g.items)
    .filter((i) => i.slug !== '');

  return (
    <div className="max-w-[1020px] space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-[-0.02em] text-night">
            Welcome, {user.name.split(' ')[0]}
          </h1>
          <p className="mt-1 text-sm text-muted">
            Signed in as {user.roles.map((r) => r.charAt(0) + r.slice(1).toLowerCase()).join(', ')}.
          </p>
        </div>

        {canViewReports && (
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
        )}
      </div>

      {canViewReports && (
        <>
          {/* Error State */}
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
            <div className="space-y-6 animate-pulse" data-testid="dashboard-loading">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-28 rounded-xl border border-rule bg-white p-5" />
                ))}
              </div>
              <div className="h-64 rounded-xl border border-rule bg-white p-5" />
            </div>
          )}

          {/* KPI Cards */}
          {data && (
            <div className="space-y-8">
              <section aria-label="Key Performance Indicators">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {/* Revenue */}
                  <div className="rounded-xl border border-rule bg-white p-5 shadow-xs">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted">Revenue</span>
                    <p className="mt-2 text-2xl font-bold tracking-tight text-ink num">
                      {formatINR(data.kpis.revenue)}
                    </p>
                    <span className="mt-1 block text-xs text-muted">Net of refunds in period</span>
                  </div>

                  {/* Orders */}
                  <div className="rounded-xl border border-rule bg-white p-5 shadow-xs">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted">Orders</span>
                    <p className="mt-2 text-2xl font-bold tracking-tight text-night num">
                      {data.kpis.orders.toLocaleString('en-IN')}
                    </p>
                    <span className="mt-1 block text-xs text-muted">Placed in period</span>
                  </div>

                  {/* New Customers */}
                  <div className="rounded-xl border border-rule bg-white p-5 shadow-xs">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted">New Customers</span>
                    <p className="mt-2 text-2xl font-bold tracking-tight text-night num">
                      {data.kpis.newCustomers.toLocaleString('en-IN')}
                    </p>
                    <span className="mt-1 block text-xs text-muted">Registered in period</span>
                  </div>

                  {/* Active Applications */}
                  <div className="rounded-xl border border-rule bg-white p-5 shadow-xs">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted">Active Applications</span>
                    <p className="mt-2 text-2xl font-bold tracking-tight text-seal num">
                      {data.kpis.activeApplications.toLocaleString('en-IN')}
                    </p>
                    <span className="mt-1 block text-xs text-muted">In-progress or review</span>
                  </div>
                </div>
              </section>

              {/* Revenue & Orders Daily Series Chart */}
              <section className="rounded-xl border border-rule bg-white p-5 shadow-xs">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-base font-bold text-night">Revenue & Orders Activity</h2>
                    <p className="text-xs text-muted">
                      From {formatDate(data.range.from)} to {formatDate(data.range.to)} (IST)
                    </p>
                  </div>
                  <div className="flex items-center gap-4 text-xs font-medium text-muted">
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block h-3 w-3 rounded-xs bg-ink" /> Revenue
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block h-3 w-3 rounded-xs bg-marigold" /> Orders
                    </span>
                  </div>
                </div>

                {data.series.length === 0 ? (
                  <EmptyState
                    className="mt-6"
                    title="No activity data"
                    description="No orders or payments recorded for this period."
                  />
                ) : (
                  <div className="mt-6 overflow-x-auto">
                    <div className="min-w-[320px] space-y-3">
                      {/* Bar comparison per day */}
                      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-7">
                        {data.series.map((point) => (
                          <div
                            key={point.date}
                            className="rounded-lg border border-rule/60 bg-paper/50 p-2.5 text-center transition-colors hover:border-ink/40"
                          >
                            <span className="block text-xs font-semibold text-muted">
                              {formatDate(point.date)}
                            </span>
                            <p className="mt-1.5 text-sm font-bold text-ink num">
                              {formatINR(point.revenue)}
                            </p>
                            <span className="mt-0.5 inline-block rounded-xs bg-amber-050 px-1.5 py-0.5 text-[11px] font-semibold text-amber num">
                              {point.orders} {point.orders === 1 ? 'order' : 'orders'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </section>

              {/* Needs Attention Queue */}
              <section className="space-y-4">
                <h2 className="text-lg font-bold tracking-tight text-night">Needs Attention</h2>
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                  {/* SLA Breaches */}
                  <div className="rounded-xl border border-rule bg-white p-5 shadow-xs">
                    <div className="flex items-center justify-between pb-3 border-b border-rule">
                      <h3 className="font-semibold text-night flex items-center gap-2">
                        <span className="inline-block h-2.5 w-2.5 rounded-full bg-danger" />
                        SLA Breaches
                      </h3>
                      <Badge tone={data.needsAttention.slaBreaches.length > 0 ? 'danger' : 'neutral'}>
                        {data.needsAttention.slaBreaches.length}
                      </Badge>
                    </div>

                    {data.needsAttention.slaBreaches.length === 0 ? (
                      <p className="mt-4 text-sm text-muted">No applications currently breaching SLA.</p>
                    ) : (
                      <ul className="mt-3 divide-y divide-rule/60">
                        {data.needsAttention.slaBreaches.map((b) => (
                          <li key={b.id} className="py-2.5 first:pt-0 last:pb-0">
                            <Link
                              href={b.link}
                              className="group flex items-start justify-between gap-2 hover:text-ink"
                            >
                              <div>
                                <span className="font-semibold text-ink group-hover:underline">
                                  {b.code}
                                </span>
                                <span className="ml-2 text-xs text-muted">({b.serviceName})</span>
                                <p className="text-xs text-muted">Customer: {b.customerName}</p>
                              </div>
                              <span className="text-right text-xs font-semibold text-danger num">
                                Due {formatDate(b.slaDueAt)}
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {/* Documents Waiting > 24h */}
                  <div className="rounded-xl border border-rule bg-white p-5 shadow-xs">
                    <div className="flex items-center justify-between pb-3 border-b border-rule">
                      <h3 className="font-semibold text-night flex items-center gap-2">
                        <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber" />
                        Documents Waiting &gt; 24h
                      </h3>
                      <Badge tone={data.needsAttention.waitingDocuments.length > 0 ? 'warning' : 'neutral'}>
                        {data.needsAttention.waitingDocuments.length}
                      </Badge>
                    </div>

                    {data.needsAttention.waitingDocuments.length === 0 ? (
                      <p className="mt-4 text-sm text-muted">No documents pending review over 24 hours.</p>
                    ) : (
                      <ul className="mt-3 divide-y divide-rule/60">
                        {data.needsAttention.waitingDocuments.map((doc) => (
                          <li key={doc.id} className="py-2.5 first:pt-0 last:pb-0">
                            <Link
                              href={doc.link}
                              className="group flex items-start justify-between gap-2 hover:text-ink"
                            >
                              <div>
                                <span className="font-semibold text-night group-hover:text-ink group-hover:underline">
                                  {doc.documentName}
                                </span>
                                <span className="ml-2 text-xs text-muted">
                                  ({doc.applicationCode} · {doc.serviceName})
                                </span>
                              </div>
                              <span className="text-right text-xs text-muted">
                                Uploaded {formatDate(doc.uploadedAt)}
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </section>
            </div>
          )}
        </>
      )}

      {/* Your Sections */}
      <section className="pt-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">Your Sections</h2>
        {sections.length === 0 ? (
          <EmptyState
            className="mt-3"
            title="No sections yet"
            description="No sections are assigned to your role yet. Ask an admin to grant access."
          />
        ) : (
          <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sections.map((s) => (
              <li key={s.slug}>
                <Link
                  href={`/${s.slug}`}
                  className="block rounded-lg border border-rule bg-white p-4 font-medium transition-colors hover:border-ink hover:text-ink"
                >
                  {s.label}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
