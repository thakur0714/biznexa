'use client';

import { useCallback, useEffect, useState } from 'react';
import { useApi } from '@biznexa/api-client/react';
import {
  DATA_REQUEST_STATUSES,
  DATA_REQUEST_STATUS_LABEL,
  DATA_REQUEST_TYPES,
  DATA_REQUEST_TYPE_LABEL,
  type AdminDataRequestList,
  type AdminDataRequestRow,
  type DataRequestStatus,
  type DataRequestType,
} from '@biznexa/types';
import { Badge, Button, Dialog, EmptyState, Notice, Select, TextArea, type Tone } from '@biznexa/ui';
import { NotAllowed } from '@/components/portal-shell';
import { useAuth } from '@/lib/auth';
import { canSee, findNavItem } from '@/lib/nav';

const STATUS_TONE: Record<DataRequestStatus, Tone> = { PENDING: 'warning', PROCESSING: 'info', COMPLETED: 'success', REJECTED: 'danger' };
const message = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

type Action = { kind: 'approve' | 'reject'; row: AdminDataRequestRow };

/** DPDP request queue (M5.12, `privacy.manage`): approve a deletion (anonymises the account) or reject with a reason. */
export function PrivacyRequestsView() {
  const api = useApi();
  const { user } = useAuth();
  const item = findNavItem('privacy');
  const [type, setType] = useState<DataRequestType | ''>('');
  const [status, setStatus] = useState<DataRequestStatus | ''>('PENDING');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<AdminDataRequestList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [action, setAction] = useState<Action | null>(null);

  const load = useCallback(
    () =>
      api
        .call((c) => c.GET('/api/admin/privacy/requests', { params: { query: { type: type || undefined, status: status || undefined, page, limit: 25 } } }))
        .then((value) => {
          setResult(value);
          setError('');
        })
        .catch((err: unknown) => setError(message(err, 'Could not load privacy requests.')))
        .finally(() => setLoading(false)),
    [api, type, status, page, setLoading],
  );

  useEffect(() => {
    void load();
  }, [load]);

  if (!user || !item) return null;
  if (!canSee(item, user.permissions)) return <NotAllowed />;

  const filter = (apply: () => void) => {
    setLoading(true);
    setPage(1);
    apply();
  };

  return (
    <main className="space-y-5 p-4 sm:p-6" aria-labelledby="privacy-heading">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 id="privacy-heading" className="text-2xl font-semibold">Privacy requests</h1>
          <p className="mt-1 text-sm text-muted">Data exports run on their own. Deletions need your approval and anonymise the account; invoices, payments, credit notes and certificates are kept.</p>
        </div>
        <div className="flex w-full flex-wrap gap-3 sm:w-auto">
          <Select id="privacy-type-filter" label="Type" className="w-full sm:w-44" value={type} onChange={(e) => filter(() => setType(e.target.value as DataRequestType | ''))}>
            <option value="">All types</option>
            {DATA_REQUEST_TYPES.map((t) => <option key={t} value={t}>{DATA_REQUEST_TYPE_LABEL[t]}</option>)}
          </Select>
          <Select id="privacy-status-filter" label="Status" className="w-full sm:w-44" value={status} onChange={(e) => filter(() => setStatus(e.target.value as DataRequestStatus | ''))}>
            <option value="">All statuses</option>
            {DATA_REQUEST_STATUSES.map((s) => <option key={s} value={s}>{DATA_REQUEST_STATUS_LABEL[s]}</option>)}
          </Select>
        </div>
      </header>
      {error && <Notice tone="error">{error}</Notice>}
      {notice && <Notice tone="success">{notice}</Notice>}
      {loading && (
        <p role="status">Loading privacy requests…</p>
      )}
      {!loading && result?.items && result.items.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-lg border border-rule bg-white">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-paper text-xs uppercase text-muted">
                <tr>
                  <th className="p-3">Customer</th>
                  <th className="p-3">Request</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Notes</th>
                  <th className="p-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((r) => (
                  <tr key={r.id} className="border-t border-rule align-top">
                    <td className="p-3">
                      <div className="font-medium">{r.user.name}</div>
                      <div className="text-muted">{r.user.deleted ? 'Account deleted' : r.user.email ?? r.user.mobile ?? '—'}</div>
                    </td>
                    <td className="p-3">
                      <div>{DATA_REQUEST_TYPE_LABEL[r.type]}</div>
                      <div className="text-muted">{when(r.createdAt)}</div>
                    </td>
                    <td className="p-3">
                      <Badge tone={STATUS_TONE[r.status]}>{DATA_REQUEST_STATUS_LABEL[r.status]}</Badge>
                      {r.handledBy && <div className="mt-1 text-xs text-muted">by {r.handledBy.name}</div>}
                    </td>
                    <td className="p-3">
                      {r.reason && <div>Customer: “{r.reason}”</div>}
                      {r.rejectionReason && <div className="text-muted">Rejected: {r.rejectionReason}</div>}
                      {r.blockers.length > 0 && (
                        <ul className="mt-1 list-disc pl-4 text-danger" aria-label="Blocked because">
                          {r.blockers.map((b) => <li key={b}>{b}</li>)}
                        </ul>
                      )}
                    </td>
                    <td className="p-3">
                      {r.status === 'PENDING' && (
                        <div className="flex flex-wrap gap-2">
                          {r.type === 'DELETION' && (
                            <Button size="sm" disabled={r.blockers.length > 0} onClick={() => setAction({ kind: 'approve', row: r })}>
                              Approve deletion
                            </Button>
                          )}
                          <Button size="sm" variant="outline" onClick={() => setAction({ kind: 'reject', row: r })}>
                            Reject
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span>{result.total} requests · page {result.page}</span>
            <div className="flex gap-2">
              <Button variant="outline" disabled={page <= 1} onClick={() => { setLoading(true); setPage((p) => p - 1); }}>Previous</Button>
              <Button variant="outline" disabled={page * result.limit >= result.total} onClick={() => { setLoading(true); setPage((p) => p + 1); }}>Next</Button>
            </div>
          </div>
        </>
      )}
      {!loading && !result?.items?.length && (
        <EmptyState title="No privacy requests" description="Requests matching these filters will appear here." />
      )}

      <DecisionDialog
        action={action}
        onClose={() => setAction(null)}
        onDone={async (text) => {
          setAction(null);
          setNotice(text);
          setLoading(true);
          await load();
        }}
      />
    </main>
  );
}

function DecisionDialog({ action, onClose, onDone }: Readonly<{ action: Action | null; onClose: () => void; onDone: (notice: string) => Promise<void> }>) {
  const api = useApi();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [shownFor, setShownFor] = useState<Action | null>(null);
  if (shownFor !== action) {
    setShownFor(action);
    setReason('');
    setError('');
  }

  const submit = async () => {
    if (!action) return;
    const id = action.row.id;
    setError('');
    if (action.kind === 'reject' && reason.trim().length < 5) return setError('Give the customer a reason (at least 5 characters)');
    setBusy(true);
    try {
      if (action.kind === 'approve') {
        await api.call((c) => c.POST('/api/admin/privacy/requests/{id}/approve', { params: { path: { id } } }));
        await onDone('The account was deleted (anonymised). The customer has been told.');
      } else {
        await api.call((c) => c.POST('/api/admin/privacy/requests/{id}/reject', { params: { path: { id } }, body: { reason: reason.trim() } }));
        await onDone('The request was rejected. The customer has been told why.');
      }
    } catch (err) {
      setError(message(err, 'Could not save your decision'));
    } finally {
      setBusy(false);
    }
  };

  const approving = action?.kind === 'approve';
  let submitLabel = 'Reject request';
  if (approving) submitLabel = 'Delete account';
  if (busy) submitLabel = 'Saving…';
  return (
    <Dialog
      open={!!action}
      onClose={() => !busy && onClose()}
      title={approving ? 'Delete this account?' : 'Reject this request?'}
      description={action ? `${action.row.user.name} · ${DATA_REQUEST_TYPE_LABEL[action.row.type]}` : undefined}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy} className={approving ? 'bg-danger text-white hover:bg-danger/90' : undefined}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <Notice tone="error">{error}</Notice>}
        {approving ? (
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
            <li>Name, email, mobile, address, PAN, business details and uploaded documents are removed.</li>
            <li>All sessions end and the customer can never sign in again.</li>
            <li>Invoices, payments, credit notes and certificates are kept unchanged (GST records).</li>
            <li>This cannot be undone.</li>
          </ul>
        ) : (
          <TextArea id="privacy-reject-reason" label="Reason (the customer sees this)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        )}
      </div>
    </Dialog>
  );
}
