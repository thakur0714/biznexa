'use client';

import { useEffect, useState } from 'react';
import { useApi } from '@biznexa/api-client/react';
import { PERMS, type ReportSupportResponse } from '@biznexa/types';
import { Badge, EmptyState } from '@biznexa/ui';
import { useAuth } from '@/lib/auth';
import { ReportsNav } from '../reports-nav';
import { ExportButton } from '../export-button';

const PRESETS = [
  { label: 'Today', value: 'today' },
  { label: 'Yesterday', value: 'yesterday' },
  { label: 'Last 7 Days', value: 'last 7 days' },
  { label: 'This Month', value: 'this month' },
  { label: 'Last Month', value: 'last month' },
  { label: 'Year to Date', value: 'year to date' },
];

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
}

function formatHours(hours: number | null): string {
  if (hours === null) return '—';
  if (hours < 1) {
    const mins = Math.round(hours * 60);
    return `${mins}m`;
  }
  return `${hours}h`;
}

function getStatusBadgeTone(status: string): 'neutral' | 'info' | 'success' | 'warning' | 'danger' {
  switch (status) {
    case 'RESOLVED':
    case 'CLOSED':
      return 'success';
    case 'IN_PROGRESS':
      return 'info';
    case 'WAITING_FOR_CUSTOMER':
      return 'warning';
    case 'OPEN':
      return 'danger';
    default:
      return 'neutral';
  }
}

function getPriorityBadgeTone(priority: string): 'neutral' | 'info' | 'success' | 'warning' | 'danger' {
  switch (priority) {
    case 'URGENT':
      return 'danger';
    case 'HIGH':
      return 'warning';
    case 'MEDIUM':
      return 'info';
    case 'LOW':
      return 'neutral';
    default:
      return 'neutral';
  }
}

