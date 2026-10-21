'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { CertificationBodyRow } from '@biznexa/types';
import { Button, Field, Notice, Select } from '@biznexa/ui';
import { useApi } from '@biznexa/api-client/react';
import { NotAllowed } from '@/components/portal-shell';
import { useAuth } from '@/lib/auth';
import { canSee, findNavItem } from '@/lib/nav';

export function CertificateCreateView() {
  const { user } = useAuth();
  const item = findNavItem('certificates');
  if (!user || !item) return null;
  if (!canSee(item, user.permissions)) return <NotAllowed />;
  return <CertificateForm />;
}

export type CertificateCreateDraft = {
  certificateNumber: string;
  type: string;
  organizationName: string;
  scope: string;
  address: string;
  issueDate: string;
  validFrom: string;
  validUntil: string;
  certificationBodyId: string;
  showPdfPublicly: boolean;
  fileId?: string;
  applicationId?: string;
  businessEntityId?: string;
};

export function validateCertificateCreate(draft: CertificateCreateDraft): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!draft.type.trim()) errors.type = 'Enter certificate type';
  if (!draft.organizationName.trim()) errors.organizationName = 'Enter organisation name';
  if (!draft.issueDate) errors.issueDate = 'Select issue date';
  if (!draft.validFrom) errors.validFrom = 'Select valid from date';
  if (!draft.validUntil) errors.validUntil = 'Select valid until date';
  if (draft.validFrom && draft.validUntil && draft.validUntil <= draft.validFrom) {
    errors.validUntil = 'Valid until must be after valid from date';
  }
  if (!draft.certificationBodyId) errors.certificationBodyId = 'Select a certification body';
  return errors;
}

