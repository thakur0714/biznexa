'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Badge, Button, EmptyState, Notice, type Tone } from '@biznexa/ui';
import { useApi } from '@biznexa/api-client/react';
import {
  type ReportConsultantsResponse,
  type ReportPreset,
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

function consultantStatusTone(status: string): Tone {
  if (status === 'APPROVED') return 'success';
  if (status === 'PENDING') return 'warning';
  return 'danger';
}

function consultantVerificationTone(status: string): Tone {
  if (status === 'APPROVED') return 'success';
  if (status === 'PENDING') return 'warning';
  return 'neutral';
}

export function ConsultantsReportView() {
  const { user } = useAuth();
  const { call } = useApi();

  const [preset, setPreset] = useState<ReportPreset>('last 7 days');
  const [data, setData] = useState<ReportConsultantsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  const canViewReports = Boolean(user?.permissions.includes(PERMS.REPORTS_VIEW));

  useEffect(() => {
    if (!canViewReports) return;
    let cancel = false;

    call((api) =>
      api.GET('/api/admin/reports/consultants', {
        params: { query: { preset } },
      }),
    )
      .then((res) => {
        if (!cancel) {
          setData(res as ReportConsultantsResponse);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancel) {
          setError(err instanceof Error ? err.message : 'Failed to load consultants report');
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
          Access Denied: You need the reports.view permission to view consultant reports.
        </Notice>
      </div>
    );
  }

  const isEmpty = data?.summary.total === 0;

  return (
    <div className="max-w-[1020px] space-y-8">
      <ReportsNav />

      {/* Controls & Filter Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-night">Consultants Report</h2>
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
          <ExportButton type="consultants" preset={preset} />
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl border border-rule bg-paper" />
          ))}
        </div>
      )}

      {data && (
        <>
          {/* KPI Summary Cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <div className="rounded-xl border border-rule bg-white p-5 shadow-xs">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">Total Consultants</p>
              <p className="mt-2 text-3xl font-extrabold tracking-tight text-night">
                {data.summary.total}
              </p>
              <p className="mt-1 text-xs text-muted">Registered platform experts</p>
            </div>

            <div className="rounded-xl border border-rule bg-white p-5 shadow-xs">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">Active Experts</p>
              <p className="mt-2 text-3xl font-extrabold tracking-tight text-night">
                {data.summary.active}
              </p>
              <p className="mt-1 text-xs text-muted">Approved & active status</p>
            </div>

            <div className="rounded-xl border border-rule bg-white p-5 shadow-xs">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">Bookings Count</p>
              <p className="mt-2 text-3xl font-extrabold tracking-tight text-night">
                {data.summary.bookingsCount}
              </p>
              <p className="mt-1 text-xs text-muted">In selected period</p>
            </div>

            <div className="rounded-xl border border-rule bg-white p-5 shadow-xs">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">Booking Revenue</p>
              <p className="mt-2 text-3xl font-extrabold tracking-tight text-ink">
                {formatINR(data.summary.bookingRevenue)}
              </p>
              <p className="mt-1 text-xs text-muted">Successful payments</p>
            </div>

            <div className="rounded-xl border border-rule bg-white p-5 shadow-xs">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">Average Rating</p>
              <p className="mt-2 text-3xl font-extrabold tracking-tight text-amber-600">
                {data.summary.averageRating > 0 ? `★ ${data.summary.averageRating}` : '—'}
              </p>
              <p className="mt-1 text-xs text-muted">Approved experts</p>
            </div>
          </div>

          {isEmpty ? (
            <div className="rounded-xl border border-rule bg-white p-8">
              <EmptyState
                title="No consultants found"
                description="There are currently no registered consultants on the platform."
              />
            </div>
          ) : (
            <>
              {/* Verification Status Breakdown */}
              <div className="rounded-xl border border-rule bg-white p-5 shadow-xs">
                <h3 className="text-sm font-bold uppercase tracking-wider text-muted">
                  Verification Status Breakdown
                </h3>
                <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                  {data.byVerificationStatus.map((statusItem) => (
                    <div
                      key={statusItem.status}
                      className="rounded-lg border border-rule/60 bg-paper/50 p-3"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-night">{statusItem.label}</span>
                        <Badge
                          tone={consultantStatusTone(statusItem.status)}
                        >
                          {statusItem.count}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xl font-extrabold text-night">{statusItem.count}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Consultants Table */}
              <div className="rounded-xl border border-rule bg-white shadow-xs">
                <div className="border-b border-rule px-5 py-4">
                  <h3 className="text-base font-bold text-night">Consultant Performance</h3>
                  <p className="mt-0.5 text-xs text-muted">
                    Bookings count and revenue generated by consultants in this period.
                  </p>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-rule bg-paper/60 text-xs font-semibold text-muted">
                        <th className="px-5 py-3">#</th>
                        <th className="px-5 py-3">Consultant</th>
                        <th className="px-5 py-3">Category</th>
                        <th className="px-5 py-3">Status</th>
                        <th className="px-5 py-3 text-right">Rating</th>
                        <th className="px-5 py-3 text-right">Bookings</th>
                        <th className="px-5 py-3 text-right">Revenue</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-rule">
                      {data.consultants.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-5 py-8 text-center text-muted">
                            No consultant activity found.
                          </td>
                        </tr>
                      ) : (
                        data.consultants.map((c, idx) => (
                          <tr key={c.consultantId} className="hover:bg-paper/40 transition-colors">
                            <td className="px-5 py-3 font-mono text-xs text-muted">{idx + 1}</td>
                            <td className="px-5 py-3 font-medium text-night">
                              <Link
                                href={`/consultants/${c.consultantId}`}
                                className="hover:text-ink hover:underline"
                              >
                                {c.name}
                              </Link>
                            </td>
                            <td className="px-5 py-3 text-muted">{c.category}</td>
                            <td className="px-5 py-3">
                              <Badge
                                tone={consultantVerificationTone(c.verificationStatus)}
                              >
                                {c.verificationStatus}
                              </Badge>
                            </td>
                            <td className="px-5 py-3 text-right font-medium text-amber-600">
                              {c.rating > 0 ? `★ ${c.rating}` : '—'}
                              {c.reviewCount > 0 && (
                                <span className="ml-1 text-xs text-muted">({c.reviewCount})</span>
                              )}
                            </td>
                            <td className="px-5 py-3 text-right font-medium text-night">
                              {c.bookingsCount}
                            </td>
                            <td className="px-5 py-3 text-right font-semibold text-night">
                              {formatINR(c.bookingRevenue)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