export function SupportReportView() {
  const { user } = useAuth();
  const { call } = useApi();

  const [preset, setPreset] = useState('last 7 days');
  const [data, setData] = useState<ReportSupportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  const canViewReports = Boolean(user?.permissions.includes(PERMS.REPORTS_VIEW));

  useEffect(() => {
    if (!canViewReports) return;
    let cancel = false;

    call((api) =>
      api.GET('/api/admin/reports/support', {
        params: { query: { preset } },
      }),
    )
      .then((res) => {
        if (!cancel) {
          setData(res as ReportSupportResponse);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancel) {
          setError(err instanceof Error ? err.message : 'Failed to load support report');
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
      <div className="space-y-6">
        <ReportsNav />
        <div className="rounded-lg border border-danger/30 bg-danger/5 p-6 text-center">
          <h2 className="text-lg font-bold text-danger">Access Denied</h2>
          <p className="mt-1 text-sm text-muted">
            You need the <code className="font-semibold text-night">reports.view</code> permission to access support analytics.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ReportsNav />

      {/* Header and Controls */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-night">Customer Support Report</h2>
          <p className="mt-0.5 text-xs text-muted">
            Tickets by status, average first staff response time, and average resolution speed.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Date Filter Presets */}
          <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-rule bg-paper p-1">
            {PRESETS.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => setPreset(p.value)}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                  preset === p.value
                    ? 'bg-night text-paper shadow-xs'
                    : 'text-muted hover:bg-paper/80 hover:text-night'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <ExportButton type="support" preset={preset} />
        </div>
      </div>

      {error && (
        <div className="flex items-center justify-between rounded-lg border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
          <span>{error}</span>
          <button
            type="button"
            className="rounded border border-danger/40 px-2 py-1 text-xs font-semibold hover:bg-danger/10"
            onClick={() => {
              setLoading(true);
              setReload((r) => r + 1);
            }}
          >
            Retry
          </button>
        </div>
      )}

      {loading && !data ? (
        <div className="rounded-xl border border-rule bg-paper/50 p-12 text-center text-sm text-muted">
          Loading support analytics...
        </div>
      ) : data ? (
        <div className="space-y-6">
          {/* Summary KPIs */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <div className="rounded-xl border border-rule bg-paper p-5 shadow-xs">
              <span className="text-xs font-medium text-muted">Total Tickets</span>
              <p className="mt-2 text-2xl font-bold text-night num">{data.summary.totalTickets}</p>
              <span className="mt-1 block text-xs text-muted">In selected date range</span>
            </div>

            <div className="rounded-xl border border-rule bg-paper p-5 shadow-xs">
              <span className="text-xs font-medium text-muted">Open Tickets</span>
              <p className="mt-2 text-2xl font-bold text-amber num">{data.summary.openTickets}</p>
              <span className="mt-1 block text-xs text-muted">Open / In Progress / Waiting</span>
            </div>

            <div className="rounded-xl border border-rule bg-paper p-5 shadow-xs">
              <span className="text-xs font-medium text-muted">Resolved Tickets</span>
              <p className="mt-2 text-2xl font-bold text-seal num">{data.summary.resolvedTickets}</p>
              <span className="mt-1 block text-xs text-muted">Resolved & Closed</span>
            </div>

            <div className="rounded-xl border border-rule bg-paper p-5 shadow-xs">
              <span className="text-xs font-medium text-muted">Avg First Response</span>
              <p className="mt-2 text-2xl font-bold text-ink num">
                {formatHours(data.summary.avgFirstResponseHours)}
              </p>
              <span className="mt-1 block text-xs text-muted">From ticket creation</span>
            </div>

            <div className="rounded-xl border border-rule bg-paper p-5 shadow-xs">
              <span className="text-xs font-medium text-muted">Avg Resolution Time</span>
              <p className="mt-2 text-2xl font-bold text-night num">
                {formatHours(data.summary.avgResolutionHours)}
              </p>
              <span className="mt-1 block text-xs text-muted">From creation to resolved</span>
            </div>
          </div>

          {/* Tickets by Status Breakdown */}
          <div className="rounded-xl border border-rule bg-paper p-6 shadow-xs">
            <h3 className="text-base font-bold text-night">Tickets by Status Breakdown</h3>
            <p className="mt-0.5 text-xs text-muted">Distribution of tickets across workflow states.</p>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
              {data.byStatus.map((statusItem) => (
                <div
                  key={statusItem.status}
                  className="rounded-lg border border-rule/60 bg-paper/50 p-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-night">{statusItem.label}</span>
                    <Badge tone={getStatusBadgeTone(statusItem.status)}>
                      {statusItem.count}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Recent Tickets Table */}
          <div className="rounded-xl border border-rule bg-paper p-6 shadow-xs">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-night">Tickets Overview</h3>
                <p className="mt-0.5 text-xs text-muted">
                  First response and resolution performance per ticket.
                </p>
              </div>
            </div>

            {data.recentTickets.length === 0 ? (
              <div className="py-8">
                <EmptyState
                  title="No tickets found"
                  description="No customer support tickets recorded for this time range."
                />
              </div>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full divide-y divide-rule text-left text-xs">
                  <thead>
                    <tr className="bg-paper/60 text-muted">
                      <th className="px-3 py-2.5 font-semibold">Code</th>
                      <th className="px-3 py-2.5 font-semibold">Subject</th>
                      <th className="px-3 py-2.5 font-semibold">Customer</th>
                      <th className="px-3 py-2.5 font-semibold">Priority</th>
                      <th className="px-3 py-2.5 font-semibold">Status</th>
                      <th className="px-3 py-2.5 font-semibold">Created</th>
                      <th className="px-3 py-2.5 font-semibold">First Response</th>
                      <th className="px-3 py-2.5 font-semibold">Resolution</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-rule/50">
                    {data.recentTickets.map((t) => (
                      <tr key={t.id} className="hover:bg-paper/40 transition-colors">
                        <td className="px-3 py-3 font-semibold text-night">{t.code}</td>
                        <td className="px-3 py-3 font-medium text-night max-w-xs truncate" title={t.subject}>
                          {t.subject}
                        </td>
                        <td className="px-3 py-3 text-muted">{t.customerName}</td>
                        <td className="px-3 py-3">
                          <Badge tone={getPriorityBadgeTone(t.priority)}>{t.priority}</Badge>
                        </td>
                        <td className="px-3 py-3">
                          <Badge tone={getStatusBadgeTone(t.status)}>{t.status}</Badge>
                        </td>
                        <td className="px-3 py-3 text-muted">{formatDate(t.createdAt)}</td>
                        <td className="px-3 py-3 num font-medium text-ink">
                          {formatHours(t.firstResponseHours)}
                        </td>
                        <td className="px-3 py-3 num font-medium text-night">
                          {formatHours(t.resolutionHours)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
