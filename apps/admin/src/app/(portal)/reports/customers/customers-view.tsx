'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button, Notice } from '@biznexa/ui';
import { useApi } from '@biznexa/api-client/react';
import {
  type ReportCustomersResponse,
  type ReportPreset,
  formatDate,
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

export function CustomersReportView() {
  const { user } = useAuth();
  const { call } = useApi();

  const [preset, setPreset] = useState<ReportPreset>('last 7 days');
  const [data, setData] = useState<ReportCustomersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  const canViewReports = Boolean(user?.permissions.includes(PERMS.REPORTS_VIEW));

  useEffect(() => {
    if (!canViewReports) return;
    let cancel = false;

    call((api) =>
      api.GET('/api/admin/reports/customers', {
        params: { query: { preset } },
      }),
    )
      .then((res) => {
        if (!cancel) {
          setData(res as ReportCustomersResponse);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancel) {
          setError(err instanceof Error ? err.message : 'Failed to load customers report');
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
          Access Denied: You need the reports.view permission to view customer reports.
        </Notice>
      </div>
    );
  }

  const activePercent = data && data.total > 0
    ? Math.round((data.activeLast90Days / data.total) * 100)
    : 0;

  return (
    <div className="max-w-[1020px] space-y-8">
      <ReportsNav />

      {/* Controls & Filter Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-night">Customers Report</h2>
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
          <ExportButton type="customers" preset={preset} />
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
        <div className="space-y-6 animate-pulse" data-testid="customers-loading">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="h-32 rounded-xl border border-rule bg-white p-5" />
            <div className="h-32 rounded-xl border border-rule bg-white p-5" />
            <div className="h-32 rounded-xl border border-rule bg-white p-5" />
          </div>
          <div className="h-44 rounded-xl border border-rule bg-white p-5" />
        </div>
      )}

      {/* Data Views */}
      {data && (
        <div className="space-y-8">
          {/* KPI Cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-rule bg-white p-5 shadow-xs">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted">
                Total Customers
              </span>
              <div className="mt-2 text-3xl font-bold text-night num">
                {data.total.toLocaleString('en-IN')}
              </div>
              <span className="mt-1 block text-xs text-muted">
                Registered platform user accounts
              </span>
            </div>

            <div className="rounded-xl border border-rule bg-white p-5 shadow-xs">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted">
                New Customers
              </span>
              <div className="mt-2 text-3xl font-bold text-ink num">
                {data.newInRange.toLocaleString('en-IN')}
              </div>
              <span className="mt-1 block text-xs text-muted">
                Signed up in selected date range
              </span>
            </div>

            <div className="rounded-xl border border-rule bg-white p-5 shadow-xs">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted">
                Active in Last 90 Days
              </span>
              <div className="mt-2 text-3xl font-bold text-seal num">
                {data.activeLast90Days.toLocaleString('en-IN')}
              </div>
              <span className="mt-1 block text-xs text-muted">
                Has order or application activity
              </span>
            </div>
          </div>

          {/* Activity & Insights Section */}
          <div className="rounded-xl border border-rule bg-white p-6 shadow-xs">
            <h3 className="text-base font-semibold text-night">Engagement & Retention Insights</h3>
            <div className="mt-4 grid grid-cols-1 gap-6 md:grid-cols-2">
              <div className="rounded-lg border border-rule/70 bg-paper/50 p-4">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted">
                  90-Day Engagement Rate
                </span>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-night num">{activePercent}%</span>
                  <span className="text-xs text-muted">of total customer base</span>
                </div>
                <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-rule/50">
                  <div
                    className="h-full rounded-full bg-seal transition-all duration-500"
                    style={{ width: `${Math.min(100, Math.max(0, activePercent))}%` }}
                  />
                </div>
                <p className="mt-2 text-xs text-muted">
                  Calculated from users with active orders or application milestones updated in the past 90 days.
                </p>
              </div>

              <div className="rounded-lg border border-rule/70 bg-paper/50 p-4 flex flex-col justify-between">
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted">
                    Customer Management
                  </span>
                  <p className="mt-2 text-sm text-night font-medium">
                    View customer directories and individual profiles
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    Review KYC documents, business entities, and past transaction records.
                  </p>
                </div>
                <div className="mt-4">
                  <Link
                    href="/customers"
                    className="inline-flex items-center text-xs font-semibold text-ink hover:underline"
                  >
                    Open Customer Directory &rarr;
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
