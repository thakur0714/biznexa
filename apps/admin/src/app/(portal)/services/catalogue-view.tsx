'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createColumnHelper, type ColumnFiltersState, type FilterFn } from '@tanstack/react-table';
import { formatINR, type AdminCategoryRow, type AdminServiceRow } from '@biznexa/types';
import Link from 'next/link';
import { Badge, Button, Dialog, EmptyState, Field, LinkButton, Notice, Select, useToast } from '@biznexa/ui';
import { DataTable } from '@/components/data-table';
import { NotAllowed } from '@/components/portal-shell';
import { useApi } from '@biznexa/api-client/react';
import { useAuth } from '@/lib/auth';
import { canSee, findNavItem } from '@/lib/nav';

type Tab = 'services' | 'categories';
type StatusFilter = '' | 'active' | 'inactive';
/** What the confirm dialog is about to deactivate. */
type Pending = { kind: 'service'; row: AdminServiceRow } | { kind: 'category'; row: AdminCategoryRow };

/** Catalogue list (M2.5.8): find services and categories and switch them on or off on the website. */
export function CatalogueView() {
  const { user } = useAuth();
  const item = findNavItem('services');
  if (!user || !item) return null;
  if (!canSee(item, user.permissions)) return <NotAllowed />;
  return <Catalogue />;
}

const statusOf = (active: boolean) => (active ? 'active' : 'inactive');
const StatusBadge = ({ active }: Readonly<{ active: boolean }>) => (active ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>);

/** Name, slug, category and subcategory, case-insensitive. */
const serviceSearch: FilterFn<AdminServiceRow> = (row, _col, value: string) => {
  const q = value.trim().toLowerCase();
  if (!q) return true;
  const s = row.original;
  return [s.name, s.slug, s.category.name, s.subcategory ?? ''].some((v) => v.toLowerCase().includes(q));
};
const categorySearch: FilterFn<AdminCategoryRow> = (row, _col, value: string) => {
  const q = value.trim().toLowerCase();
  return !q || row.original.name.toLowerCase().includes(q) || row.original.slug.includes(q);
};

