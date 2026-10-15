'use client';

import { useState, useEffect } from 'react';
import { useApi } from '@biznexa/api-client/react';
import { Notice, Button, EmptyState, Dialog, Field, useToast } from '@biznexa/ui';
import { DataTable } from '@/components/data-table';
import { formatDate } from '@biznexa/types';
import Link from 'next/link';

type DocumentItem = {
  id: string;
  name: string;
  application: { id: string; code: string; customerName: string; customerEmail: string };
  fileName: string;
  size: number;
  uploadedAt: string;
  fileId?: string;
};

export function DocumentsView() {
  const api = useApi();
  const toast = useToast();
  const [data, setData] = useState<{ items: DocumentItem[]; total: number } | null>(null);
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
      api.call(c => c.GET('/api/admin/settings/rejection-presets'))
        .then(d => {
          if (!cancelled) setRejectPresets(d as unknown as string[]);
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

  const handleReject = async (e: React.FormEvent) => {
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


  const handlePreview = async (fileId: string) => {
    setPreviewFile({ id: fileId });
    try {
      const result = await api.call(c => c.POST('/api/files/{id}/link', {
        params: { path: { id: fileId }, query: { disposition: 'inline' } }
      })) as { url: string; expiresAt: string };
      const doc = data?.items.find(i => i.fileId === fileId);
      const isImg = doc?.fileName.match(/\.(jpeg|jpg|png|webp|gif)$/i);
      setPreviewFile({ id: fileId, url: result.url, type: isImg ? 'image/jpeg' : 'application/pdf' });
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
    api.call((c) =>
      c.GET('/api/admin/documents/review-queue', {
        params: { query: { page, limit: 25 } },
      })
    )
      .then((d) => {
        if (!cancelled) {
          setData(d as unknown as { items: DocumentItem[]; total: number });
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

  const columns = [
    {
      header: 'Document Name',
      accessorKey: 'name',
      cell: ({ row }: { row: { original: DocumentItem } }) => row.original.name,
    },
    {
      header: 'Application',
      accessorKey: 'application',
      cell: ({ row }: { row: { original: DocumentItem } }) => (
        <Link href={`/applications/${row.original.application.id}`} className="text-sky-600 hover:underline">
          {row.original.application.code}
        </Link>
      ),
    },
    {
      header: 'Customer',
      accessorKey: 'customer',
      cell: ({ row }: { row: { original: DocumentItem } }) => (
        <div>
          <div>{row.original.application.customerName}</div>
          <div className="text-xs text-muted">{row.original.application.customerEmail}</div>
        </div>
      ),
    },
    {
      header: 'File Info',
      accessorKey: 'fileInfo',
      cell: ({ row }: { row: { original: DocumentItem } }) => (
        <div>
          <div>{row.original.fileName}</div>
          <div className="text-xs text-muted">
            {(row.original.size / 1024).toFixed(1)} KB
          </div>
        </div>
      ),
    },
    {
      header: 'Uploaded Time (IST)',
      accessorKey: 'uploadedAt',
      cell: ({ row }: { row: { original: DocumentItem } }) => formatDate(row.original.uploadedAt),
    },
    {
      header: 'Actions',
      accessorKey: 'actions',
      cell: ({ row }: { row: { original: DocumentItem } }) => (
        <div className="flex gap-2 flex-wrap items-center">
          {row.original.fileId && (
            <Button variant="outline" size="sm" onClick={() => handlePreview(row.original.fileId!)}>
              Preview
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => handleApprove(row.original.id)} disabled={isSubmitting}>
            Approve
          </Button>
          <Button variant="outline" size="sm" onClick={() => setRejectDialog(row.original.id)} disabled={isSubmitting}>
            Reject
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="max-w-[1200px]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-[-0.02em]">Document Review</h1>
          <p className="mt-1 text-muted">Review customer documents for applications.</p>
        </div>
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
            Loading documents…
          </p>
        ) : data.items.length === 0 ? (
          <EmptyState
            title="No documents waiting for review"
            description="All documents have been reviewed."
          />
        ) : (
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
          {previewFile?.url && (
            previewFile.type?.startsWith('image/') ? (
              <img src={previewFile.url} alt="Document preview" className="max-w-full max-h-[60vh] object-contain" />
            ) : previewFile.type === 'application/pdf' ? (
              <iframe src={previewFile.url} className="w-full h-[60vh] border-0" title="Document preview" />
            ) : (
              <p className="text-muted">Preview not available for this file type. Download to view.</p>
            )
          )}
        </div>
      </Dialog>
    </div>
  );
}
