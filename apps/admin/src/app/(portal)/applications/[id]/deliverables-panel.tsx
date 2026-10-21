'use client';

import { useEffect, useState } from 'react';
import { useApi } from '@biznexa/api-client/react';
import { Button, Field, Notice } from '@biznexa/ui';
import { formatDate, PERMS, type ApplicationStatus, type Deliverable, type FileLinkResult, type StoredFileResult } from '@biznexa/types';
import { useAuth } from '@/lib/auth';

export function DeliverablesPanel({ applicationId, status }: Readonly<{ applicationId: string; status: ApplicationStatus }>) {
  const api = useApi();
  const { user } = useAuth();
  const canAdd = Boolean(user?.permissions.includes(PERMS.APPLICATIONS_UPDATE)) && (status === 'IN_PROGRESS' || status === 'COMPLETED');
  const [items, setItems] = useState<Deliverable[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [openingFileId, setOpeningFileId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadCount, setReloadCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api.call((client) => client.GET('/api/admin/applications/{applicationId}/deliverables', {
        params: { path: { applicationId } },
      }))
      .then((result) => {
        if (!cancelled) {
          setItems(result);
          setLoading(false);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load deliverables.');
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [api, applicationId, reloadCount]);

  let deliverablesContent: React.ReactNode;
  if (loading) {
    deliverablesContent = <p role="status" className="text-sm text-muted">Loading deliverables…</p>;
  } else if (!items.length) {
    deliverablesContent = <p className="text-sm text-muted">No final deliverables have been added.</p>;
  } else {
    deliverablesContent = (
      <ul className="divide-y divide-rule">
        {items.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
            <div className="min-w-0">
              <p className="font-medium">{item.title}</p>
              <p className="truncate text-sm text-muted">{item.fileName} · {formatDate(item.createdAt)}</p>
            </div>
            <Button variant="outline" size="sm" type="button" disabled={openingFileId === item.fileId} onClick={() => void openFile(item.fileId)}>
              {openingFileId === item.fileId ? 'Opening…' : 'Open'}
            </Button>
          </li>
        ))}
      </ul>
    );
  }

  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim() || !file || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const body = new FormData();
      body.append('file', file);
      // OpenAPI represents a multipart binary as `string`; the enumerable property satisfies that
      // generated shape while openapi-fetch still sends this FormData instance as multipart.
      const uploadBody = Object.assign(body, { file: file.name });
      const uploaded = await api.call<StoredFileResult>((client) => client.POST('/api/files', { body: uploadBody }));
      await api.call((client) => client.POST('/api/admin/applications/{applicationId}/deliverables', {
        params: { path: { applicationId } },
        body: { title: title.trim(), fileId: uploaded.id },
      }));
      setTitle('');
      setFile(null);
      const fileInput = document.getElementById(`deliverable-file-${applicationId}`);
      if (fileInput instanceof HTMLInputElement) fileInput.value = '';
      setLoading(true);
      setReloadCount((count) => count + 1);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not add this deliverable.');
    } finally {
      setSubmitting(false);
    }
  }

  async function openFile(fileId: string) {
    setError(null);
    setOpeningFileId(fileId);
    const tab = window.open('', '_blank');
    try {
      const link = await api.call<FileLinkResult>((client) => client.POST('/api/files/{id}/link', {
        params: { path: { id: fileId }, query: { disposition: 'inline' } },
      }));
      if (tab) {
        tab.opener = null;
        tab.location.href = link.url;
      } else {
        window.location.assign(link.url);
      }
    } catch (err: unknown) {
      tab?.close();
      setError(err instanceof Error ? err.message : 'Could not open this file.');
    } finally {
      setOpeningFileId(null);
    }
  }

  return (
    <section className="space-y-4 rounded-md border border-rule bg-white p-4" aria-labelledby="deliverables-heading">
      <h2 id="deliverables-heading" className="text-lg font-semibold">Final deliverables</h2>
      {error && <Notice tone="error">{error}</Notice>}
      {deliverablesContent}

      {canAdd && (
        <form onSubmit={submit} className="space-y-3 border-t border-rule pt-4">
          <h3 className="font-semibold">Add a deliverable</h3>
          <Field id={`deliverable-title-${applicationId}`} label="Title" value={title} maxLength={150} onChange={(event) => setTitle(event.target.value)} required />
          <div className="space-y-1">
            <label htmlFor={`deliverable-file-${applicationId}`} className="block text-sm font-medium">File</label>
            <input
              id={`deliverable-file-${applicationId}`}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              required
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              className="block min-h-11 w-full rounded-md border border-rule bg-white p-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-paper file:px-3 file:py-1.5"
            />
          </div>
          <Button variant="ink" type="submit" disabled={!title.trim() || !file || submitting}>
            {submitting ? 'Uploading…' : 'Add deliverable'}
          </Button>
        </form>
      )}
    </section>
  );
}
