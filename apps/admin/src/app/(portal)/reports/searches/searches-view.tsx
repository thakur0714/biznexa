'use client';

import { useEffect, useState } from 'react';
import { Button, EmptyState, Notice } from '@biznexa/ui';
import { useApi } from '@biznexa/api-client/react';
import {
  type ReportPreset,
  type ReportSearchesResponse,
  formatDate,
  formatDateTime,
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

export function SearchesReportView() {
  const { user } = useAuth();
  const { call } = useApi();

  const [preset, setPreset] = useState<ReportPreset>('last 7 days');
  const [data, setData] = useState<ReportSearchesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  const canViewReports = Boolean(user?.permissions.includes(PERMS.REPORTS_VIEW));

  useEffect(() => {
    if (!canViewReports) return;
    let cancel = false;

    call((api) =>
      api.GET('/api/admin/reports/searches', {
        params: { query: { preset } },
      }),
    )
      .then((res) => {
        if (!cancel) {
          setData(res as ReportSearchesResponse);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancel) {
          setError(err instanceof Error ? err.message : 'Failed to load searches report');
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
          Access Denied: You need the reports.view permission to view search reports.
        </Notice>
      </div>
    );
  }

  return (
    <div className="max-w-[1020px] space-y-8">
      <ReportsNav />

      {/* Controls & Filter Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-night">Unanswered Searches</h2>
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
        <div className="h-64 animate-pulse rounded-xl border border-rule bg-paper" />
      )}

      {data &&
        (data.searches.length === 0 ? (
          <div className="rounded-xl border border-rule bg-white p-8">
            <EmptyState
              title="No unanswered searches in this period"
              description="Every search in the selected date range found at least one service, article or category."
            />
          </div>
        ) : (
          <div className="rounded-xl border border-rule bg-white shadow-xs">
            <div className="border-b border-rule px-5 py-4">
              <h3 className="text-base font-bold text-night">Searches That Found Nothing</h3>
              <p className="mt-0.5 text-xs text-muted">
                Grouped ignoring case, most searched first (top 100).
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-rule bg-paper/60 text-xs font-semibold text-muted">
                    <th className="px-5 py-3">#</th>
                    <th className="px-5 py-3">Search</th>
                    <th className="px-5 py-3 text-right">Times Searched</th>
                    <th className="px-5 py-3 text-right">Last Searched</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rule">
                  {data.searches.map((s, idx) => (
                    <tr key={s.query.toLowerCase()} className="hover:bg-paper/40 transition-colors">
                      <td className="px-5 py-3 font-mono text-xs text-muted">{idx + 1}</td>
                      <td className="px-5 py-3 font-medium text-night">{s.query}</td>
                      <td className="px-5 py-3 text-right font-medium text-night">{s.count}</td>
                      <td className="px-5 py-3 text-right text-muted">{formatDateTime(s.lastSearchedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
    </div>
  );
}