function Catalogue() {
  const api = useApi();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('services');
  const [services, setServices] = useState<AdminServiceRow[] | null>(null);
  const [categories, setCategories] = useState<AdminCategoryRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [status, setStatus] = useState<StatusFilter>('');
  const [pending, setPending] = useState<Pending | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.call((c) => c.GET('/api/admin/catalogue/services', { params: { query: { includeInactive: 'true' } } })),
      api.call((c) => c.GET('/api/admin/catalogue/categories')),
    ]).then(
      ([s, c]) => {
        if (cancelled) return;
        setServices(s);
        setCategories(c);
        setLoadError(null);
      },
      (err: Error) => !cancelled && setLoadError(err.message),
    );
    return () => {
      cancelled = true;
    };
  }, [api, reload]);

  const setServiceActive = useCallback(
    async (row: AdminServiceRow, isActive: boolean) => {
      setBusyId(row.id);
      try {
        await api.call((c) => c.PATCH('/api/admin/catalogue/services/{id}', { params: { path: { id: row.id } }, body: { isActive } }));
        setServices((xs) => xs?.map((s) => (s.id === row.id ? { ...s, isActive } : s)) ?? xs);
        setCategories((xs) => xs?.map((c) => (c.id === row.category.id ? { ...c, activeServices: c.activeServices + (isActive ? 1 : -1) } : c)) ?? xs);
        toast(isActive ? `${row.name} is live on the website again.` : `${row.name} is hidden from the website.`, 'success');
      } catch (err) {
        toast((err as Error).message, 'error');
      } finally {
        setBusyId(null);
        setPending(null);
      }
    },
    [api, toast],
  );

  const setCategoryActive = useCallback(
    async (row: AdminCategoryRow, isActive: boolean) => {
      setBusyId(row.id);
      try {
        await api.call((c) => c.PATCH('/api/admin/catalogue/categories/{id}', { params: { path: { id: row.id } }, body: { isActive } }));
        setCategories((xs) => xs?.map((c) => (c.id === row.id ? { ...c, isActive } : c)) ?? xs);
        toast(isActive ? `${row.name} category is shown on the website again.` : `${row.name} category is hidden from the website.`, 'success');
      } catch (err) {
        toast((err as Error).message, 'error');
      } finally {
        setBusyId(null);
        setPending(null);
      }
    },
    [api, toast],
  );

  const showCategoryServices = useCallback((id: string) => {
    setCategoryId(id);
    setQuery('');
    setStatus('');
    setTab('services');
  }, []);

  const serviceColumns = useMemo(() => {
    const col = createColumnHelper<AdminServiceRow>();
    return [
      col.accessor('name', {
        header: 'Service',
        cell: ({ row: { original: s } }) => (
          <div>
            <Link href={`/services/${s.id}`} className="font-semibold text-night underline-offset-2 hover:text-ink hover:underline">
              {s.name}
            </Link>
            {s.isPopular && (
              <Badge tone="accent" className="ml-2">
                Popular
              </Badge>
            )}
            <p className="text-xs text-muted">/{s.slug}</p>
          </div>
        ),
      }),
      col.accessor((s) => s.category.name, {
        id: 'category',
        header: 'Category',
        filterFn: (row, _id, value: string) => !value || row.original.category.id === value,
        cell: ({ row: { original: s } }) => (
          <div>
            {s.category.name}
            {s.subcategory && <p className="text-xs text-muted">{s.subcategory}</p>}
          </div>
        ),
      }),
      col.accessor((s) => s.startingPrice ?? undefined, {
        id: 'price',
        header: 'From',
        sortUndefined: 'last',
        meta: { className: 'text-right' },
        cell: ({ getValue }) => {
          const v = getValue();
          return v === undefined ? <span className="text-danger">No active package</span> : formatINR(v);
        },
      }),
      col.accessor('applications', { header: 'Applications', meta: { className: 'text-right' } }),
      col.accessor((s) => statusOf(s.isActive), {
        id: 'status',
        header: 'Status',
        filterFn: 'equalsString',
        cell: ({ row }) => <StatusBadge active={row.original.isActive} />,
      }),
      col.display({
        id: 'actions',
        header: () => <span className="sr-only">Actions</span>,
        meta: { className: 'text-right' },
        cell: ({ row: { original: s } }) => (
          <div className="flex justify-end gap-2">
            <LinkButton href={`/services/${s.id}`} variant="ghost" size="sm" aria-label={`Edit ${s.name}`}>
              Edit
            </LinkButton>
            {s.isActive ? (
              <Button variant="outline" size="sm" disabled={busyId === s.id} onClick={() => setPending({ kind: 'service', row: s })} aria-label={`Deactivate ${s.name}`}>
                Deactivate
              </Button>
            ) : (
              <Button variant="ink" size="sm" disabled={busyId === s.id} onClick={() => setServiceActive(s, true)} aria-label={`Reactivate ${s.name}`}>
                {busyId === s.id ? 'Reactivating…' : 'Reactivate'}
              </Button>
            )}
          </div>
        ),
      }),
    ];
  }, [busyId, setServiceActive]);

  const categoryColumns = useMemo(() => {
    const col = createColumnHelper<AdminCategoryRow>();
    return [
      col.accessor('name', {
        header: 'Category',
        cell: ({ row: { original: c } }) => (
          <div>
            <span className="font-semibold text-night">{c.name}</span>
            <p className="text-xs text-muted">/{c.slug}</p>
          </div>
        ),
      }),
      col.accessor('services', {
        header: 'Services',
        cell: ({ row: { original: c } }) => (
          <button type="button" onClick={() => showCategoryServices(c.id)} className="text-left text-ink underline-offset-2 hover:underline">
            {c.activeServices} of {c.services} active
          </button>
        ),
      }),
      col.accessor('sortOrder', { header: 'Order', meta: { className: 'text-right' } }),
      col.accessor((c) => statusOf(c.isActive), {
        id: 'status',
        header: 'Status',
        filterFn: 'equalsString',
        cell: ({ row }) => <StatusBadge active={row.original.isActive} />,
      }),
      col.display({
        id: 'actions',
        header: () => <span className="sr-only">Actions</span>,
        meta: { className: 'text-right' },
        cell: ({ row: { original: c } }) =>
          c.isActive ? (
            <Button variant="outline" size="sm" disabled={busyId === c.id} onClick={() => setPending({ kind: 'category', row: c })} aria-label={`Deactivate ${c.name} category`}>
              Deactivate
            </Button>
          ) : (
            <Button variant="ink" size="sm" disabled={busyId === c.id} onClick={() => setCategoryActive(c, true)} aria-label={`Reactivate ${c.name} category`}>
              {busyId === c.id ? 'Reactivating…' : 'Reactivate'}
            </Button>
          ),
      }),
    ];
  }, [busyId, setCategoryActive, showCategoryServices]);

  const serviceFilters: ColumnFiltersState = [
    ...(categoryId ? [{ id: 'category', value: categoryId }] : []),
    ...(status ? [{ id: 'status', value: status }] : []),
  ];
  const categoryFilters: ColumnFiltersState = status ? [{ id: 'status', value: status }] : [];
  const filtered = !!(query || categoryId || status);
  const clearFilters = () => {
    setQuery('');
    setCategoryId('');
    setStatus('');
  };
  const noMatch = (
    <EmptyState
      title="Nothing matches these filters"
      description="Try a different search, or clear the filters."
      action={
        filtered && (
          <Button variant="outline" size="sm" onClick={clearFilters}>
            Clear filters
          </Button>
        )
      }
    />
  );
  let results: ReactNode;
  if (loadError) {
    results = (
      <div className="space-y-3">
        <Notice tone="error">{loadError}</Notice>
        <Button variant="outline" size="sm" onClick={() => setReload((n) => n + 1)}>
          Try again
        </Button>
      </div>
    );
  } else if (!services || !categories) {
    results = (
      <output className="block text-muted">
        Loading the catalogue…
      </output>
    );
  } else if (tab === 'services') {
    results = (
      <DataTable
        caption="Services"
        data={services}
        columns={serviceColumns}
        getRowId={(s) => s.id}
        globalFilter={query}
        globalFilterFn={serviceSearch}
        columnFilters={serviceFilters}
        minWidth={820}
        empty={noMatch}
      />
    );
  } else {
    results = (
      <DataTable
        caption="Categories"
        data={categories}
        columns={categoryColumns}
        getRowId={(c) => c.id}
        globalFilter={query}
        globalFilterFn={categorySearch}
        columnFilters={categoryFilters}
        minWidth={640}
        empty={noMatch}
      />
    );
  }

  return (
    <div className="max-w-[1200px]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-[-0.02em]">Services</h1>
          <p className="mt-1 text-muted">Find, edit and add services, and switch services and categories on or off on the website.</p>
        </div>
        <LinkButton href="/services/new" variant="ink">
          New service
        </LinkButton>
      </div>

      <fieldset className="mt-6 inline-flex rounded-md border border-rule bg-white p-1">
        <legend className="sr-only">Show</legend>
        {(['services', 'categories'] as const).map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={tab === t}
            onClick={() => setTab(t)}
            className={`rounded px-4 py-1.5 text-sm font-medium transition-colors ${tab === t ? 'bg-ink text-white' : 'text-muted hover:text-night'}`}
          >
            {catalogueTabLabel(t, services, categories)}
          </button>
        ))}
      </fieldset>

      <div className={`mt-4 grid gap-3 ${tab === 'services' ? 'sm:grid-cols-[1fr_220px_160px]' : 'sm:grid-cols-[1fr_160px]'}`}>
        <Field
          id="catalogue-search"
          label="Search"
          type="search"
          placeholder={tab === 'services' ? 'Name, slug or category' : 'Category name'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {tab === 'services' && (
          <Select id="catalogue-category" label="Category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">All categories</option>
            {categories?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        )}
        <Select id="catalogue-status" label="Status" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
          <option value="">Any status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </Select>
      </div>

      <div className="mt-4">
        {results}
      </div>

      <Dialog
        open={!!pending}
        onClose={() => busyId === null && setPending(null)}
        title={deactivationTitle(pending)}
        description={
          pending?.kind === 'service'
            ? `It will be hidden from the website and can no longer be ordered. ${applicationsNote(pending.row.applications)} You can reactivate it at any time.`
            : 'Its category page and menu entry will be hidden from the website. Its services stay live — deactivate them separately if they should not be ordered. You can reactivate it at any time.'
        }
        footer={
          <>
            <Button variant="outline" onClick={() => setPending(null)} disabled={busyId !== null}>
              Cancel
            </Button>
            <Button
              variant="ink"
              disabled={busyId !== null}
              onClick={() => pending && (pending.kind === 'service' ? setServiceActive(pending.row, false) : setCategoryActive(pending.row, false))}
            >
              {busyId ? 'Deactivating…' : 'Deactivate'}
            </Button>
          </>
        }
      />
    </div>
  );
}

function catalogueTabLabel(tab: Tab, services: AdminServiceRow[] | null, categories: AdminCategoryRow[] | null): string {
  const count = tab === 'services' ? services?.length : categories?.length;
  const label = tab === 'services' ? 'Services' : 'Categories';
  return count === undefined ? label : `${label} (${count})`;
}

function deactivationTitle(pending: Pending | null): string {
  if (!pending) return '';
  const suffix = pending.kind === 'category' ? ' category' : '';
  return `Deactivate ${pending.row.name}${suffix}?`;
}

function applicationsNote(n: number) {
  if (n === 0) return '';
  return `Its ${n} existing application${n === 1 ? ' is' : 's are'} not changed.`;
}
