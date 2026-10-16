'use client';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { StatusForm } from './status-form';
import { MessagesPanel } from './messages-panel';
import { DeliverablesPanel } from './deliverables-panel';
import { useEffect, useState } from 'react';
import { useApi } from '@biznexa/api-client/react';
import { Notice, Button, Dialog, Field } from '@biznexa/ui';
import { APPLICATION_STATUS_LABEL, formatDate, formatINR, PERMS } from '@biznexa/types';

export function ApplicationDetailView({ id }: { id: string }) {
  const api = useApi();
  const { user } = useAuth();
  const [data, setData] = useState<import('@biznexa/types').AdminApplicationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Bumped after an assignment: it can also change the status and SLA, so the whole detail is reloaded. */
  const [version, setVersion] = useState(0);

  const canAssign = user?.permissions?.includes('applications.view_all') && user?.permissions?.includes('applications.update');
  const canRequestDocument = user?.permissions?.includes('documents.review') ?? false;
  const canIssueCertificate = (user?.permissions?.includes(PERMS.CERTIFICATES_MANAGE) ?? false) && (data?.status === 'COMPLETED' || data?.status === 'DELIVERED');
  const [requestDocDialog, setRequestDocDialog] = useState(false);
  const [docName, setDocName] = useState('');
  const [docDescription, setDocDescription] = useState('');
  const [isRequestingDoc, setIsRequestingDoc] = useState(false);
  const [docRequestError, setDocRequestError] = useState<string | null>(null);

  const handleRequestDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!docName.trim()) return;
    setIsRequestingDoc(true);
    setDocRequestError(null);
    try {
      await api.call(c => c.POST('/api/admin/applications/{applicationId}/documents', {
        params: { path: { applicationId: id } },
        body: { name: docName, description: docDescription || undefined }
      }));
      setRequestDocDialog(false);
      setDocName('');
      setDocDescription('');
      setVersion(v => v + 1);
    } catch (err: unknown) {
      setDocRequestError((err as Error).message || 'Failed to request document');
    } finally {
      setIsRequestingDoc(false);
    }
  };
  const [staff, setStaff] = useState<import('@biznexa/types').EligibleStaff[]>([]);
  useEffect(() => {
    let cancelled = false;
    if (canAssign) {
      api.call((c) => c.GET('/api/admin/applications/staff'))
        .then((d) => !cancelled && setStaff(d as import('@biznexa/types').EligibleStaff[]))
        .catch(() => {});
    }
    return () => { cancelled = true; };
  }, [api, canAssign]);

  const updateAssignee = async (assigneeId: string) => {
    try {
      await api.call(c => c.PATCH('/api/admin/applications/{id}/assignee', {
        params: { path: { id } },
        body: { assigneeId: assigneeId || null }
      }));
      setVersion((v) => v + 1);
    } catch (e: unknown) {
      alert((e as Error).message);
    }
  };

  const [notes, setNotes] = useState<import('@biznexa/types').InternalNote[]>([]);

  useEffect(() => {
    let cancelled = false;
    api.call((c) => c.GET('/api/admin/applications/{id}', { params: { path: { id } } }))
      .then((d) => !cancelled && setData(d as unknown as import('@biznexa/types').AdminApplicationDetail))
      .catch((e) => !cancelled && setError(e.message));

    api.call((c) => c.GET('/api/admin/applications/{applicationId}/notes', { params: { path: { applicationId: id } } }))
      .then((d) => !cancelled && setNotes(d as unknown as import('@biznexa/types').InternalNote[]))
      .catch(() => {});
      
    return () => { cancelled = true; };
  }, [api, id, version]);

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data) return <p className="text-muted">Loading application...</p>;

  return (
    <div className="space-y-8 max-w-4xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Application {data.code}</h1>
        <div className="flex items-center gap-3">
          {canIssueCertificate && (
            <Link
              href={`/certificates/new?applicationId=${encodeURIComponent(data.id)}&organizationName=${encodeURIComponent(data.businessEntity?.legalName || data.customer?.name || '')}${data.businessEntity?.id ? `&entityId=${encodeURIComponent(data.businessEntity.id)}` : ''}`}
            >
              <Button variant="outline" size="sm">
                Issue certificate
              </Button>
            </Link>
          )}
          <span className="bg-sky-100 text-sky-800 px-3 py-1 rounded-full text-sm font-medium">
            {APPLICATION_STATUS_LABEL[data.status as keyof typeof APPLICATION_STATUS_LABEL] || data.status}
          </span>
        </div>
      </div>

      <StatusForm id={id} current={data.status as import('@biznexa/types').ApplicationStatus} stages={data.stages || []} />

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
          <p className="flex items-center gap-2">
            <span className="text-muted">Assignee:</span> {data.assignedTo?.name || 'Unassigned'} {canAssign && staff.length > 0 && (
              <select 
                className="ml-2 border rounded p-1 text-sm"
                value={data.assignedTo?.id || ''}
                onChange={e => updateAssignee(e.target.value)}
              >
                <option value="">Unassigned</option>
                {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
          </p>
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
        <div className="flex justify-between items-center mb-4">
          <h2 className="font-semibold text-lg">Documents</h2>
          {canRequestDocument && (
            <Button variant="outline" size="sm" onClick={() => setRequestDocDialog(true)}>
              Request document
            </Button>
          )}
        </div>
        <div className="space-y-3">
          {data.documents?.map((d: import('@biznexa/types').AdminApplicationDetail['documents'][0]) => (
            <div key={d.id} className="flex justify-between items-center text-sm border-b pb-2">
              <div>
                <p className="font-medium">{d.name}</p>
                <p className="text-xs text-muted">{d.fileName || 'No file'} • {d.status}</p>
              </div>
            </div>
          ))}
          {!data.documents?.length && <p className="text-muted text-sm">No documents required.</p>}
        </div>
      </section>


      <section className="p-4 bg-white border border-rule rounded-md">
        <h2 className="font-semibold text-lg mb-4">Form Answers</h2>
        <div className="space-y-4 text-sm">
          {data.formSchema?.steps?.map((step: import('@biznexa/types').FormSchema['steps'][0], idx: number) => (
            <div key={idx} className="border border-rule rounded-md p-3">
              <h3 className="font-medium border-b pb-2 mb-2">{step.title}</h3>
              {step.fields?.map((f: import('@biznexa/types').FormField) => (
                <p key={f.name}>
                  <span className="text-muted">{f.label}:</span> {String((data.formData as Record<string, unknown>)?.[f.name] ?? '—')}
                </p>
              ))}
            </div>
          ))}
          {!data.formSchema && <p className="text-muted text-sm">No form schema available.</p>}
        </div>
      </section>

<section className="p-4 bg-white border border-rule rounded-md">
        <h2 className="font-semibold text-lg mb-4">Internal Notes</h2>
        <div className="space-y-4 mb-4">
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
        <form onSubmit={async (e) => {
          e.preventDefault();
          const el = (e.target as HTMLFormElement).elements.namedItem('noteContent') as HTMLInputElement | null;
          if (!el || !el.value.trim()) return;
          try {
            const newNote = await api.call(c => c.POST('/api/admin/applications/{applicationId}/notes', {
              params: { path: { applicationId: id } },
              body: { content: el.value }
            }));
            setNotes([newNote as unknown as import('@biznexa/types').InternalNote, ...notes]);
            el.value = '';
          } catch(err: unknown) {
            alert((err as Error).message);
          }
        }} className="flex gap-2">
          <input name="noteContent" placeholder="Write a note..." className="flex-1 border border-rule p-2 rounded text-sm" />
          <Button variant="ink" type="submit">Add Note</Button>
        </form>
      </section>

      <MessagesPanel applicationId={id} />

      <DeliverablesPanel applicationId={id} status={data.status as import('@biznexa/types').ApplicationStatus} />

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

      {canRequestDocument && (
        <Dialog
          open={requestDocDialog}
          onClose={() => { setRequestDocDialog(false); setDocName(''); setDocDescription(''); setDocRequestError(null); }}
          title="Request Document"
          description="Request a new document from the customer."
        >
          <form onSubmit={handleRequestDocument} className="space-y-4 mt-4">
            {docRequestError && <Notice tone="error">{docRequestError}</Notice>}
            <Field
              id="docName"
              label="Document Name"
              value={docName}
              onChange={(e) => setDocName(e.target.value)}
              required
              maxLength={100}
            />
            <Field
              id="docDescription"
              label="Description (optional)"
              type="textarea"
              value={docDescription}
              onChange={(e) => setDocDescription(e.target.value)}
              maxLength={500}
            />
            <div className="flex justify-end gap-3 mt-6">
              <Button type="button" variant="outline" onClick={() => { setRequestDocDialog(false); setDocName(''); setDocDescription(''); setDocRequestError(null); }}>
                Cancel
              </Button>
              <Button type="submit" variant="ink" disabled={isRequestingDoc || !docName.trim()}>
                {isRequestingDoc ? 'Requesting...' : 'Request Document'}
              </Button>
            </div>
          </form>
        </Dialog>
      )}
    </div>
  );
}