function CertificateForm() {
  const api = useApi();
  const router = useRouter();
  const searchParams = useSearchParams();
  const applicationIdParam = searchParams?.get('applicationId') || '';
  const organizationNameParam = searchParams?.get('organizationName') || '';
  const entityIdParam = searchParams?.get('entityId') || searchParams?.get('businessEntityId') || '';

  const [bodies, setBodies] = useState<CertificationBodyRow[]>([]);
  const [loadError, setLoadError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState('');
  const [uploadingPdf, setUploadingPdf] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState('');
  const [uploadError, setUploadError] = useState('');

  const todayStr = new Date().toISOString().slice(0, 10);
  const threeYears = new Date();
  threeYears.setFullYear(threeYears.getFullYear() + 3);
  const threeYearsStr = threeYears.toISOString().slice(0, 10);

  const [draft, setDraft] = useState<CertificateCreateDraft>({
    certificateNumber: '',
    type: 'ISO 9001:2015 — Quality Management System',
    organizationName: organizationNameParam,
    scope: '',
    address: '',
    issueDate: todayStr,
    validFrom: todayStr,
    validUntil: threeYearsStr,
    certificationBodyId: '',
    showPdfPublicly: false,
    fileId: undefined,
    applicationId: applicationIdParam || undefined,
    businessEntityId: entityIdParam || undefined,
  });

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    try {
      setUploadingPdf(true);
      setUploadError('');
      const res = await fetch('/api/files', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || 'File upload failed');
      }
      const uploaded = await res.json();
      setDraft((d) => ({ ...d, fileId: uploaded.id }));
      setUploadedFileName(file.name);
    } catch (err: unknown) {
      setUploadError((err as Error).message);
    } finally {
      setUploadingPdf(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    api
      .call((c) => c.GET('/api/admin/certificates/bodies'))
      .then(
        (list) => {
          if (cancelled) return;
          setBodies(list);
          if (list.length > 0) setDraft((d) => ({ ...d, certificationBodyId: d.certificationBodyId || list[0].id }));
        },
        (err: Error) => !cancelled && setLoadError(err.message),
      );
    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(() => {
    if (!applicationIdParam) return;
    let cancelled = false;
    api
      .call((c) => c.GET('/api/admin/applications/{id}', { params: { path: { id: applicationIdParam } } }))
      .then((app) => {
        if (cancelled || !app) return;
        const appDetail = app as import('@biznexa/types').AdminApplicationDetail;
        const orgName = appDetail.businessEntity?.legalName || appDetail.customer?.name || '';
        const bId = appDetail.businessEntity?.id || undefined;
        setDraft((d) => ({
          ...d,
          organizationName: d.organizationName || orgName,
          businessEntityId: d.businessEntityId || bId,
          applicationId: applicationIdParam,
        }));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [api, applicationIdParam]);

  const handleSubmit = async (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSubmitError('');
    const formErrs = validateCertificateCreate(draft);
    if (Object.keys(formErrs).length > 0) return setErrors(formErrs);

    setSubmitting(true);
    try {
      const created = await api.call<{ id: string }>((c) =>
        c.POST('/api/admin/certificates', {
          body: {
            certificateNumber: draft.certificateNumber.trim() || undefined,
            type: draft.type.trim(),
            organizationName: draft.organizationName.trim(),
            scope: draft.scope.trim() || undefined,
            address: draft.address.trim() || undefined,
            issueDate: new Date(draft.issueDate).toISOString(),
            validFrom: new Date(draft.validFrom).toISOString(),
            validUntil: new Date(draft.validUntil).toISOString(),
            certificationBodyId: draft.certificationBodyId,
            showPdfPublicly: draft.showPdfPublicly,
            fileId: draft.fileId || undefined,
            applicationId: draft.applicationId || undefined,
            businessEntityId: draft.businessEntityId || undefined,
          },
        }),
      );
      if (created) {
        router.push(`/certificates/${created.id}`);
      }
    } catch (err: unknown) {
      const error = err as { message?: string; errors?: { field: string; message: string }[] };
      if (error.errors && error.errors.length > 0) {
        setErrors(Object.fromEntries(error.errors.map((f) => [f.field, f.message])));
      } else {
        setSubmitError(error.message ?? 'Could not create certificate');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-[700px]">
      <div className="flex items-center gap-2 text-sm text-muted">
        <Link href="/certificates" className="hover:underline">
          Certificates
        </Link>
        <span>/</span>
        <span>Issue certificate</span>
      </div>

      <h1 className="mt-2 text-2xl font-bold tracking-[-0.02em]">Issue new certificate</h1>
      <p className="mt-1 text-muted">Record an issued certificate to enable online QR and number verification.</p>

      {draft.applicationId && (
        <div className="mt-4">
          <Notice tone="info">
            Issuing certificate for application <strong>{draft.applicationId}</strong>.
          </Notice>
        </div>
      )}

      {loadError && (
        <div className="mt-4">
          <Notice tone="error">{loadError}</Notice>
        </div>
      )}

      {submitError && (
        <div className="mt-4">
          <Notice tone="error">{submitError}</Notice>
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-6 space-y-4 rounded-lg border border-rule bg-white p-6" noValidate>
        <Field
          id="cert-number"
          label="Certificate number (optional)"
          placeholder="Leave blank to auto-generate (BNC-2026-000001)"
          value={draft.certificateNumber}
          onChange={(e) => setDraft((d) => ({ ...d, certificateNumber: e.target.value }))}
          error={errors.certificateNumber}
        />

        <Field
          id="cert-type"
          label="Certificate type / standard"
          required
          placeholder="e.g. ISO 9001:2015 — Quality Management System"
          value={draft.type}
          onChange={(e) => setDraft((d) => ({ ...d, type: e.target.value }))}
          error={errors.type}
        />

        <Field
          id="cert-org"
          label="Organisation name"
          required
          placeholder="Legal entity or business name"
          value={draft.organizationName}
          onChange={(e) => setDraft((d) => ({ ...d, organizationName: e.target.value }))}
          error={errors.organizationName}
        />

        <Select
          id="cert-body"
          label="Certification body"
          required
          value={draft.certificationBodyId}
          onChange={(e) => setDraft((d) => ({ ...d, certificationBodyId: e.target.value }))}
          error={errors.certificationBodyId}
        >
          {bodies.length === 0 ? (
            <option value="">No certification bodies available</option>
          ) : (
            bodies.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} {b.accreditation ? `(${b.accreditation})` : ''}
              </option>
            ))
          )}
        </Select>

        <Field
          id="cert-scope"
          label="Scope of certification (optional)"
          value={draft.scope}
          onChange={(e) => setDraft((d) => ({ ...d, scope: e.target.value }))}
          error={errors.scope}
        />

        <Field
          id="cert-address"
          label="Organisation address (optional)"
          value={draft.address}
          onChange={(e) => setDraft((d) => ({ ...d, address: e.target.value }))}
          error={errors.address}
        />

        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            id="cert-issue-date"
            label="Issue date"
            type="date"
            required
            value={draft.issueDate}
            onChange={(e) => setDraft((d) => ({ ...d, issueDate: e.target.value }))}
            error={errors.issueDate}
          />
          <Field
            id="cert-valid-from"
            label="Valid from"
            type="date"
            required
            value={draft.validFrom}
            onChange={(e) => setDraft((d) => ({ ...d, validFrom: e.target.value }))}
            error={errors.validFrom}
          />
          <Field
            id="cert-valid-until"
            label="Valid until"
            type="date"
            required
            value={draft.validUntil}
            onChange={(e) => setDraft((d) => ({ ...d, validUntil: e.target.value }))}
            error={errors.validUntil}
          />
        </div>

        <div className="rounded-md border border-dashed border-rule p-4">
          <label htmlFor="custom-certificate-upload" className="block text-sm font-medium text-night mb-1">Upload custom PDF certificate (optional)</label>
          <p className="text-xs text-muted mb-2">If left blank, BizNexa will automatically generate an official PDF certificate with embedded QR code.</p>
          <input
            id="custom-certificate-upload"
            type="file"
            accept="application/pdf"
            disabled={uploadingPdf}
            onChange={handleFileUpload}
            className="block w-full text-xs text-muted file:mr-2 file:rounded file:border file:border-rule file:bg-paper file:px-2.5 file:py-1 file:text-xs file:font-medium file:text-night hover:file:bg-white"
          />
          {uploadingPdf && <p className="mt-1 text-xs text-muted">Uploading PDF…</p>}
          {uploadedFileName && <p className="mt-1 text-xs text-seal font-medium">✓ Uploaded: {uploadedFileName}</p>}
          {uploadError && <p className="mt-1 text-xs text-danger">{uploadError}</p>}
        </div>

        <div className="pt-2">
          <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={draft.showPdfPublicly}
              onChange={(e) => setDraft((d) => ({ ...d, showPdfPublicly: e.target.checked }))}
              className="h-4 w-4 rounded border-rule text-ink focus:ring-ink"
            />
            {' '}Allow public PDF download on verification page
          </label>
        </div>

        <div className="flex justify-end gap-3 border-t border-rule pt-4">
          <Link
            href="/certificates"
            className="inline-flex items-center rounded-md border border-rule bg-white px-4 py-2 text-sm font-medium text-night hover:bg-paper"
          >
            Cancel
          </Link>
          <Button type="submit" variant="ink" disabled={submitting}>
            {submitting ? 'Issuing certificate…' : 'Issue certificate'}
          </Button>
        </div>
      </form>
    </div>
  );
}
