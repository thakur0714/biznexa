'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createColumnHelper, type ColumnFiltersState, type FilterFn } from '@tanstack/react-table';
import { formatDate, formatINR, type AdminCouponRow, type CouponServiceOption, type CouponStatus } from '@biznexa/types';
import { Badge, Button, Dialog, EmptyState, Field, Notice, Select, useToast, type Tone } from '@biznexa/ui';
import { useApi } from '@biznexa/api-client/react';
import { DataTable } from '@/components/data-table';
import { NotAllowed } from '@/components/portal-shell';
import { useAuth } from '@/lib/auth';
import { canSee, findNavItem } from '@/lib/nav';
import { CouponEditor } from './coupon-editor';

/** Coupons list (M3.12): usage so far, create/edit in a dialog, switch on or off, delete unused ones. */
export function CouponsView() {
  const { user } = useAuth();
  const item = findNavItem('coupons');
  if (!user || !item) return null;
  if (!canSee(item, user.permissions)) return <NotAllowed />;
  return <Coupons />;
}

const STATUS: Record<CouponStatus, { label: string; tone: Tone }> = {
  ACTIVE: { label: 'Active', tone: 'success' },
  SCHEDULED: { label: 'Scheduled', tone: 'info' },
  EXPIRED: { label: 'Expired', tone: 'neutral' },
  USED_UP: { label: 'Used up', tone: 'warning' },
  INACTIVE: { label: 'Inactive', tone: 'neutral' },
};

export const discountLabel = (c: Pick<AdminCouponRow, 'type' | 'value' | 'maxDiscount'>) => {
  if (c.type !== 'PERCENTAGE') return `${formatINR(c.value)} off`;
  const cap = c.maxDiscount ? ` (up to ${formatINR(c.maxDiscount)})` : '';
  return `${c.value}% off${cap}`;
};

/** The last day the coupon works (IST): `expiresAt` is exclusive. */
const lastDay = (expiresAt: string) => formatDate(new Date(Date.parse(expiresAt) - 1));

const couponSearch: FilterFn<AdminCouponRow> = (row, _col, value: string) => {
  const q = value.trim().toLowerCase();
  return !q || row.original.code.toLowerCase().includes(q) || row.original.services.some((s) => s.name.toLowerCase().includes(q));
};

type Pending = { kind: 'deactivate' | 'delete'; row: AdminCouponRow };

