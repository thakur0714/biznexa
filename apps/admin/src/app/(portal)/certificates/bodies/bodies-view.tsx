'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import type { CertificationBodyRow } from '@biznexa/types';
import { Badge, Button, Dialog, EmptyState, Field, Notice, useToast } from '@biznexa/ui';
import { useApi } from '@biznexa/api-client/react';
import { DataTable } from '@/components/data-table';
import { NotAllowed } from '@/components/portal-shell';
import { useAuth } from '@/lib/auth';
import { canSee, findNavItem } from '@/lib/nav';

export function CertificationBodiesView() {
  const { user } = useAuth();
  const item = findNavItem('certificates');
  if (!user || !item) return null;
  if (!canSee(item, user.permissions)) return <NotAllowed />;
  return <Bodies />;
}

type BodyDraft = {
  name: string;
  accreditation: string;
  website: string;
  logoUrl: string;
};

const EMPTY_DRAFT: BodyDraft = { name: '', accreditation: '', website: '', logoUrl: '' };

function Bodies() {
  const api = useApi();
  const toast = useToast();
  const [bodies, setBodies] = useState<CertificationBodyRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [query, setQuery] = useState('');

  /** undefined = closed, null = new body, CertificationBodyRow = editing */
  const [editing, setEditing] = useState<CertificationBodyRow | null | undefined>(undefined);
  const [draft, setDraft] = useState<BodyDraft>(EMPTY_DRAFT);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const [deleting, setDeleting] = useState<CertificationBodyRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  let saveButtonLabel = 'Add body';
  if (editing) saveButtonLabel = 'Save changes';
  if (submitting) saveButtonLabel = 'Saving…';

  useEffect(() => {
    let cancelled = false;
    api
      .call((c) => c.GET('/api/admin/certificates/bodies'))
      .then(
        (list) => {
          if (!cancelled) {
            setBodies(list);
            setLoadError(null);
          }
        },
        (err: Error) => !cancelled && setLoadError(err.message),
      );
    return () => {
      cancelled = true;
    };
  }, [api, reload]);

  const openEdit = (b: CertificationBodyRow | null) => {
    setEditing(b);
    setFormErrors({});
    if (b) {
      setDraft({
        name: b.name,
        accreditation: b.accreditation ?? '',
        website: b.website ?? '',
        logoUrl: b.logoUrl ?? '',
      });
    } else {
      setDraft(EMPTY_DRAFT);
    }
  };

  const saveBody = async () => {
    setFormErrors({});

    const errs: Record<string, string> = {};
    if (!draft.name.trim()) errs.name = 'Enter body name';
    if (draft.website.trim() && !draft.website.trim().startsWith('https://')) {
      errs.website = 'Must be an https:// URL';
    }
    if (draft.logoUrl.trim() && !draft.logoUrl.trim().startsWith('https://')) {
      errs.logoUrl = 'Must be an https:// URL';
    }

    if (Object.keys(errs).length > 0) {
      return setFormErrors(errs);
    }

    setSubmitting(true);
    try {
      const payload = {
        name: draft.name.trim(),
        accreditation: draft.accreditation.trim() || null,
        website: draft.website.trim() || null,
        logoUrl: draft.logoUrl.trim() || null,
      };

      if (editing) {
        const updated = await api.call((c) =>
          c.PATCH('/api/admin/certificates/bodies/{id}', {
            params: { path: { id: editing.id } },
            body: payload,
          }),
        );
        setBodies((xs) => xs?.map((b) => (b.id === updated.id ? updated : b)) ?? xs);
        toast(`${updated.name} updated.`, 'success');
      } else {
        const created = await api.call((c) =>
          c.POST('/api/admin/certificates/bodies', {
            body: payload,
          }),
        );
        setBodies((xs) => [created, ...(xs ?? [])]);
        toast(`${created.name} created.`, 'success');
      }
      setEditing(undefined);
    } catch (err: unknown) {
      const error = err as { message?: string; errors?: { field: string; message: string }[] };
      if (error.errors && error.errors.length > 0) {
        setFormErrors(Object.fromEntries(error.errors.map((e) => [e.field, e.message])));
      } else {
        toast(error.message ?? 'Could not save certification body', 'error');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const removeBody = useCallback(
    async (row: CertificationBodyRow) => {
      setBusyId(row.id);
      try {
        await api.call((c) =>
          c.DELETE('/api/admin/certificates/bodies/{id}', {
            params: { path: { id: row.id } },
          }),
        );
        setBodies((xs) => xs?.filter((b) => b.id !== row.id) ?? xs);
        toast(`${row.name} deleted.`, 'success');
      } catch (err) {
        toast((err as Error).message, 'error');
      } finally {
        setBusyId(null);
        setDeleting(null);
      }
    },
    [api, toast],
  );

  const columns = useMemo(() => {
    const col = createColumnHelper<CertificationBodyRow>();
    return [
      col.accessor('name', {
        header: 'Name',
        cell: ({ row: { original: b } }) => (
          <div>
            <button
              type="button"
              onClick={() => openEdit(b)}
              className="font-semibold text-night underline-offset-2 hover:text-ink hover:underline"
            >
              {b.name}
            </button>
            {b.website && (
              <p className="text-xs text-muted">
                <a href={b.website} target="_blank" rel="noreferrer" className="hover:underline">
                  {b.website}
                </a>
              </p>
            )}
          </div>
        ),
      }),
      col.accessor('accreditation', {
        header: 'Accreditation',
        cell: ({ getValue }) => getValue() ?? <span className="text-muted">—</span>,
      }),
      col.accessor('logoUrl', {
        header: 'Logo',
        cell: ({ getValue }) =>
          getValue() ? (
            <Badge tone="info">URL set</Badge>
          ) : (
            <span className="text-muted">None</span>
          ),
      }),
      col.display({
        id: 'actions',
        header: () => <span className="sr-only">Actions</span>,
        meta: { className: 'text-right' },
        cell: ({ row: { original: b } }) => (
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => openEdit(b)} aria-label={`Edit ${b.name}`}>
              Edit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busyId === b.id}
              onClick={() => setDeleting(b)}
              aria-label={`Delete ${b.name}`}
            >
              Delete
            </Button>
          </div>
        ),
      }),
    ];
  }, [busyId]);

  const filtered = useMemo(() => {
    if (!bodies) return [];
    const q = query.trim().toLowerCase();
    if (!q) return bodies;
    return bodies.filter(
      (b) =>
        b.name.toLowerCase().includes(q) ||
          b.accreditation?.toLowerCase().includes(q),
    );
  }, [bodies, query]);

  let bodyContent: React.ReactNode;
  if (loadError) bodyContent = <div className="space-y-3"><Notice tone="error">{loadError}</Notice><Button variant="outline" size="sm" onClick={() => setReload((n) => n + 1)}>Try again</Button></div>;
  else if (!bodies) bodyContent = <output className="block text-muted">Loading certification bodies…</output>;
  else if (bodies.length === 0) bodyContent = <EmptyState title="No certification bodies yet" description="Add accredited bodies that issue ISO and other certifications." action={<Button variant="ink" size="sm" onClick={() => openEdit(null)}>Add body</Button>} />;
  else {
    bodyContent = (
      <DataTable
        caption="Certification bodies"
        data={filtered}
        columns={columns}
        getRowId={(b) => b.id}
        minWidth={600}
        empty={
          <EmptyState
            title="Nothing matches this search"
            description="Try a different query or clear search."
            action={<Button variant="outline" size="sm" onClick={() => setQuery('')}>Clear search</Button>}
          />
        }
      />
    );
  }

  return (
    <div className="max-w-[1000px]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-[-0.02em]">Certification bodies</h1>
          <p className="mt-1 text-muted">Manage accredited certification bodies that issue certificates.</p>
        </div>
        <Button variant="ink" onClick={() => openEdit(null)} disabled={!bodies}>
          Add body
        </Button>
      </div>

      <div className="mt-4 max-w-sm">
        <Field
          id="body-search"
          label="Search"
          type="search"
          placeholder="Body name or accreditation"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="mt-4">
        {bodyContent}
      </div>

      <Dialog
        open={editing !== undefined}
        onClose={() => !submitting && setEditing(undefined)}
        title={editing ? `Edit ${editing.name}` : 'Add certification body'}
        description="Provide the details for this accredited certification body."
        footer={
          <>
            <Button variant="outline" onClick={() => setEditing(undefined)} disabled={submitting}>
              Cancel
            </Button>
            <Button variant="ink" disabled={submitting} onClick={() => void saveBody()}>
              {saveButtonLabel}
            </Button>
          </>
        }
      >
        <form onSubmit={(event) => { event.preventDefault(); void saveBody(); }} className="space-y-4 py-2" noValidate>
          <Field
            id="body-name"
            label="Body name"
            required
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            error={formErrors.name}
          />
          <Field
            id="body-accreditation"
            label="Accreditation details (optional)"
            value={draft.accreditation}
            onChange={(e) => setDraft((d) => ({ ...d, accreditation: e.target.value }))}
            error={formErrors.accreditation}
          />
          <Field
            id="body-website"
            label="Website (optional)"
            type="url"
            placeholder="https://example.com"
            value={draft.website}
            onChange={(e) => setDraft((d) => ({ ...d, website: e.target.value }))}
            error={formErrors.website}
            hint="Must start with https://"
          />
          <Field
            id="body-logo-url"
            label="Logo URL (optional)"
            type="url"
            placeholder="https://example.com/logo.png"
            value={draft.logoUrl}
            onChange={(e) => setDraft((d) => ({ ...d, logoUrl: e.target.value }))}
            error={formErrors.logoUrl}
            hint="Must start with https://"
          />
        </form>
      </Dialog>

      <Dialog
        open={!!deleting}
        onClose={() => busyId === null && setDeleting(null)}
        title={deleting ? `Delete ${deleting.name}?` : ''}
        description="If this certification body is not used by any certificate, it will be removed permanently."
        footer={
          <>
            <Button variant="outline" onClick={() => setDeleting(null)} disabled={busyId !== null}>
              Cancel
            </Button>
            <Button
              variant="ink"
              disabled={busyId !== null}
              onClick={() => deleting && removeBody(deleting)}
            >
              {busyId !== null ? 'Deleting…' : 'Delete'}
            </Button>
          </>
        }
      />
    </div>
  );
}
