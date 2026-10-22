'use client';

import { useState, useEffect, type SubmitEvent } from 'react';
import { useApi } from '@biznexa/api-client/react';
import { Notice, Button, EmptyState, Dialog, Field, useToast } from '@biznexa/ui';
import { DataTable } from '@/components/data-table';
import { formatDate, type AdminDocumentReviewQueuePage, type AdminDocumentReviewQueueRow, type RejectionPresets } from '@biznexa/types';
import Link from 'next/link';

type DocumentItem = AdminDocumentReviewQueueRow;
type DocumentCellInfo = { row: { original: DocumentItem } };

export function DocumentsView() {
  const api = useApi();
  const toast = useToast();
  const [data, setData] = useState<AdminDocumentReviewQueuePage | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);

  const [previewFile, setPreviewFile] = useState<{ id: string; url?: string; type?: string; error?: string } | null>(null);

  const [rejectDialog, setRejectDialog] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectPresets, setRejectPresets] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (rejectDialog) {
      api.call<RejectionPresets>(c => c.GET('/api/admin/settings/rejection-presets'))
        .then(d => {
          if (!cancelled) setRejectPresets(d.presets);
        })
        .catch(() => {});
    }
    return () => { cancelled = true; };
  }, [api, rejectDialog]);

  const handleApprove = async (id: string) => {
    setIsSubmitting(true);
    setActionError(null);
    try {
      await api.call(c => c.POST('/api/admin/documents/{id}/approve', {
        params: { path: { id } }
      }));
      toast('Document has been approved.', 'success');
      setReload(r => r + 1);
    } catch (e: unknown) {
      setActionError((e as Error).message || 'Failed to approve');
      toast((e as Error).message || 'Failed to approve document', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReject = async (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!rejectReason.trim()) {
      return;
    }
    setIsSubmitting(true);
    setActionError(null);
    try {
      await api.call(c => c.POST('/api/admin/documents/{id}/reject', {
        params: { path: { id: rejectDialog! } },
        body: { reason: rejectReason }
      }));
      toast('Document has been rejected.', 'success');
      setRejectDialog(null);
      setRejectReason('');
      setReload(r => r + 1);
    } catch (err: unknown) {
      setActionError((err as Error).message || 'Failed to reject');
    } finally {
      setIsSubmitting(false);
    }
  };


  const handlePreview = async (doc: DocumentItem) => {
    const fileId = doc.fileId!;
    setPreviewFile({ id: fileId });
    try {
      const result = await api.call<{ url: string; expiresAt: string }>(c => c.POST('/api/files/{id}/link', {
        params: { path: { id: fileId }, query: { disposition: 'inline' } }
      }));
      setPreviewFile({ id: fileId, url: result.url, type: doc.mimeType ?? undefined });
    } catch (e: unknown) {
      const err = e as { status?: number; message?: string };
      if (err.status === 409) {
        setPreviewFile({ id: fileId, error: 'Still being checked for viruses — try again in a minute' });
      } else if (err.status === 410) {
        setPreviewFile({ id: fileId, error: err.message });
      } else {
        setPreviewFile({ id: fileId, error: err.message || 'Failed to generate link' });
      }
    }
  };

  useEffect(() => {
    let cancelled = false;
    api.call<AdminDocumentReviewQueuePage>((c) =>
      c.GET('/api/admin/documents/review-queue', {
        params: { query: { page, limit: 25 } },
      })
    )
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setLoadError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [api, page, reload]);

  const columns = documentColumns({ isSubmitting, onPreview: handlePreview, onApprove: handleApprove, onReject: setRejectDialog });

  let previewContent: React.ReactNode;
  if (previewFile?.type?.startsWith('image/')) {
    previewContent = (
      // eslint-disable-next-line @next/next/no-img-element -- documents are customer uploads and may use any host
      <img src={previewFile.url} alt="Document preview" className="max-w-full max-h-[60vh] object-contain" />
    );
  } else if (previewFile?.type === 'application/pdf') {
    previewContent = <iframe src={previewFile.url} className="w-full h-[60vh] border-0" title="Document preview" />;
  } else {
    previewContent = <p className="text-muted">Preview not available for this file type. Download to view.</p>;
  }

  return (
    <div className="max-w-[1200px]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-[-0.02em]">Document Review</h1>
          <p className="mt-1 text-muted">Review customer documents for applications.</p>
        </div>
      </div>

      <div className="mt-4">
        {loadError && (
          <div className="space-y-3">
            <Notice tone="error">{loadError}</Notice>
            <Button variant="outline" size="sm" onClick={() => setReload((n) => n + 1)}>
              Try again
            </Button>
          </div>
        )}
        {!loadError && !data && (
          <output className="block text-muted">
            Loading documents…
          </output>
        )}
        {!loadError && data?.items.length === 0 && (
          <EmptyState
            title="No documents waiting for review"
            description="All documents have been reviewed."
          />
        )}
        {!loadError && data && data.items.length > 0 && (
          <div>
            <DataTable
              caption="Documents"
              data={data.items}
              columns={columns}
              getRowId={(p) => p.id}
              minWidth={900}
              empty={
                <EmptyState
                  title="No documents waiting for review"
                  description="All documents have been reviewed."
                />
              }
            />
            {data.total > 25 && (
              <div className="mt-4 flex items-center justify-between border-t border-rule pt-4 text-sm">
                <p className="text-muted">
                  Showing {(page - 1) * 25 + 1}–{Math.min(page * 25, data.total)} of {data.total} documents
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                    Previous
                  </Button>
                  <Button variant="outline" size="sm" disabled={page * 25 >= data.total} onClick={() => setPage((p) => p + 1)}>
                    Next
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <Dialog
        open={rejectDialog !== null}
        onClose={() => { setRejectDialog(null); setRejectReason(''); setActionError(null); }}
        title="Reject Document"
        description="Provide a reason for rejection."
      >
        <form onSubmit={handleReject} className="space-y-4 mt-4">
          {actionError && <Notice tone="error">{actionError}</Notice>}

          <div className="flex flex-wrap gap-2">
            {rejectPresets.map(p => (
              <Button key={p} variant="outline" size="sm" type="button" onClick={() => setRejectReason(p)}>
                {p}
              </Button>
            ))}
          </div>

          <Field
            id="rejectReason"
            label="Reason"
            type="textarea"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            required
            placeholder="Enter a rejection reason"
          />

          <div className="flex justify-end gap-3 mt-6">
            <Button type="button" variant="outline" onClick={() => { setRejectDialog(null); setRejectReason(''); setActionError(null); }}>
              Cancel
            </Button>
            <Button type="submit" variant="ink" disabled={isSubmitting || !rejectReason.trim()}>
              {isSubmitting ? 'Rejecting...' : 'Reject Document'}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={previewFile !== null}
        onClose={() => setPreviewFile(null)}
        title="Document Preview"
        description="Preview of the uploaded document."
      >
        <div className="min-h-[300px] flex items-center justify-center bg-paper border border-rule rounded mt-4">
          {!previewFile?.url && !previewFile?.error && <p className="text-muted">Loading preview...</p>}
          {previewFile?.error && <p className="text-danger p-4 text-center">{previewFile.error}</p>}
          {previewFile?.url && previewContent}
        </div>
      </Dialog>
    </div>
  );
}

type DocumentActions = Readonly<{
  isSubmitting: boolean;
  onPreview: (doc: DocumentItem) => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}>;

function documentColumns({ isSubmitting, onPreview, onApprove, onReject }: DocumentActions) {
  return [
  {
    header: 'Document Name',
    accessorKey: 'name',
    cell: (info: DocumentCellInfo) => info.row.original.name,
  },
  {
    header: 'Application',
    accessorKey: 'application',
    cell: (info: DocumentCellInfo) => (
      <Link href={`/applications/${info.row.original.application.id}`} className="text-sky-600 hover:underline">
        {info.row.original.application.code}
      </Link>
    ),
  },
  {
    header: 'Customer',
    accessorKey: 'customer',
    cell: (info: DocumentCellInfo) => (
      <div>
        <div>{info.row.original.application.customer?.name ?? '—'}</div>
        {info.row.original.application.customer?.email && (
          <div className="text-xs text-muted">{info.row.original.application.customer.email}</div>
        )}
      </div>
    ),
  },
  {
    header: 'File Info',
    accessorKey: 'fileInfo',
    cell: (info: DocumentCellInfo) => (
      <div>
        <div>{info.row.original.fileName ?? '—'}</div>
        {info.row.original.sizeBytes != null && (
          <div className="text-xs text-muted">
            {(info.row.original.sizeBytes / 1024).toFixed(1)} KB
          </div>
        )}
      </div>
    ),
  },
  {
    header: 'Uploaded Time (IST)',
    accessorKey: 'uploadedAt',
    cell: (info: DocumentCellInfo) => (info.row.original.uploadedAt ? formatDate(info.row.original.uploadedAt) : '—'),
  },
  {
    header: 'Actions',
    accessorKey: 'actions',
    cell: (info: DocumentCellInfo) => (
      <div className="flex gap-2 flex-wrap items-center">
        {info.row.original.fileId && (
          <Button variant="outline" size="sm" onClick={() => onPreview(info.row.original)}>
            Preview
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={() => onApprove(info.row.original.id)} disabled={isSubmitting}>
          Approve
        </Button>
        <Button variant="outline" size="sm" onClick={() => onReject(info.row.original.id)} disabled={isSubmitting}>
          Reject
        </Button>
      </div>
    ),
  },
  ];
}
