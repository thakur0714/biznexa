'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  DATA_EXPORT_TTL_DAYS,
  DATA_REQUEST_STATUS_LABEL,
  DATA_REQUEST_TYPE_LABEL,
  type DataRequest,
  type DataRequestList,
  type DataRequestStatus,
  type PrivacyOtpResponse,
} from '@biznexa/types';
import { Badge, Button, Checkbox, Dialog, Field, Notice, TextArea, type Tone } from '@biznexa/ui';
import { useApi } from '@biznexa/api-client/react';
import { Icon } from '@/components/icons';

const STATUS_TONE: Record<DataRequestStatus, Tone> = {
  PENDING: 'warning',
  PROCESSING: 'info',
  COMPLETED: 'success',
  REJECTED: 'danger',
};

const isOpen = (r: DataRequest) => r.status === 'PENDING' || r.status === 'PROCESSING';
const message = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);
const formatDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

/** Customer Privacy page (DPDP Act 2023, M5.12): download my data, delete my account, past requests. */
export function PrivacyView() {
  const api = useApi();
  const [data, setData] = useState<DataRequestList | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteNotice, setDeleteNotice] = useState<string | null>(null);

  const load = useCallback(
    () =>
      api.call((c) => c.GET('/api/privacy/requests')).then(
        (res) => {
          setData(res);
          setLoadError(null);
        },
        (err: unknown) => setLoadError(message(err, 'Could not load your privacy requests')),
      ),
    [api],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const requestExport = async () => {
    setExporting(true);
    setExportNotice(null);
    try {
      await api.call((c) => c.POST('/api/privacy/requests', { body: { type: 'EXPORT' } }));
      setExportNotice({ tone: 'success', text: 'We are preparing your file. We will notify you when it is ready to download.' });
      await load();
    } catch (err) {
      setExportNotice({ tone: 'error', text: message(err, 'Could not start your data export') });
    } finally {
      setExporting(false);
    }
  };

  const download = async (id: string) => {
    setExportNotice(null);
    try {
      const link = await api.call((c) => c.POST('/api/privacy/requests/{id}/link', { params: { path: { id } } }));
      window.location.assign(link.url);
    } catch (err) {
      setExportNotice({ tone: 'error', text: message(err, 'Could not start the download') });
      await load();
    }
  };

  if (loadError && !data) return <Notice tone="error">{loadError}</Notice>;
  if (!data) return <div className="py-10 text-center text-sm text-muted">Loading…</div>;

  const openExport = data.items.find((r) => r.type === 'EXPORT' && isOpen(r));
  const ready = data.items.find((r) => r.type === 'EXPORT' && r.downloadable);
  let exportButtonLabel = 'Download my data';
  if (ready) exportButtonLabel = 'Prepare a new copy';
  if (exporting) exportButtonLabel = 'Requesting…';
  if (openExport) exportButtonLabel = 'Preparing your file…';
  const openDeletion = data.items.find((r) => r.type === 'DELETION' && isOpen(r));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-night">Privacy &amp; your data</h1>
        <p className="mt-1 text-sm text-muted">
          Under the Digital Personal Data Protection Act, 2023 you can get a copy of your data or ask us to delete your account.
        </p>
      </div>

      <section className="rounded-xl border border-rule bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-xl">
            <h2 className="text-lg font-semibold text-night">Download my data</h2>
            <p className="mt-1 text-sm text-muted">
              A ZIP file with your profile, businesses, applications, document list, orders, payments, invoices, credit notes, messages,
              tickets, bookings and notifications. The download stays available for {DATA_EXPORT_TTL_DAYS} days.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:items-end">
            {ready && (
              <Button type="button" onClick={() => download(ready.id)}>
                <Icon name="download" size={16} />
                <span>Download ZIP</span>
              </Button>
            )}
            <Button type="button" variant="outline" onClick={requestExport} disabled={exporting || !!openExport}>
              {!ready && <Icon name="download" size={16} />}
              <span>{exportButtonLabel}</span>
            </Button>
          </div>
        </div>
        {ready?.expiresAt && <p className="mt-3 text-xs text-muted">Your file is ready. It can be downloaded until {formatDate(ready.expiresAt)}.</p>}
        {exportNotice && (
          <div className="mt-4">
            <Notice tone={exportNotice.tone}>{exportNotice.text}</Notice>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-rule bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-xl">
            <h2 className="text-lg font-semibold text-night">Delete my account</h2>
            <p className="mt-1 text-sm text-muted">
              Your personal details are removed and you will no longer be able to sign in. Invoices, payments, credit notes and
              certificates are kept, as the law requires (GST records). Our team reviews every request.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => setDeleteOpen(true)}
            disabled={!!openDeletion}
            className="text-danger hover:border-danger hover:bg-danger/5"
          >
            <Icon name="lock" size={16} />
            <span>{openDeletion ? 'Deletion requested' : 'Delete my account'}</span>
          </Button>
        </div>
        {(deleteNotice || openDeletion) && (
          <div className="mt-4">
            <Notice tone="info">{deleteNotice ?? 'Your account deletion request is being reviewed. We will let you know the outcome.'}</Notice>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-rule bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-night">Your requests</h2>
        {data.items.length === 0 ? (
          <p className="mt-3 text-sm text-muted">You have not made any requests yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-rule">
            {data.items.map((r) => (
              <li key={r.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium text-night">{DATA_REQUEST_TYPE_LABEL[r.type]}</p>
                  <p className="text-xs text-muted">
                    Requested {formatDate(r.createdAt)}
                    {r.rejectionReason && <> · Reason: {r.rejectionReason}</>}
                  </p>
                </div>
                <Badge tone={STATUS_TONE[r.status]}>{DATA_REQUEST_STATUS_LABEL[r.status]}</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      <DeleteAccountDialog
        open={deleteOpen}
        reauth={data.reauth}
        onClose={() => setDeleteOpen(false)}
        onDone={async () => {
          setDeleteOpen(false);
          setDeleteNotice('Your request has been received. Our team will review it and let you know.');
          await load();
        }}
      />
    </div>
  );
}

function DeleteAccountDialog({
  open,
  reauth,
  onClose,
  onDone,
}: Readonly<{
  open: boolean;
  reauth: DataRequestList['reauth'];
  onClose: () => void;
  onDone: () => Promise<void>;
}>) {
  const api = useApi();
  const [method, setMethod] = useState<'password' | 'otp'>(reauth.password ? 'password' : 'otp');
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [sent, setSent] = useState<PrivacyOtpResponse | null>(null);
  const devCodeHint = sent?.devCode ? ` (dev: ${sent.devCode})` : '';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendCode = async () => {
    setBusy(true);
    setError(null);
    try {
      setSent(await api.call((c) => c.POST('/api/privacy/otp')));
    } catch (err) {
      setError(message(err, 'Could not send the code'));
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    setError(null);
    if (!confirmed) return setError('Please confirm you understand what will be deleted');
    if (method === 'password' && !password) return setError('Enter your password');
    if (method === 'otp' && !/^\d{6}$/.test(otp)) return setError('Enter the 6-digit code');
    setBusy(true);
    try {
      await api.call((c) =>
        c.POST('/api/privacy/requests', {
          body: {
            type: 'DELETION',
            confirm: true,
            reason: reason.trim() || undefined,
            ...(method === 'password' ? { password } : { otp }),
          },
        }),
      );
      setPassword('');
      setOtp('');
      await onDone();
    } catch (err) {
      setError(message(err, 'Could not send your request'));
    } finally {
      setBusy(false);
    }
  };

  const canSwitch = reauth.password && reauth.otpChannel;

  return (
    <Dialog
      open={open}
      onClose={() => !busy && onClose()}
      title="Delete your account?"
      description="Once our team approves it, this cannot be undone."
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={busy} className="bg-danger text-white hover:bg-danger/90">
            {busy ? 'Please wait…' : 'Request deletion'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Notice tone="error">{error}</Notice>}
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
          <li>Your name, email, mobile, address, PAN and uploaded documents are removed.</li>
          <li>You are signed out everywhere and cannot sign in again.</li>
          <li>Invoices, payments, credit notes and certificates are kept for legal reasons.</li>
          <li>We cannot delete an account while a service is in progress, a balance is due or a consultation is coming up.</li>
        </ul>
        <TextArea id="delete-reason" label="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />

        {method === 'password' ? (
          <Field id="delete-password" label="Your password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        ) : (
          <div className="space-y-2">
            {sent ? (
              <Field
                id="delete-otp"
                label="Code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replaceAll(/\D/g, ''))}
                hint={`We sent a 6-digit code to ${sent.sentTo}${devCodeHint}`}
              />
            ) : (
              <Button type="button" variant="outline" onClick={sendCode} disabled={busy || !reauth.otpChannel}>
                Send me a code
              </Button>
            )}
          </div>
        )}
        {canSwitch && (
          <button type="button" className="text-sm font-medium text-ink underline" onClick={() => setMethod(method === 'password' ? 'otp' : 'password')}>
            {method === 'password' ? 'Use a one-time code instead' : 'Use my password instead'}
          </button>
        )}

        <Checkbox
          id="delete-confirm"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          label="I understand that my account will be permanently deleted"
        />
      </div>
    </Dialog>
  );
}
