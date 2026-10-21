'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { formatDate, type AdminCertificateRow, type CertificateStatus } from '@biznexa/types';
import { Badge, Button, EmptyState, Field, Notice, Select, type Tone } from '@biznexa/ui';
import { useApi } from '@biznexa/api-client/react';
import { DataTable } from '@/components/data-table';
import { NotAllowed } from '@/components/portal-shell';
import { useAuth } from '@/lib/auth';
import { canSee, findNavItem } from '@/lib/nav';

export function CertificatesView() {
  const { user } = useAuth();
  const item = findNavItem('certificates');
  if (!user || !item) return null;
  if (!canSee(item, user.permissions)) return <NotAllowed />;
  return <CertificatesList />;
}

const STATUS: Record<CertificateStatus, { label: string; tone: Tone }> = {
  ACTIVE: { label: 'Active', tone: 'success' },
  SUSPENDED: { label: 'Suspended', tone: 'warning' },
  WITHDRAWN: { label: 'Withdrawn', tone: 'danger' },
  EXPIRED: { label: 'Expired', tone: 'neutral' },
};

function CertificatesList() {
  const api = useApi();
  const [data, setData] = useState<{ items: AdminCertificateRow[]; total: number } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<CertificateStatus | ''>('');
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const clearFilters = () => {
    setQuery('');
    setStatus('');
    setPage(1);
  };

  useEffect(() => {
    let cancelled = false;
    api
      .call((c) =>
        c.GET('/api/admin/certificates', {
          params: { query: { q: query || undefined, status: status || undefined, page, limit: 25 } },
        }),
      )
      .then(
        (res) => {
          if (!cancelled) {
            setData(res);
            setLoadError(null);
          }
        },
        (err: Error) => !cancelled && setLoadError(err.message),
      );
    return () => {
      cancelled = true;
    };
  }, [api, query, status, page, reload]);

  const columns = useMemo(() => {
    const col = createColumnHelper<AdminCertificateRow>();
    return [
      col.accessor('certificateNumber', {
        header: 'Certificate No.',
        cell: ({ row: { original: c } }) => (
          <div>
            <Link
              href={`/certificates/${c.id}`}
              className="font-mono font-semibold text-night underline-offset-2 hover:text-ink hover:underline"
            >
              {c.certificateNumber}
            </Link>
            <p className="font-mono text-xs text-muted">ID: {c.verificationId}</p>
          </div>
        ),
      }),
      col.accessor('organizationName', {
        header: 'Organisation',
        cell: ({ row: { original: c } }) => (
          <div>
            <p className="font-semibold text-night">{c.organizationName}</p>
            <p className="text-xs text-muted">{c.type}</p>
          </div>
        ),
      }),
      col.accessor((c) => c.certificationBody.name, {
        id: 'certificationBody',
        header: 'Certification Body',
      }),
      col.accessor('validUntil', {
        header: 'Validity',
        cell: ({ row: { original: c } }) => (
          <span className="whitespace-nowrap text-sm">
            {formatDate(c.validFrom)} – {formatDate(c.validUntil)}
          </span>
        ),
      }),
      col.accessor((c) => c._count.lookups, {
        id: 'lookups',
        header: 'Lookups',
        meta: { className: 'text-right' },
      }),
      col.accessor('status', {
        header: 'Status',
        cell: ({ getValue }) => <Badge tone={STATUS[getValue()].tone}>{STATUS[getValue()].label}</Badge>,
      }),
      col.display({
        id: 'actions',
        header: () => <span className="sr-only">Actions</span>,
        meta: { className: 'text-right' },
        cell: ({ row: { original: c } }) => (
          <Link
            href={`/certificates/${c.id}`}
            className="inline-flex items-center rounded-md border border-rule bg-white px-3 py-1.5 text-xs font-medium text-night hover:bg-paper"
          >
            View
          </Link>
        ),
      }),
    ];
  }, []);

  let certificatesContent: React.ReactNode;
  if (loadError) {
    certificatesContent = (
      <div className="space-y-3">
        <Notice tone="error">{loadError}</Notice>
        <Button variant="outline" size="sm" onClick={() => setReload((n) => n + 1)}>Try again</Button>
      </div>
    );
  } else if (!data) {
    certificatesContent = <p className="text-muted" role="status">Loading certificates…</p>;
  } else if (data.items.length === 0) {
    const description = query || status ? 'Try adjusting your search or filters.' : 'Issue your first certificate to get started.';
    const action = query || status
      ? <Button variant="outline" size="sm" onClick={clearFilters}>Clear filters</Button>
      : <Link href="/certificates/new" className="inline-flex items-center rounded-md bg-ink px-3 py-2 text-sm font-medium text-white hover:bg-ink/90">Issue certificate</Link>;
    certificatesContent = <EmptyState title="No certificates found" description={description} action={action} />;
  } else {
    certificatesContent = (
      <div>
        <DataTable
          caption="Certificates"
          data={data.items}
          columns={columns}
          getRowId={(c) => c.id}
          minWidth={900}
          empty={
            <EmptyState
              title="Nothing matches this search"
              description="Try a different query or clear search."
              action={<Button variant="outline" size="sm" onClick={clearFilters}>Clear filters</Button>}
            />
          }
        />
        {data.total > 25 && (
          <div className="mt-4 flex items-center justify-between border-t border-rule pt-4 text-sm">
            <p className="text-muted">Showing {(page - 1) * 25 + 1}–{Math.min(page * 25, data.total)} of {data.total} certificates</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</Button>
              <Button variant="outline" size="sm" disabled={page * 25 >= data.total} onClick={() => setPage((p) => p + 1)}>Next</Button>
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
          <h1 className="text-2xl font-bold tracking-[-0.02em]">Certificates</h1>
          <p className="mt-1 text-muted">Manage issued certificates, track verification lookups, and certification bodies.</p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/certificates/bodies"
            className="inline-flex items-center rounded-md border border-rule bg-white px-3 py-2 text-sm font-medium text-night hover:bg-paper"
          >
            Certification bodies
          </Link>
          <Link
            href="/certificates/import"
            className="inline-flex items-center rounded-md border border-rule bg-white px-3 py-2 text-sm font-medium text-night hover:bg-paper"
          >
            Bulk import
          </Link>
          <Link
            href="/certificates/new"
            className="inline-flex items-center rounded-md bg-ink px-3 py-2 text-sm font-medium text-white hover:bg-ink/90"
          >
            Issue certificate
          </Link>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_200px]">
        <Field
          id="cert-search"
          label="Search"
          type="search"
          placeholder="Number, organisation or ID"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
        />
        <Select
          id="cert-status"
          label="Status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as CertificateStatus | '');
            setPage(1);
          }}
        >
          <option value="">Any status</option>
          {(Object.keys(STATUS) as CertificateStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS[s].label}
            </option>
          ))}
        </Select>
      </div>

      <div className="mt-4">
        {certificatesContent}
      </div>
    </div>
  );
}
