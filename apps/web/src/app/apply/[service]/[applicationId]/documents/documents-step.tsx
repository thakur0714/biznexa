'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  acceptAttribute,
  describeFileTypes,
  fileTypeFromName,
  formatDate,
  isKnownFileType,
  needsUpload,
  requirementFileTypes,
  type ApplicationDetail,
  type DocumentChecklist,
  type DocumentChecklistItem,
} from '@biznexa/types';
import { ClientApiError } from '@biznexa/api-client/browser';
import { useApi } from '@biznexa/api-client/react';
import { Badge, Breadcrumbs, Button, LinkButton, Notice, type Tone } from '@biznexa/ui';
import type { ServiceDetail } from '@/lib/api';

/** What the customer sees for an item's newest upload. */
function statusOf(item: DocumentChecklistItem): { label: string; tone: Tone } {
  const c = item.current;
  if (!c) return item.requirement.isMandatory ? { label: 'Required', tone: 'warning' } : { label: 'Optional', tone: 'neutral' };
  if (c.scanStatus === 'INFECTED') return { label: 'Virus found', tone: 'danger' };
  if (c.status === 'REJECTED') return { label: 'Rejected', tone: 'danger' };
  if (c.status === 'APPROVED') return { label: 'Approved', tone: 'success' };
  if (c.status === 'UNDER_REVIEW') return { label: 'Under review', tone: 'info' };
  return { label: 'Uploaded', tone: 'success' };
}

const sizeText = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

/**
 * The document step (M3.10). Lists the documents this package needs; each one uploads through the shared
 * upload endpoint with that document's rules and is then attached to the application. Replacing a file
 * adds a new version (earlier ones are kept). Mandatory documents can be skipped and uploaded later.
 * Continue (or skip) goes on to the order summary (M3.13).
 */