function Coupons() {
  const api = useApi();
  const toast = useToast();
  const [coupons, setCoupons] = useState<AdminCouponRow[] | null>(null);
  const [services, setServices] = useState<CouponServiceOption[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<CouponStatus | ''>('');
  /** undefined = closed, null = new coupon. */
  const [editing, setEditing] = useState<AdminCouponRow | null | undefined>(undefined);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.call((c) => c.GET('/api/admin/coupons')), api.call((c) => c.GET('/api/admin/coupons/services'))]).then(
      ([list, options]) => {
        if (cancelled) return;
        setCoupons(list);
        setServices(options);
        setLoadError(null);
      },
      (err: Error) => !cancelled && setLoadError(err.message),
    );
    return () => {
      cancelled = true;
    };
  }, [api, reload]);

  const replace = (row: AdminCouponRow) => setCoupons((xs) => xs?.map((c) => (c.id === row.id ? row : c)) ?? xs);

  const setActive = useCallback(
    async (row: AdminCouponRow, isActive: boolean) => {
      setBusyId(row.id);
      try {
        replace(await api.call((c) => c.PATCH('/api/admin/coupons/{id}', { params: { path: { id: row.id } }, body: { isActive } })));
        toast(isActive ? `${row.code} can be used again.` : `${row.code} can no longer be used.`, 'success');
      } catch (err) {
        toast((err as Error).message, 'error');
      } finally {
        setBusyId(null);
        setPending(null);
      }
    },
    [api, toast],
  );

  const remove = useCallback(
    async (row: AdminCouponRow) => {
      setBusyId(row.id);
      try {
        await api.call((c) => c.DELETE('/api/admin/coupons/{id}', { params: { path: { id: row.id } } }));
        setCoupons((xs) => xs?.filter((c) => c.id !== row.id) ?? xs);
        toast(`${row.code} deleted.`, 'success');
      } catch (err) {
        toast((err as Error).message, 'error');
      } finally {
        setBusyId(null);
        setPending(null);
      }
    },
    [api, toast],
  );

  const columns = useMemo(() => {
    const col = createColumnHelper<AdminCouponRow>();
    return [
      col.accessor('code', {
        header: 'Code',
        cell: ({ row: { original: c } }) => (
          <div>
            <button type="button" onClick={() => setEditing(c)} className="font-mono font-semibold text-night underline-offset-2 hover:text-ink hover:underline">
              {c.code}
            </button>
            <p className="text-xs text-muted">Created {formatDate(c.createdAt)}</p>
          </div>
        ),
      }),
      col.accessor((c) => discountLabel(c), {
        id: 'discount',
        header: 'Discount',
        enableSorting: false,
        cell: ({ row: { original: c } }) => (
          <div>
            {discountLabel(c)}
            <p className="text-xs text-muted">
              {c.minOrderValue ? `Min. ${formatINR(c.minOrderValue)} · ` : ''}
              {c.services.length ? c.services.map((s) => (s.removed ? `${s.name} (removed)` : s.name)).join(', ') : 'All services'}
            </p>
          </div>
        ),
      }),
      col.accessor((c) => c.expiresAt ?? undefined, {
        id: 'valid',
        header: 'Valid',
        sortUndefined: 'last',
        cell: ({ row: { original: c } }) => (
          <span className="whitespace-nowrap">
            {c.startsAt ? formatDate(c.startsAt) : 'Now'} – {c.expiresAt ? lastDay(c.expiresAt) : 'no end'}
          </span>
        ),
      }),
      col.accessor((c) => c.usage.redemptions, {
        id: 'uses',
        header: 'Uses',
        meta: { className: 'text-right' },
        cell: ({ row: { original: c } }) => (
          <div>
            {c.usage.redemptions}
            {c.usageLimit != null && <span className="text-muted"> / {c.usageLimit}</span>}
            <p className="text-xs text-muted">{c.perUserLimit == null ? 'No limit per customer' : `${c.perUserLimit} per customer`}</p>
          </div>
        ),
      }),
      col.accessor((c) => c.usage.customers, { id: 'customers', header: 'Customers', meta: { className: 'text-right' } }),
      col.accessor((c) => c.usage.discountGiven, {
        id: 'given',
        header: 'Discount given',
        meta: { className: 'text-right' },
        cell: ({ getValue }) => formatINR(getValue()),
      }),
      col.accessor((c) => c.usage.lastUsedAt ?? undefined, {
        id: 'lastUsed',
        header: 'Last used',
        sortUndefined: 'last',
        cell: ({ getValue }) => {
          const v = getValue();
          return v ? formatDate(v) : <span className="text-muted">Never</span>;
        },
      }),
      col.accessor('status', {
        header: 'Status',
        filterFn: 'equalsString',
        cell: ({ getValue }) => <Badge tone={STATUS[getValue()].tone}>{STATUS[getValue()].label}</Badge>,
      }),
      col.display({
        id: 'actions',
        header: () => <span className="sr-only">Actions</span>,
        meta: { className: 'text-right' },
        cell: ({ row: { original: c } }) => (
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEditing(c)} aria-label={`Edit ${c.code}`}>
              Edit
            </Button>
            {c.isActive ? (
              <Button variant="outline" size="sm" disabled={busyId === c.id} onClick={() => setPending({ kind: 'deactivate', row: c })} aria-label={`Deactivate ${c.code}`}>
                Deactivate
              </Button>
            ) : (
              <Button variant="ink" size="sm" disabled={busyId === c.id} onClick={() => setActive(c, true)} aria-label={`Activate ${c.code}`}>
                {busyId === c.id ? 'Activating…' : 'Activate'}
              </Button>
            )}
            {!c.inUse && (
              <Button variant="ghost" size="sm" disabled={busyId === c.id} onClick={() => setPending({ kind: 'delete', row: c })} aria-label={`Delete ${c.code}`}>
                Delete
              </Button>
            )}
          </div>
        ),
      }),
    ];
  }, [busyId, setActive]);

  const totals = useMemo(() => {
    const xs = coupons ?? [];
    return {
      live: xs.filter((c) => c.status === 'ACTIVE').length,
      redemptions: xs.reduce((n, c) => n + c.usage.redemptions, 0),
      given: xs.reduce((n, c) => n + c.usage.discountGiven, 0),
    };
  }, [coupons]);

  const filters: ColumnFiltersState = status ? [{ id: 'status', value: status }] : [];
  const filtered = !!(query || status);
  const clearFilters = () => {
    setQuery('');
    setStatus('');
  };
  let listContent: React.ReactNode;
  if (loadError) {
    listContent = <div className="space-y-3"><Notice tone="error">{loadError}</Notice><Button variant="outline" size="sm" onClick={() => setReload((n) => n + 1)}>Try again</Button></div>;
  } else if (!coupons) {
    listContent = <output className="block text-muted">Loading coupons…</output>;
  } else if (coupons.length === 0) {
    listContent = <EmptyState title="No coupons yet" description="Create a code customers can enter at checkout for a discount on the professional fee." action={<Button variant="ink" size="sm" onClick={() => setEditing(null)}>New coupon</Button>} />;
  } else {
    listContent = <DataTable caption="Coupons" data={coupons} columns={columns} getRowId={(c) => c.id} globalFilter={query} globalFilterFn={couponSearch} columnFilters={filters} minWidth={1080} empty={<EmptyState title="Nothing matches these filters" description="Try a different search, or clear the filters." action={filtered && <Button variant="outline" size="sm" onClick={clearFilters}>Clear filters</Button>} />} />;
  }
  let pendingTitle = '';
  if (pending) {
    const action = pending.kind === 'delete' ? 'Delete' : 'Deactivate';
    pendingTitle = `${action} ${pending.row.code}?`;
  }
  let pendingButtonLabel = 'Deactivate';
  if (pending?.kind === 'delete') pendingButtonLabel = busyId ? 'Deleting…' : 'Delete';
  else if (busyId) pendingButtonLabel = 'Deactivating…';
  const confirmPending = () => {
    if (!pending) return;
    if (pending.kind === 'delete') void remove(pending.row);
    else void setActive(pending.row, false);
  };
  return (
    <div className="max-w-[1200px]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-[-0.02em]">Coupons</h1>
          <p className="mt-1 text-muted">Create discount codes, see how much they are used, and switch them off.</p>
        </div>
        <Button variant="ink" onClick={() => setEditing(null)} disabled={!coupons}>
          New coupon
        </Button>
      </div>

      {coupons && coupons.length > 0 && (
        <dl className="mt-6 grid gap-3 sm:grid-cols-3">
          {[
            ['Usable now', String(totals.live)],
            ['Times used', String(totals.redemptions)],
            ['Discount given', formatINR(totals.given)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-md border border-rule bg-white px-4 py-3">
              <dt className="text-sm text-muted">{label}</dt>
              <dd className="mt-1 text-xl font-semibold text-night">{value}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_200px]">
        <Field id="coupon-search" label="Search" type="search" placeholder="Code or service" value={query} onChange={(e) => setQuery(e.target.value)} />
        <Select id="coupon-status" label="Status" value={status} onChange={(e) => setStatus(e.target.value as CouponStatus | '')}>
          <option value="">Any status</option>
          {(Object.keys(STATUS) as CouponStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS[s].label}
            </option>
          ))}
        </Select>
      </div>

      <div className="mt-4">
        {listContent}
      </div>

      {editing !== undefined && (
        <CouponEditor
          coupon={editing}
          services={services}
          onClose={() => setEditing(undefined)}
          onSaved={(row, created) => {
            setCoupons((xs) => (created ? [row, ...(xs ?? [])] : (xs?.map((c) => (c.id === row.id ? row : c)) ?? xs)));
            setEditing(undefined);
            toast(created ? `${row.code} created.` : `${row.code} saved.`, 'success');
          }}
        />
      )}

      <Dialog
        open={!!pending}
        onClose={() => busyId === null && setPending(null)}
        title={pendingTitle}
        description={
          pending?.kind === 'delete'
            ? 'No order has used it, so it will be removed for good.'
            : 'Customers can no longer use it. Orders that already used it are not changed. You can activate it again at any time.'
        }
        footer={
          <>
            <Button variant="outline" onClick={() => setPending(null)} disabled={busyId !== null}>
              Cancel
            </Button>
            <Button variant="ink" disabled={busyId !== null} onClick={confirmPending}>
              {pendingButtonLabel}
            </Button>
          </>
        }
      />
    </div>
  );
}
