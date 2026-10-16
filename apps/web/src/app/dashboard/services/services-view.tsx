'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  formatDate,
  type ApplicationStatus,
  type CustomerApplicationList,
  type CustomerApplicationNextAction,
  type CustomerApplicationRow,
  type CustomerApplicationTab,
} from '@biznexa/types';
import { ClientApiError } from '@biznexa/api-client/browser';
import { useApi } from '@biznexa/api-client/react';
import { Badge, Button, EmptyState, LinkButton, Notice, type Tone } from '@biznexa/ui';
import { Icon } from '@/components/icons';

const TABS: readonly { key: CustomerApplicationTab; label: string }[] = [
  { key: 'active', label: 'Active' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' },
];

export function applicationStatusTone(status: ApplicationStatus): Tone {
  switch (status) {
    case 'COMPLETED':
    case 'DELIVERED':
    case 'DOCUMENTS_APPROVED':
      return 'success';
    case 'DOCUMENTS_PENDING':
    case 'PAYMENT_PENDING':
    case 'ON_HOLD':
      return 'warning';
    case 'CANCELLED':
      return 'danger';
    default:
      return 'info';
  }
}

function actionConfig(row: CustomerApplicationRow): {
  label: string;
  href: string;
  variant: 'primary' | 'ink' | 'outline';
  icon: string;
} {
  const actions: Record<
    CustomerApplicationNextAction,
    { label: string; href: string; variant: 'primary' | 'ink' | 'outline'; icon: string }
  > = {
    upload_documents: {
      label: 'Upload documents',
      href: `/dashboard/applications/${row.id}?tab=documents`,
      variant: 'primary',
      icon: 'upload',
    },
    pay_balance: {
      label: 'Pay balance',
      href: `/apply/${row.serviceSlug}/${row.id}/payment`,
      variant: 'primary',
      icon: 'rupee',
    },
    download: {
      label: 'Download',
      href: `/dashboard/applications/${row.id}?tab=deliverables`,
      variant: 'ink',
      icon: 'download',
    },
    view: {
      label: 'View application',
      href: `/dashboard/applications/${row.id}`,
      variant: 'outline',
      icon: 'chevronRight',
    },
  };
  return actions[row.nextAction];
}

export function MyServicesView() {
  const api = useApi();
  const [tab, setTab] = useState<CustomerApplicationTab>('active');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<CustomerApplicationList | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    api
      .call<CustomerApplicationList>((c) =>
        c.GET('/api/applications', {
          params: { query: { tab, page, limit: 25 } },
        }),
      )
      .then((res) => {
        if (!cancelled) {
          setData(res);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof ClientApiError ? err.message : 'Failed to load your services.');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [api, tab, page]);

  const loading = data === null && !error;
  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const limit = data?.limit ?? 25;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-[-0.025em] text-night sm:text-3xl">My Services</h1>
          <p className="mt-1 text-sm text-muted">
            Track your applications, upload pending documents, pay balances, and download deliverables.
          </p>
        </div>
        <LinkButton href="/services" variant="primary" size="sm">
          Buy a new service
        </LinkButton>
      </div>

      {/* Tabs */}
      <div
        role="tablist"
        aria-label="Application status tabs"
        className="flex gap-1 overflow-x-auto border-b border-rule"
      >
        {TABS.map((t) => {
          const selected = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => {
                if (tab !== t.key) {
                  setData(null);
                  setError(null);
                  setTab(t.key);
                  setPage(1);
                }
              }}
              className={`shrink-0 border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors ${
                selected
                  ? 'border-ink text-ink'
                  : 'border-transparent text-muted hover:border-rule hover:text-night'
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {error && <Notice tone="error">{error}</Notice>}

      {loading ? (
        <div className="rounded-lg border border-rule bg-white p-10 text-center text-sm text-muted" role="status">
          Loading your services…
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          className="rounded-lg border border-rule bg-white p-10"
          icon={<Icon name="file" size={36} className="text-ink/40" />}
          title={
            tab === 'active'
              ? 'No active services'
              : tab === 'completed'
                ? 'No completed services yet'
                : 'No cancelled services'
          }
          description={
            tab === 'active'
              ? 'When you start and submit a service application, it will appear here with live progress.'
              : tab === 'completed'
                ? 'Completed applications and their final deliverables will appear here.'
                : 'You do not have any cancelled applications.'
          }
          action={
            tab === 'active' ? (
              <LinkButton href="/services" variant="primary">
                Browse services
              </LinkButton>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-4">
          {items.map((row) => {
            const action = actionConfig(row);
            return (
              <article
                key={row.id}
                className="rounded-lg border border-rule bg-white p-4 shadow-xs transition hover:border-ink/30 sm:p-5"
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="num font-mono text-xs font-bold text-muted">{row.code}</span>
                      <Badge tone={applicationStatusTone(row.status)}>{row.statusLabel}</Badge>
                    </div>
                    <h2 className="text-lg font-bold text-night">
                      <Link
                        href={`/dashboard/applications/${row.id}`}
                        className="hover:text-ink hover:underline"
                      >
                        {row.serviceName}
                      </Link>
                    </h2>
                    <p className="text-sm text-muted">
                      {row.packageName} package · Updated {formatDate(row.updatedAt)}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <LinkButton href={action.href} variant={action.variant} size="sm">
                      <Icon name={action.icon} size={16} />
                      <span>{action.label}</span>
                    </LinkButton>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {!loading && totalPages > 1 && (
        <nav
          aria-label="My Services pagination"
          className="flex items-center justify-between gap-4 border-t border-rule pt-4"
        >
          <p className="text-xs text-muted">
            Page <span className="font-semibold text-ink">{page}</span> of{' '}
            <span className="font-semibold text-ink">{totalPages}</span> ({total} total)
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next
            </Button>
          </div>
        </nav>
      )}
    </div>
  );
}
