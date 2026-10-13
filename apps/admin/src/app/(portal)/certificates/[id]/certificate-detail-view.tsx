'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { formatDate, type AdminCertificateRow, type CertificateStatus } from '@biznexa/types';
import { Badge, Button, Field, Notice, Select, useToast, type Tone } from '@biznexa/ui';
import { useApi } from '@biznexa/api-client/react';
import { NotAllowed } from '@/components/portal-shell';
import { useAuth } from '@/lib/auth';
import { canSee, findNavItem } from '@/lib/nav';

export function CertificateDetailView({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useAuth();
  const item = findNavItem('certificates');
  if (!user || !item) return null;
  if (!canSee(item, user.permissions)) return <NotAllowed />;
  return <CertificateDetail id={id} />;
}

const STATUS: Record<CertificateStatus, { label: string; tone: Tone }> = {
  ACTIVE: { label: 'Active', tone: 'success' },
  SUSPENDED: { label: 'Suspended', tone: 'warning' },
  WITHDRAWN: { label: 'Withdrawn', tone: 'danger' },
  EXPIRED: { label: 'Expired', tone: 'neutral' },
};

export function validateStatusChange(input: { status: CertificateStatus; reason: string }): string | null {
  if (!input.reason || !input.reason.trim()) {
    return 'Reason for status change is required';
  }
  if (input.reason.trim().length < 3) {
    return 'Reason must be at least 3 characters';
  }
  return null;
}

type LookupRow = {
  id: string;
  query: string;
  method: string;
  found: boolean;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
};

function CertificateDetail({ id }: { id: string }) {
  const api = useApi();
  const toast = useToast();
  const [cert, setCert] = useState<AdminCertificateRow | null>(null);
  const [qr, setQr] = useState<{ url: string; dataUrl: string } | null>(null);
  const [lookups, setLookups] = useState<LookupRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [newStatus, setNewStatus] = useState<CertificateStatus>('ACTIVE');
  const [reason, setReason] = useState('');
  const [statusError, setStatusError] = useState<string | null>(null);
  const [changingStatus, setChangingStatus] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const path = { params: { path: { id } } };
        const [c, q, l] = await Promise.all([
          api.call<AdminCertificateRow>((client) => client.GET('/api/admin/certificates/{id}', path)),
          api.call<{ url: string; dataUrl: string }>((client) => client.GET('/api/admin/certificates/{id}/qr', path)),
          api.call<LookupRow[]>((client) => client.GET('/api/admin/certificates/{id}/lookups', path)),
        ]);
        if (cancelled) return;
        setCert(c);
        setQr(q);
        setLookups(l);
        setNewStatus(c.status);
        setLoadError(null);
      } catch (err: unknown) {
        if (!cancelled) setLoadError((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, id]);

  const handleStatusSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusError(null);

    const err = validateStatusChange({ status: newStatus, reason });
    if (err) return setStatusError(err);

    if (cert && newStatus === cert.status) {
      return setStatusError('Select a different status');
    }

    setChangingStatus(true);
    try {
      const updated = await api.call<{ id: string; status: CertificateStatus; statusReason: string | null }>((client) =>
        client.PATCH('/api/admin/certificates/{id}/status', {
          params: { path: { id } },
          body: { status: newStatus, reason: reason.trim() },
        }),
      );
      if (updated) {
        setCert((c) => (c ? { ...c, status: updated.status, statusReason: updated.statusReason } : c));
        setReason('');
        toast(`Certificate status updated to ${updated.status}.`, 'success');
      }
    } catch (err: unknown) {
      setStatusError((err as Error).message);
    } finally {
      setChangingStatus(false);
    }
  };

  if (loadError) {
    return (
      <div className="max-w-[800px] space-y-4">
        <Notice tone="error">{loadError}</Notice>
        <Link
          href="/certificates"
          className="inline-flex items-center rounded-md border border-rule bg-white px-3 py-2 text-sm font-medium text-night hover:bg-paper"
        >
          Back to certificates
        </Link>
      </div>
    );
  }

  if (!cert) {
    return (
      <p className="text-muted" role="status">
        Loading certificate details…
      </p>
    );
  }

  return (
    <div className="max-w-[1000px] space-y-8">
      <div className="flex items-center justify-between gap-4 border-b border-rule pb-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-mono text-2xl font-bold tracking-[-0.02em]">{cert.certificateNumber}</h1>
            <Badge tone={STATUS[cert.status].tone}>{STATUS[cert.status].label}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted">Verification ID: {cert.verificationId}</p>
        </div>
        <Link
          href="/certificates"
          className="inline-flex items-center rounded-md border border-rule bg-white px-3 py-2 text-sm font-medium text-night hover:bg-paper"
        >
          Back to list
        </Link>
      </div>

      <div className="grid gap-6 md:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <section className="rounded-lg border border-rule bg-white p-6">
            <h2 className="text-lg font-semibold text-night">Certificate Information</h2>
            <dl className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-medium text-muted">Organisation</dt>
                <dd className="mt-0.5 text-base font-medium text-night">{cert.organizationName}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted">Certification Body</dt>
                <dd className="mt-0.5 text-base font-medium text-night">{cert.certificationBody.name}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs font-medium text-muted">Standard / Type</dt>
                <dd className="mt-0.5 text-sm text-night">{cert.type}</dd>
              </div>
              {cert.scope && (
                <div className="sm:col-span-2">
                  <dt className="text-xs font-medium text-muted">Scope</dt>
                  <dd className="mt-0.5 text-sm text-night">{cert.scope}</dd>
                </div>
              )}
              {cert.address && (
                <div className="sm:col-span-2">
                  <dt className="text-xs font-medium text-muted">Address</dt>
                  <dd className="mt-0.5 text-sm text-night">{cert.address}</dd>
                </div>
              )}
              <div>
                <dt className="text-xs font-medium text-muted">Issue Date</dt>
                <dd className="mt-0.5 text-sm text-night">{formatDate(cert.issueDate)}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted">Validity Period</dt>
                <dd className="mt-0.5 text-sm text-night">
                  {formatDate(cert.validFrom)} – {formatDate(cert.validUntil)}
                </dd>
              </div>
            </dl>
            {cert.statusReason && (
              <div className="mt-4 rounded-md bg-paper p-3 text-sm">
                <p className="font-semibold text-night">Status Note</p>
                <p className="mt-0.5 text-muted">{cert.statusReason}</p>
              </div>
            )}
          </section>

          <section className="rounded-lg border border-rule bg-white p-6">
            <h2 className="text-lg font-semibold text-night">Update Certificate Status</h2>
            <form onSubmit={handleStatusSubmit} className="mt-4 space-y-4" noValidate>
              <Select
                id="status-select"
                label="New Status"
                value={newStatus}
                onChange={(e) => setNewStatus(e.target.value as CertificateStatus)}
              >
                <option value="ACTIVE">Active</option>
                <option value="SUSPENDED">Suspended</option>
                <option value="WITHDRAWN">Withdrawn</option>
                <option value="EXPIRED">Expired</option>
              </Select>

              <Field
                id="status-reason"
                label="Reason for change"
                required
                placeholder="State why this status is being changed (audit logged)"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                error={statusError ?? undefined}
              />

              <Button type="submit" variant="ink" disabled={changingStatus}>
                {changingStatus ? 'Updating status…' : 'Update status'}
              </Button>
            </form>
          </section>
        </div>

        <aside className="space-y-6">
          {qr && (
            <section className="rounded-lg border border-rule bg-white p-6 text-center">
              <h2 className="text-sm font-semibold text-night">QR Verification</h2>
              <div className="mt-4 flex justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qr.dataUrl} alt="Verification QR Code" className="h-48 w-48 rounded border border-rule" />
              </div>
              <p className="mt-2 text-xs text-muted">Scans link directly to public verification page.</p>
              <a
                href={qr.url}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-block text-xs font-medium text-ink underline hover:no-underline"
              >
                Open public verification link
              </a>
            </section>
          )}

          <section className="rounded-lg border border-rule bg-white p-6">
            <h2 className="text-sm font-semibold text-night">Verification Stats</h2>
            <p className="mt-2 text-3xl font-bold text-night">{cert._count.lookups}</p>
            <p className="text-xs text-muted">Total verification lookups recorded.</p>
          </section>
        </aside>
      </div>

      <section className="rounded-lg border border-rule bg-white p-6">
        <h2 className="text-lg font-semibold text-night">Recent Verification Lookups</h2>
        {lookups.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No lookups recorded yet for this certificate.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-rule bg-paper text-xs uppercase text-muted">
                <tr>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Method</th>
                  <th className="px-3 py-2">Query</th>
                  <th className="px-3 py-2">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {lookups.map((l) => (
                  <tr key={l.id}>
                    <td className="px-3 py-2.5 text-muted">{formatDate(l.createdAt)}</td>
                    <td className="px-3 py-2.5 font-medium">{l.method}</td>
                    <td className="px-3 py-2.5 font-mono text-xs">{l.query}</td>
                    <td className="px-3 py-2.5">
                      <Badge tone={l.found ? 'success' : 'danger'}>{l.found ? 'Found' : 'Not found'}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
