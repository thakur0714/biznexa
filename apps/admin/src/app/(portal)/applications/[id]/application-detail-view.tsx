'use client';

import { useEffect, useState } from 'react';
import { useApi } from '@biznexa/api-client/react';
import { Notice, Button } from '@biznexa/ui';
import { APPLICATION_STATUS_LABEL, formatDate, formatINR } from '@biznexa/types';

export function ApplicationDetailView({ id }: { id: string }) {
  const api = useApi();
  const [data, setData] = useState<import('@biznexa/types').AdminApplicationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<any[]>([]);

  useEffect(() => {
    let cancelled = false;
    api.call((c) => c.GET('/api/admin/applications/{id}', { params: { path: { id } } }))
      .then((d) => !cancelled && setData(d as any))
      .catch((e) => !cancelled && setError(e.message));

    api.call((c) => c.GET('/api/admin/applications/{applicationId}/notes', { params: { path: { applicationId: id } } }))
      .then((d) => !cancelled && setNotes(d as any))
      .catch(() => {});
      
    return () => { cancelled = true; };
  }, [api, id]);

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data) return <p className="text-muted">Loading application...</p>;

  return (
    <div className="space-y-8 max-w-4xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Application {data.code}</h1>
        <span className="bg-sky-100 text-sky-800 px-3 py-1 rounded-full text-sm font-medium">
          {APPLICATION_STATUS_LABEL[data.status as keyof typeof APPLICATION_STATUS_LABEL] || data.status}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <section className="p-4 bg-white border border-rule rounded-md space-y-2">
          <h2 className="font-semibold text-lg border-b pb-2">Customer</h2>
          {data.customer ? (
            <>
              <p><span className="text-muted">Name:</span> {data.customer.name}</p>
              <p><span className="text-muted">Email:</span> {data.customer.email}</p>
              <p><span className="text-muted">Mobile:</span> {data.customer.mobile}</p>
            </>
          ) : <p className="text-muted">No customer linked</p>}
        </section>

        <section className="p-4 bg-white border border-rule rounded-md space-y-2">
          <h2 className="font-semibold text-lg border-b pb-2">Service Details</h2>
          <p><span className="text-muted">Service:</span> {data.service.name}</p>
          <p><span className="text-muted">Package:</span> {data.package.name}</p>
          <p><span className="text-muted">Priority:</span> {data.priority}</p>
          <p><span className="text-muted">Assignee:</span> {data.assignedTo?.name || 'Unassigned'}</p>
          <p><span className="text-muted">SLA Due:</span> {data.slaDueAt ? formatDate(data.slaDueAt) : 'N/A'}</p>
        </section>

        <section className="p-4 bg-white border border-rule rounded-md space-y-2">
          <h2 className="font-semibold text-lg border-b pb-2">Order & Payments</h2>
          {data.order ? (
            <>
              <p><span className="text-muted">Order:</span> {data.order.code} ({data.order.status})</p>
              <p><span className="text-muted">Total:</span> {formatINR(data.order.total)}</p>
            </>
          ) : <p className="text-muted">No order linked</p>}
          {data.payments?.map(p => (
            <div key={p.id} className="text-sm mt-2 pt-2 border-t border-dashed">
              <p>{formatINR(p.amount)} via {p.method || 'Unknown'} - {p.status}</p>
              <p className="text-xs text-muted">{p.paidAt ? formatDate(p.paidAt) : ''}</p>
            </div>
          ))}
        </section>

        <section className="p-4 bg-white border border-rule rounded-md space-y-2">
          <h2 className="font-semibold text-lg border-b pb-2">Business Entity</h2>
          {data.businessEntity ? (
            <p><span className="text-muted">PAN:</span> {data.businessEntity.maskedPan}</p>
          ) : <p className="text-muted">N/A</p>}
        </section>
      </div>

      <section className="p-4 bg-white border border-rule rounded-md">
        <h2 className="font-semibold text-lg mb-4">Internal Notes</h2>
        <div className="space-y-4">
          {notes.map(note => (
            <div key={note.id} className="p-3 bg-paper rounded border border-rule">
              <p className="text-sm">{note.content}</p>
              <p className="text-xs text-muted mt-2">
                {note.authorName} • {formatDate(note.createdAt)}
              </p>
            </div>
          ))}
          {notes.length === 0 && <p className="text-muted">No internal notes yet.</p>}
        </div>
      </section>

      <section className="p-4 bg-white border border-rule rounded-md">
        <h2 className="font-semibold text-lg mb-4">History</h2>
        <div className="space-y-3">
          {data.history?.map(h => (
            <div key={h.id} className="text-sm border-l-2 border-sky-200 pl-3">
              <p className="font-medium">{h.status}</p>
              <p className="text-xs text-muted">
                {formatDate(h.createdAt)} by {h.changedBy?.name || 'System'}
                {h.visibleToCustomer && ' (Visible to customer)'}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
