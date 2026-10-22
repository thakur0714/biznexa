/* eslint-disable react-hooks/set-state-in-effect */
/* eslint-disable react-hooks/exhaustive-deps */
'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { formatDate, type LeadListResponse, type LeadQuery } from '@biznexa/types';
import { Button, EmptyState, Field, Notice, Select } from '@biznexa/ui';
import { useApi } from '@biznexa/api-client/react';
import { DataTable } from '@/components/data-table';
import { NotAllowed } from '@/components/portal-shell';
import { useAuth } from '@/lib/auth';
import { canSee, findNavItem } from '@/lib/nav';

type LeadRow = LeadListResponse['items'][number];

const helper = createColumnHelper<LeadRow>();
const columns = [
  helper.accessor('name', {
    header: 'Name',
    cell: (info) => <span className="font-medium text-night">{info.getValue()}</span>,
  }),
  helper.accessor('mobile', {
    header: 'Mobile',
    cell: (info) => (
      <a href={`tel:${info.getValue()}`} className="text-ink hover:underline num">
        {info.getValue()}
      </a>
    ),
  }),
  helper.accessor('email', {
    header: 'Email',
    cell: (info) => <span className="text-muted">{info.getValue() || '—'}</span>,
  }),
  helper.accessor('city', {
    header: 'City',
    cell: (info) => <span className="text-muted">{info.getValue() || '—'}</span>,
  }),
  helper.accessor('serviceName', {
    header: 'Service',
    cell: (info) => <span className="text-muted">{info.getValue() || '—'}</span>,
  }),
  helper.accessor('source', {
    header: 'Source',
    cell: (info) => <span className="text-muted capitalize">{info.getValue().replace('_', ' ')}</span>,
  }),
  helper.accessor('message', {
    header: 'Message',
    cell: (info) => <span className="text-muted line-clamp-2 max-w-[200px]" title={info.getValue() ?? ''}>{info.getValue() ?? '—'}</span>,
  }),
  helper.accessor('createdAt', {
    header: 'Date',
    cell: (info) => <span className="text-muted whitespace-nowrap">{formatDate(info.getValue())}</span>,
  }),
];

export function LeadsView() {
  const api = useApi();
  const { user } = useAuth();

  const [data, setData] = useState<LeadListResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  const [query, setQuery] = useState('');
  const [source, setSource] = useState<LeadQuery['source'] | 'ALL'>('ALL');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const [page, setPage] = useState(1);
  const limit = 50;

  const canView = useMemo(() => {
    if (!user?.permissions) return false;
    const item = findNavItem('leads');
    return item ? canSee(item, user.permissions) : false;
  }, [user]);

  useEffect(() => {
    if (!canView) return;
    let cancel = false;

    async function load() {
      try {
        setLoadError(null);
        const queryParams: LeadQuery = { page, limit };
        if (query) queryParams.q = query;
        if (source !== 'ALL') queryParams.source = source as LeadQuery['source'];

        if (from) {
          // A bare YYYY-MM-DD parses as UTC midnight; add a time so it means local midnight.
          const fromDate = new Date(`${from}T00:00:00`);
          if (!Number.isNaN(fromDate.getTime())) queryParams.from = fromDate.toISOString();
        }
        if (to) {
          const toDate = new Date(`${to}T00:00:00`);
          toDate.setHours(23, 59, 59, 999);
          if (!Number.isNaN(toDate.getTime())) queryParams.to = toDate.toISOString();
        }

        const res = await api.call<LeadListResponse>((c) => c.GET('/api/admin/leads', { params: { query: queryParams } }));
        if (cancel) return;
        setData(res);
      } catch (err: unknown) {
        if (!cancel) setLoadError((err as Error).message || 'Failed to load leads');
      }
    }
    void load();
    return () => { cancel = true; };
  }, [api, canView, query, source, from, to, page, reload]);

      const updateUrl = () => {
     // Optional: push to URL to keep filters in URL
     const url = new URL(window.location.href);
     if (query) url.searchParams.set('q', query); else url.searchParams.delete('q');
     if (source !== 'ALL' && source) url.searchParams.set('source', source); else url.searchParams.delete('source');
     if (from) url.searchParams.set('from', from); else url.searchParams.delete('from');
     if (to) url.searchParams.set('to', to); else url.searchParams.delete('to');
     if (page > 1) url.searchParams.set('page', page.toString()); else url.searchParams.delete('page');
     window.history.replaceState({}, '', url.toString());
  }

  useEffect(() => {
    updateUrl();
      }, [query, source, from, to, page]);

    useEffect(() => {
    const params = new URLSearchParams(window.location.search);
        if (params.has('q')) setQuery(params.get('q') || '');
    if (params.has('source')) setSource((params.get('source') as LeadQuery['source']) ?? 'ALL');
    if (params.has('from')) setFrom(params.get('from') || '');
    if (params.has('to')) setTo(params.get('to') || '');
    if (params.has('page')) setPage(Number.parseInt(params.get('page') || '1', 10));
  }, []);

  if (user && !canView) {
    return <NotAllowed />;
  }

  let content: ReactNode;
  if (loadError) {
    content = (
      <div className="space-y-3">
        <Notice tone="error">{loadError}</Notice>
        <Button variant="outline" size="sm" onClick={() => setReload((n) => n + 1)}>
          Try again
        </Button>
      </div>
    );
  } else if (!data) {
    content = (
      <output className="block text-muted">
        Loading enquiries…
      </output>
    );
  } else if (data.items.length === 0) {
    content = (
      <EmptyState
        title="No enquiries found"
        description="No enquiries match the selected filters or search query."
        action={
          (query || source !== 'ALL' || from || to) && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setQuery('');
                setSource('ALL');
                setFrom('');
                setTo('');
                setPage(1);
              }}
            >
              Clear filters
            </Button>
          )
        }
      />
    );
  } else {
    content = (
      <div>
        <DataTable
          caption="Enquiries"
          data={data.items}
          columns={columns}
          getRowId={(p) => p.id}
          minWidth={360} // responsive table logic typically lives in DataTable; we'll provide an arbitrary min width
          empty={
            <EmptyState
              title="No enquiries match"
              description="Try adjusting your filters or search query."
              action={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setQuery('');
                    setSource('ALL');
                    setFrom('');
                    setTo('');
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
              Showing {(page - 1) * limit + 1}–{Math.min(page * limit, data.total)} of {data.total} enquiries
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
    );
  }

  return (
    <div className="max-w-[1200px]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-[-0.02em]">Enquiries</h1>
          <p className="mt-1 text-muted">View contact requests and service enquiries.</p>
        </div>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 border-b border-rule pb-4">
        <Field
          id="lead-search"
          label="Search"
          type="search"
          placeholder="Name or mobile"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
        />
        <Select
          id="lead-source"
          label="Source"
          value={source}
          onChange={(e) => {
            setSource(e.target.value as unknown as LeadQuery['source']);
            setPage(1);
          }}
        >
          <option value="ALL">All sources</option>
          <option value="service_page">Service Page</option>
          <option value="contact">Contact</option>
          <option value="home">Home</option>
          <option value="consultants">Consultants</option>
        </Select>
        <Field
          id="lead-from"
          label="From date"
          type="date"
          value={from}
          onChange={(e) => {
            setFrom(e.target.value);
            setPage(1);
          }}
        />
        <Field
          id="lead-to"
          label="To date"
          type="date"
          value={to}
          onChange={(e) => {
            setTo(e.target.value);
            setPage(1);
          }}
        />
      </div>

      <div className="mt-4">
        {content}
      </div>
    </div>
  );
}
