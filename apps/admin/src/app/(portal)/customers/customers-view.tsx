'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { formatDate, type AdminCustomerRow, type AdminCustomerListQuery } from '@biznexa/types';
import { Badge, Button, EmptyState, Field, Notice, type Tone } from '@biznexa/ui';
import { useApi } from '@biznexa/api-client/react';
import { DataTable } from '@/components/data-table';
import { NotAllowed } from '@/components/portal-shell';
import { useAuth } from '@/lib/auth';
import { canSee, findNavItem } from '@/lib/nav';
import Link from 'next/link';

const USER_STATUS_BADGES: Record<string, { label: string; tone: Tone }> = {
  ACTIVE: { label: 'Active', tone: 'success' },
  BLOCKED: { label: 'Blocked', tone: 'danger' },
  DEACTIVATED: { label: 'Deactivated', tone: 'neutral' },
  PENDING_DELETION: { label: 'Pending Deletion', tone: 'warning' },
};

export function CustomersView() {
  const api = useApi();
  const { user } = useAuth();

  const [data, setData] = useState<{ items: AdminCustomerRow[]; total: number; page: number; limit: number } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  const [query, setQuery] = useState('');
  const [statusGroup, setStatusGroup] = useState<AdminCustomerListQuery['status'] | 'ALL'>('ALL');
  const [page, setPage] = useState(1);
  const limit = 25;

  const canView = useMemo(() => {
    if (!user?.permissions) return false;
    const item = findNavItem('customers');
    return item ? canSee(item, user.permissions) : false;
  }, [user]);

  useEffect(() => {
    if (!canView) return;
    let cancel = false;

    async function load() {
      try {
        setLoadError(null);
        const queryParams: AdminCustomerListQuery = { page, limit };
        if (query) queryParams.q = query;
        if (statusGroup !== 'ALL') queryParams.status = statusGroup as AdminCustomerListQuery['status'];

        const res = await api.call<{ items: AdminCustomerRow[]; total: number; page: number; limit: number }>((c) => c.GET('/api/admin/customers', { query: queryParams }));
        if (cancel) return;
        setData(res);
      } catch (err: unknown) {
        if (!cancel) setLoadError((err as Error).message || 'Failed to load customers');
      }
    }
    load();
    return () => { cancel = true; };
  }, [api, canView, query, statusGroup, page, reload]);

  const helper = createColumnHelper<AdminCustomerRow>();
  const columns = useMemo(
    () => [
      helper.accessor('name', {
        header: 'Name',
        cell: (info) => (
          <Link href={`/customers/${info.row.original.id}`} className="font-medium text-ink hover:underline">
            {info.getValue()}
          </Link>
        ),
      }),
      helper.accessor('email', {
        header: 'Email',
        cell: (info) => <span className="text-muted">{info.getValue() || '—'}</span>,
      }),
      helper.accessor('mobile', {
        header: 'Mobile',
        cell: (info) => <span className="text-muted">{info.getValue() || '—'}</span>,
      }),
      helper.accessor('status', {
        header: 'Status',
        cell: (info) => {
          const s = info.getValue();
          const badge = USER_STATUS_BADGES[s];
          return badge ? <Badge tone={badge.tone}>{badge.label}</Badge> : <Badge>{s}</Badge>;
        },
      }),
      helper.accessor('applicationCount', {
        header: 'Applications',
        cell: (info) => info.getValue(),
      }),
      helper.accessor('createdAt', {
        header: 'Joined',
        cell: (info) => <span className="text-muted whitespace-nowrap">{formatDate(info.getValue())}</span>,
      }),
    ],
    [helper]
  );

  const tabs: { key: AdminCustomerListQuery['status'] | 'ALL'; label: string }[] = [
    { key: 'ALL', label: 'All' },
    { key: 'ACTIVE', label: 'Active' },
    { key: 'BLOCKED', label: 'Blocked' },
    { key: 'DEACTIVATED', label: 'Deactivated' },
  ];

  if (user && !canView) {
    return <NotAllowed />;
  }

  return (
    <div className="max-w-[1200px]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-[-0.02em]">Customers</h1>
          <p className="mt-1 text-muted">View and manage customer profiles, applications, and status.</p>
        </div>
      </div>

      <div className="mt-6 flex border-b border-rule" role="tablist" aria-label="Customer status tabs">
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
          id="customer-search"
          label="Search"
          type="search"
          placeholder="Name, email, mobile or app code"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
        />
      </div>

      <div className="mt-4">
        {loadError ? (
          <div className="space-y-3">
            <Notice tone="error">{loadError}</Notice>
            <Button variant="outline" size="sm" onClick={() => setReload((n) => n + 1)}>
              Try again
            </Button>
          </div>
        ) : !data ? (
          <p className="text-muted" role="status">
            Loading customers…
          </p>
        ) : data.items.length === 0 ? (
          <EmptyState
            title="No customers found"
            description="No customers match the selected filters or search query."
            action={
              (query || statusGroup !== 'ALL') && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setQuery('');
                    setStatusGroup('ALL');
                    setPage(1);
                  }}
                >
                  Clear filters
                </Button>
              )
            }
          />
        ) : (
          <div>
            <DataTable
              caption="Customers"
              data={data.items}
              columns={columns}
              getRowId={(p) => p.id}
              minWidth={800}
              empty={
                <EmptyState
                  title="No customers match"
                  description="Try adjusting your filters or search query."
                  action={
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setQuery('');
                        setStatusGroup('ALL');
                        setPage(1);
                      }}
                    >
                      Clear filters
                    </Button>
                  }
                />
              }
            />
            {data.total > limit && (
              <div className="mt-4 flex items-center justify-between border-t border-rule pt-4 text-sm">
                <p className="text-muted">
                  Showing {(page - 1) * limit + 1}–{Math.min(page * limit, data.total)} of {data.total} customers
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                    Previous
                  </Button>
                  <Button variant="outline" size="sm" disabled={page * limit >= data.total} onClick={() => setPage((p) => p + 1)}>
                    Next
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