export function DocumentsStep({ service, applicationId }: { service: ServiceDetail; applicationId: string }) {
  const api = useApi();
  const router = useRouter();
  const [app, setApp] = useState<ApplicationDetail | null>(null);
  const [list, setList] = useState<DocumentChecklist | null>(null);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const path = { params: { path: { id: applicationId } } };
        const [detail, checklist] = await Promise.all([
          api.call<ApplicationDetail>((c) => c.GET('/api/applications/{id}', path)),
          api.call<DocumentChecklist>((c) => c.GET('/api/applications/{id}/documents', path)),
        ]);
        if (detail.serviceId !== service.id) throw new ClientApiError(404, 'Application not found');
        if (live) {
          setApp(detail);
          setList(checklist);
        }
      } catch (e) {
        if (live) setLoadError((e as ClientApiError).message);
      }
    })();
    return () => {
      live = false;
    };
  }, [api, applicationId, service.id]);

  const serviceHref = `/services/${service.category.slug}/${service.slug}`;
  const pending = list?.pendingMandatory ?? 0;

  return (
    <div className="mx-auto max-w-[760px] px-4 py-10 sm:px-6">
      <Breadcrumbs items={[{ href: serviceHref, label: service.name }, { href: `/apply/${service.slug}/${applicationId}`, label: 'Your details' }, { label: 'Documents' }]} />
      <h1 className="mt-4 text-3xl font-bold tracking-[-0.025em]">Documents</h1>
      {app && (
        <p className="mt-1 text-sm text-muted">
          {service.name} · Application <span className="num">{app.code}</span>
        </p>
      )}

      {loadError && (
        <div className="mt-6 space-y-4">
          <Notice tone="error">{loadError}</Notice>
          <LinkButton href={serviceHref} variant="outline">
            Back to {service.name}
          </LinkButton>
        </div>
      )}

      {!list && !loadError && <p className="mt-6 text-sm text-muted" role="status">Loading your document checklist…</p>}

      {list && (
        <>
          {!list.canUpload && (
            <div className="mt-6">
              <Notice tone="info">This application is past the document step, so its documents can’t be changed here.</Notice>
            </div>
          )}
          {list.items.length === 0 ? (
            <p className="mt-6 text-muted">This service needs no documents from you. Continue to the next step.</p>
          ) : (
            <>
              <p className="mt-4 text-muted">Upload clear scans or photos. You can skip any document now and upload it later from your dashboard.</p>
              <ul className="mt-6 space-y-4">
                {list.items.map((item) => (
                  <DocumentRow key={item.requirement.id} item={item} applicationId={applicationId} canUpload={list.canUpload} onChange={setList} />
                ))}
              </ul>
            </>
          )}

          <div className="mt-8 flex flex-col-reverse gap-3 border-t border-rule pt-6 sm:flex-row sm:items-center sm:justify-between">
            <LinkButton href={`/apply/${service.slug}/${applicationId}`} variant="ghost">
              Back to your details
            </LinkButton>
            <div className="flex flex-col gap-2 sm:items-end">
              {pending > 0 && (
                <p className="text-sm text-muted" aria-live="polite">
                  {pending === 1 ? '1 required document' : `${pending} required documents`} still to upload
                </p>
              )}
              <Button type="button" variant={pending > 0 ? 'outline' : 'primary'} onClick={() => router.push(`/apply/${service.slug}/${applicationId}/summary`)}>
                {pending > 0 ? 'Skip and upload later' : 'Continue'}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** One checklist item: status, the current file, and upload / replace. */
function DocumentRow({
  item,
  applicationId,
  canUpload,
  onChange,
}: {
  item: DocumentChecklistItem;
  applicationId: string;
  canUpload: boolean;
  onChange: (list: DocumentChecklist) => void;
}) {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const { requirement: r, current: c } = item;
  const types = requirementFileTypes(r.acceptedTypes);
  const status = statusOf(item);
  const inputId = `doc-${r.id}`;
  const headingId = `doc-${r.id}-name`;
  const helpId = `doc-${r.id}-help`;
  const editable = canUpload && item.canReplace;

  async function choose(file: File | undefined) {
    if (!file) return;
    setProblem('');
    const type = isKnownFileType(file.type) ? file.type : fileTypeFromName(file.name);
    if (!type || !types.includes(type)) return setProblem(`${file.name} is not a ${describeFileTypes(types)} file`);
    if (file.size > r.maxSizeMb * 1024 * 1024) return setProblem(`${file.name} is larger than ${r.maxSizeMb} MB`);

    setBusy(true);
    try {
      const body = new FormData();
      body.append('file', file);
      const stored = await api.call<{ id: string }>((cl) =>
        cl.POST('/api/files', { params: { query: { requirementId: r.id } }, body: body as unknown as { file: string } }),
      );
      const list = await api.call<DocumentChecklist>((cl) =>
        cl.POST('/api/applications/{id}/documents/{requirementId}', {
          params: { path: { id: applicationId, requirementId: r.id } },
          body: { fileId: stored.id },
        }),
      );
      onChange(list);
    } catch (e) {
      setProblem((e as ClientApiError).message);
    } finally {
      setBusy(false);
    }
  }

  async function view(fileId: string) {
    setProblem('');
    // Open the tab now, while the click still counts as the customer's, then point it at the signed link.
    const tab = window.open('', '_blank');
    try {
      const link = await api.call<{ url: string }>((cl) =>
        cl.POST('/api/files/{id}/link', { params: { path: { id: fileId }, query: { disposition: 'inline' } } }),
      );
      if (tab) {
        tab.opener = null;
        tab.location.href = link.url;
      } else window.location.assign(link.url);
    } catch (e) {
      tab?.close();
      setProblem((e as ClientApiError).message);
    }
  }

  return (
    <li className="rounded-lg border border-rule bg-white p-4 sm:p-5" aria-labelledby={headingId}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id={headingId} className="font-semibold">
            {r.name}
            {!r.isMandatory && <span className="ml-1 font-normal text-muted">(optional)</span>}
          </h2>
          {r.description && <p className="mt-0.5 text-sm text-muted">{r.description}</p>}
        </div>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>

      {c?.status === 'REJECTED' && c.scanStatus !== 'INFECTED' && (
        <p className="mt-3 rounded-md bg-danger-050 px-3 py-2 text-sm text-danger">
          <strong>Rejected.</strong> {c.rejectionReason ? `Reason: ${c.rejectionReason}` : 'Please upload a new copy.'}
        </p>
      )}
      {c?.scanStatus === 'INFECTED' && (
        <p className="mt-3 rounded-md bg-danger-050 px-3 py-2 text-sm text-danger">A virus was found in this file and it was removed. Upload a clean copy.</p>
      )}

      {c && c.scanStatus !== 'INFECTED' && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md bg-paper px-3 py-2 text-sm">
          <span className="min-w-0">
            <span className="block truncate font-medium">{c.fileName}</span>
            <span className="text-muted">
              {sizeText(c.sizeBytes)} · {formatDate(c.uploadedAt)}
              {c.version > 1 && ` · version ${c.version}`}
              {c.scanStatus === 'PENDING' && ' · checking for viruses'}
            </span>
          </span>
          {c.scanStatus === 'CLEAN' && (
            <Button type="button" variant="ghost" size="sm" onClick={() => void view(c.fileId)} aria-label={`View ${r.name}`}>
              View
            </Button>
          )}
        </div>
      )}
      {item.previous.length > 0 && (
        <p className="mt-1 text-xs text-muted">{item.previous.length === 1 ? 'Your earlier upload is kept.' : `Your ${item.previous.length} earlier uploads are kept.`}</p>
      )}

      {editable && (
        <div className="mt-3">
          <label htmlFor={inputId} className="text-sm font-medium">
            {c && !needsUpload(item) ? 'Replace file' : c ? 'Upload a new copy' : 'Upload file'}
            <span className="sr-only"> for {r.name}</span>
          </label>
          <input
            id={inputId}
            type="file"
            accept={acceptAttribute(types)}
            disabled={busy}
            aria-describedby={helpId}
            aria-invalid={problem ? true : undefined}
            className="mt-1 block w-full text-sm text-muted file:mr-3 file:rounded-md file:border file:border-rule file:bg-white file:px-3 file:py-1.5 file:text-sm file:text-night"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = ''; // choosing the same file again should still upload
              void choose(file);
            }}
          />
          <p id={helpId} className="mt-1 text-xs text-muted">
            {busy ? 'Uploading…' : `${describeFileTypes(types)}, up to ${r.maxSizeMb} MB.`}
          </p>
        </div>
      )}
      {!editable && canUpload && c && (
        <p className="mt-3 text-xs text-muted">{c.status === 'APPROVED' ? 'Approved documents can’t be replaced.' : 'This document is being reviewed and can’t be replaced right now.'}</p>
      )}

      {problem && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {problem}
        </p>
      )}
    </li>
  );
}
