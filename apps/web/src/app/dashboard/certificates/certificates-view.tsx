'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { formatDate, type CustomerCertificateRow } from '@biznexa/types';
import { Badge, Button, EmptyState, LinkButton, Notice, type Tone } from '@biznexa/ui';
import { Icon } from '@/components/icons';
import { useApi } from '@biznexa/api-client/react';

const STATUS_CONFIG: Record<string, { label: string; tone: Tone }> = {
  ACTIVE: { label: 'Active', tone: 'success' },
  SUSPENDED: { label: 'Suspended', tone: 'warning' },
  WITHDRAWN: { label: 'Withdrawn', tone: 'danger' },
  EXPIRED: { label: 'Expired', tone: 'neutral' },
};

export function CustomerCertificatesView() {
  const api = useApi();
  const [certs, setCerts] = useState<CustomerCertificateRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'EXPIRING' | 'EXPIRED'>('ALL');
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<{ id: string; message: string } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [activeQrModal, setActiveQrModal] = useState<CustomerCertificateRow | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .call<{ items: CustomerCertificateRow[]; total: number }>((c) =>
        c.GET('/api/certificates'),
      )
      .then(
        (res) => {
          if (!cancelled) {
            setCerts(res.items);
            setError(null);
            setLoading(false);
          }
        },
        (err: Error) => {
          if (!cancelled) {
            setError(err.message || 'Failed to load your certificates');
            setLoading(false);
          }
        },
      );
    return () => {
      cancelled = true;
    };
  }, [api]);

  const counts = useMemo(() => {
    if (!certs) return { total: 0, active: 0, expiring: 0, expired: 0 };
    return {
      total: certs.length,
      active: certs.filter((c) => c.effectiveStatus === 'ACTIVE').length,
      expiring: certs.filter((c) => c.isExpiringSoon || (c.effectiveStatus === 'ACTIVE' && c.daysUntilExpiry <= 30 && c.daysUntilExpiry > 0)).length,
      expired: certs.filter((c) => c.effectiveStatus === 'EXPIRED').length,
    };
  }, [certs]);

  const filtered = useMemo(() => {
    if (!certs) return [];
    return certs.filter((c) => {
      if (statusFilter === 'ACTIVE' && c.effectiveStatus !== 'ACTIVE') return false;
      if (statusFilter === 'EXPIRING' && !(c.isExpiringSoon || (c.effectiveStatus === 'ACTIVE' && c.daysUntilExpiry <= 30 && c.daysUntilExpiry > 0))) return false;
      if (statusFilter === 'EXPIRED' && c.effectiveStatus !== 'EXPIRED') return false;

      if (query.trim()) {
        const q = query.toLowerCase();
        const matchesNum = c.certificateNumber.toLowerCase().includes(q);
        const matchesOrg = c.organizationName.toLowerCase().includes(q);
        const matchesType = c.type.toLowerCase().includes(q);
        const matchesId = c.verificationId.toLowerCase().includes(q);
        return matchesNum || matchesOrg || matchesType || matchesId;
      }
      return true;
    });
  }, [certs, statusFilter, query]);

  const handleDownloadPdf = async (cert: CustomerCertificateRow) => {
    setDownloadingId(cert.id);
    setDownloadError(null);
    try {
      const res = await api.call((c) =>
        c.POST('/api/certificates/{id}/link', {
          params: { path: { id: cert.id } },
        }),
      );
      if (res?.url) {
        window.open(res.url, '_blank');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unable to download certificate PDF. Please try again.';
      setDownloadError({ id: cert.id, message: msg });
    } finally {
      setDownloadingId(null);
    }
  };

  const handleCopyLink = async (cert: CustomerCertificateRow) => {
    const url = cert.qrUrl || `${window.location.origin}/verify/${cert.verificationId}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(cert.id);
      setTimeout(() => setCopiedId(null), 2500);
    } catch {
      // Fallback
      setCopiedId(null);
    }
  };

  const handleShare = async (cert: CustomerCertificateRow) => {
    const url = cert.qrUrl || `${window.location.origin}/verify/${cert.verificationId}`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: `${cert.type} Certificate — ${cert.organizationName}`,
          text: `Official verified ${cert.type} certificate for ${cert.organizationName}`,
          url,
        });
      } catch {
        // Ignored if cancelled
      }
    } else {
      await handleCopyLink(cert);
    }
  };

  return (
    <div className="mx-auto max-w-[1000px] min-w-0 px-4 py-8 sm:px-6">
      <div className="mb-6">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink transition-colors"
        >
          <span aria-hidden="true">&larr;</span> Back to dashboard
        </Link>
      </div>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-[-0.025em]">My Certificates</h1>
          <p className="mt-1 text-sm text-muted">
            View, download official PDFs, copy verification links, and renew expiring compliance certificates.
          </p>
        </div>
        <LinkButton href="/services" variant="primary">
          Explore Certifications
        </LinkButton>
      </div>

      {error && (
        <div className="mb-6">
          <Notice tone="error">{error}</Notice>
        </div>
      )}

      {/* KPI Counters */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <button
          type="button"
          onClick={() => setStatusFilter('ALL')}
          className={`rounded-lg border p-4 text-left transition ${
            statusFilter === 'ALL' ? 'border-ink bg-paper ring-1 ring-ink' : 'border-rule bg-white hover:bg-paper/50'
          }`}
        >
          <p className="text-xs font-medium text-muted uppercase tracking-wider">Total</p>
          <p className="mt-1 text-2xl font-bold text-night">{counts.total}</p>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter('ACTIVE')}
          className={`rounded-lg border p-4 text-left transition ${
            statusFilter === 'ACTIVE'
              ? 'border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500'
              : 'border-rule bg-white hover:bg-paper/50'
          }`}
        >
          <p className="text-xs font-medium text-emerald-700 uppercase tracking-wider">Active</p>
          <p className="mt-1 text-2xl font-bold text-emerald-800">{counts.active}</p>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter('EXPIRING')}
          className={`rounded-lg border p-4 text-left transition ${
            statusFilter === 'EXPIRING'
              ? 'border-amber-500 bg-amber-50 ring-1 ring-amber-500'
              : 'border-rule bg-white hover:bg-paper/50'
          }`}
        >
          <p className="text-xs font-medium text-amber-700 uppercase tracking-wider">Expiring Soon</p>
          <p className="mt-1 text-2xl font-bold text-amber-800">{counts.expiring}</p>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter('EXPIRED')}
          className={`rounded-lg border p-4 text-left transition ${
            statusFilter === 'EXPIRED'
              ? 'border-slate-500 bg-slate-50 ring-1 ring-slate-500'
              : 'border-rule bg-white hover:bg-paper/50'
          }`}
        >
          <p className="text-xs font-medium text-muted uppercase tracking-wider">Expired</p>
          <p className="mt-1 text-2xl font-bold text-muted">{counts.expired}</p>
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <input
            type="search"
            placeholder="Search by number, standard, or organisation…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-md border border-rule bg-white px-3 py-2 text-sm text-night placeholder:text-muted focus:border-ink focus:outline-none"
          />
        </div>
      </div>

      {/* Content list */}
      {loading ? (
        <div className="rounded-lg border border-rule bg-white p-12 text-center text-muted">
          <p className="text-sm">Loading your certificates…</p>
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          className="p-10 border border-rule bg-white rounded-lg"
          icon={<Icon name="badge" size={40} className="text-ink/40" />}
          title={certs && certs.length > 0 ? 'No matching certificates' : 'No certificates issued yet'}
          description={
            certs && certs.length > 0
              ? 'Try adjusting your search query or status filter.'
              : 'Once your ISO certifications or statutory registrations are approved, your official certificates with embedded QR and PDF verification will appear here.'
          }
          action={
            certs && certs.length > 0 ? (
              <Button
                variant="outline"
                onClick={() => {
                  setStatusFilter('ALL');
                  setQuery('');
                }}
              >
                Clear filters
              </Button>
            ) : (
              <LinkButton href="/services" variant="primary">
                Explore Certifications
              </LinkButton>
            )
          }
        />
      ) : (
        <div className="space-y-4">
          {filtered.map((cert) => {
            const statusCfg = STATUS_CONFIG[cert.effectiveStatus] || STATUS_CONFIG.ACTIVE;
            const needsRenewal = cert.isExpiringSoon || cert.effectiveStatus === 'EXPIRED' || cert.daysUntilExpiry <= 30;

            return (
              <div
                key={cert.id}
                className="overflow-hidden rounded-lg border border-rule bg-white shadow-xs transition hover:border-ink/30"
              >
                {/* Expiring alert banner if needed */}
                {needsRenewal && (
                  <div
                    className={`flex items-center justify-between gap-3 px-5 py-2 text-xs font-medium ${
                      cert.effectiveStatus === 'EXPIRED'
                        ? 'bg-red-50 text-red-800 border-b border-red-200'
                        : 'bg-amber-50 text-amber-900 border-b border-amber-200'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Icon name="alert" size={16} />
                      <span>
                        {cert.effectiveStatus === 'EXPIRED'
                          ? 'This certificate has expired. Renew now to maintain valid compliance credentials.'
                          : `Expires in ${cert.daysUntilExpiry} day${cert.daysUntilExpiry === 1 ? '' : 's'} (${formatDate(cert.validUntil)}).`}
                      </span>
                    </div>
                    <Link
                      href={`/services?renew=certificate&type=${encodeURIComponent(cert.type)}&org=${encodeURIComponent(cert.organizationName)}`}
                      className="inline-flex items-center gap-1 rounded bg-amber-800 px-2.5 py-1 text-white hover:bg-amber-900 transition font-semibold"
                    >
                      <Icon name="refresh" size={12} />
                      Renew Now
                    </Link>
                  </div>
                )}

                <div className="p-6">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-bold text-night">
                          {cert.certificateNumber}
                        </span>
                        <Badge tone={statusCfg.tone}>{statusCfg.label}</Badge>
                      </div>
                      <h2 className="mt-1 text-lg font-bold text-night">{cert.organizationName}</h2>
                      <p className="text-sm font-medium text-ink">{cert.type}</p>
                    </div>

                    {/* QR Code thumbnail */}
                    {cert.qrDataUrl && (
                      <button
                        type="button"
                        onClick={() => setActiveQrModal(cert)}
                        title="Click to expand QR Code"
                        className="group flex flex-col items-center rounded-md border border-rule bg-paper p-1.5 hover:border-ink/50 transition cursor-pointer"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={cert.qrDataUrl}
                          alt={`QR Code for ${cert.certificateNumber}`}
                          className="h-16 w-16"
                        />
                        <span className="mt-1 text-[10px] font-medium text-muted group-hover:text-ink">
                          View QR
                        </span>
                      </button>
                    )}
                  </div>

                  {cert.scope && (
                    <div className="mt-3 text-xs text-muted">
                      <strong className="text-night font-medium">Scope:</strong> {cert.scope}
                    </div>
                  )}

                  <div className="mt-4 grid grid-cols-1 gap-2 border-t border-rule/60 pt-4 text-xs text-muted sm:grid-cols-3">
                    <div>
                      <p className="font-medium text-night">Certification Body</p>
                      <p className="mt-0.5">{cert.certificationBody.name}</p>
                      {cert.certificationBody.accreditation && (
                        <p className="text-[11px] text-muted">{cert.certificationBody.accreditation}</p>
                      )}
                    </div>

                    <div>
                      <p className="font-medium text-night">Validity Period</p>
                      <p className="mt-0.5">
                        {formatDate(cert.validFrom)} – {formatDate(cert.validUntil)}
                      </p>
                    </div>

                    <div>
                      <p className="font-medium text-night">Public Verification ID</p>
                      <p className="mt-0.5 font-mono">{cert.verificationId}</p>
                    </div>
                  </div>

                  {downloadError?.id === cert.id && (
                    <div className="mt-3">
                      <Notice tone="error">{downloadError.message}</Notice>
                    </div>
                  )}

                  {/* Actions bar */}
                  <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-rule/60 pt-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="primary"
                        onClick={() => handleDownloadPdf(cert)}
                        disabled={downloadingId === cert.id}
                      >
                        <span className="flex items-center gap-1.5">
                          <Icon name="download" size={16} />
                          {downloadingId === cert.id ? 'Preparing PDF…' : 'Download PDF'}
                        </span>
                      </Button>

                      <Button
                        variant="outline"
                        onClick={() => handleCopyLink(cert)}
                      >
                        <span className="flex items-center gap-1.5">
                          <Icon name={copiedId === cert.id ? 'check' : 'copy'} size={15} />
                          {copiedId === cert.id ? 'Link Copied!' : 'Copy Verification Link'}
                        </span>
                      </Button>

                      <Button
                        variant="outline"
                        onClick={() => handleShare(cert)}
                      >
                        <span className="flex items-center gap-1.5">
                          <Icon name="share" size={15} />
                          Share
                        </span>
                      </Button>
                    </div>

                    {needsRenewal && (
                      <Link
                        href={`/services?renew=certificate&type=${encodeURIComponent(cert.type)}&org=${encodeURIComponent(cert.organizationName)}`}
                        className="inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-700 transition"
                      >
                        <Icon name="refresh" size={15} />
                        Renew Certificate
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* QR Code Modal */}
      {activeQrModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setActiveQrModal(null)}
        >
          <div
            className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-base font-bold text-night">Official QR Code</h3>
                <p className="text-xs text-muted">{activeQrModal.certificateNumber}</p>
              </div>
              <button
                type="button"
                onClick={() => setActiveQrModal(null)}
                className="text-muted hover:text-night p-1"
                aria-label="Close modal"
              >
                <Icon name="x" size={20} />
              </button>
            </div>

            <div className="my-6 flex flex-col items-center justify-center rounded-lg border border-rule bg-paper/50 p-4">
              {activeQrModal.qrDataUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={activeQrModal.qrDataUrl}
                  alt={`QR Code for ${activeQrModal.certificateNumber}`}
                  className="h-48 w-48 rounded"
                />
              )}
              <p className="mt-3 text-center text-xs text-muted">
                Scan to instantly verify credentials at{' '}
                <span className="font-mono text-night">{activeQrModal.verificationId}</span>
              </p>
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => handleCopyLink(activeQrModal)}
              >
                <span className="flex items-center justify-center gap-1.5">
                  <Icon name={copiedId === activeQrModal.id ? 'check' : 'copy'} size={15} />
                  {copiedId === activeQrModal.id ? 'Copied' : 'Copy Link'}
                </span>
              </Button>
              <Button
                variant="primary"
                className="flex-1"
                onClick={() => {
                  if (activeQrModal.qrDataUrl) {
                    const a = document.createElement('a');
                    a.href = activeQrModal.qrDataUrl;
                    a.download = `QR-${activeQrModal.certificateNumber}.png`;
                    a.click();
                  }
                }}
              >
                Download QR
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
