'use client';

import { useState } from 'react';
import {
  acceptAttribute,
  DEFAULT_ACCEPTED_TYPES,
  DEFAULT_MAX_UPLOAD_MB,
  describeFileTypes,
  fileTypeFromName,
  formatDate,
  isKnownFileType,
  needsUpload,
  requirementFileTypes,
  type AdditionalDocumentItem,
  type DocumentChecklist,
  type DocumentChecklistItem,
} from '@biznexa/types';
import { ClientApiError } from '@biznexa/api-client/browser';
import { useApi } from '@biznexa/api-client/react';
import { Badge, Button, type Tone } from '@biznexa/ui';

/** A checklist document, or one staff asked for later (M4.8: no requirement, so the default upload rules apply). */
export type RowTarget =
  | { kind: 'requirement'; item: DocumentChecklistItem }
  | { kind: 'additional'; item: AdditionalDocumentItem };

export function describeTarget(t: RowTarget) {
  if (t.kind === 'requirement') {
    const r = t.item.requirement;
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      isMandatory: r.isMandatory,
      types: requirementFileTypes(r.acceptedTypes),
      maxSizeMb: r.maxSizeMb,
    };
  }
  const r = t.item.request;
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    isMandatory: true,
    types: DEFAULT_ACCEPTED_TYPES,
    maxSizeMb: DEFAULT_MAX_UPLOAD_MB,
  };
}

/** What the customer sees for an item's newest upload. */
export function statusOf(
  item: Pick<DocumentChecklistItem, 'current'>,
  isMandatory: boolean,
): { label: string; tone: Tone } {
  const c = item.current;
  if (!c) return isMandatory ? { label: 'Required', tone: 'warning' } : { label: 'Optional', tone: 'neutral' };
  if (c.scanStatus === 'INFECTED') return { label: 'Virus found', tone: 'danger' };
  if (c.status === 'REJECTED') return { label: 'Rejected', tone: 'danger' };
  if (c.status === 'APPROVED') return { label: 'Approved', tone: 'success' };
  if (c.status === 'UNDER_REVIEW') return { label: 'Under review', tone: 'info' };
  return { label: 'Uploaded', tone: 'success' };
}

export const sizeText = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** One checklist item: status, the current file, and upload / replace. Shared by /apply/.../documents and /dashboard/applications/[id]. */
export function DocumentRow({
  target,
  applicationId,
  canUpload,
  onChange,
}: {
  target: RowTarget;
  applicationId: string;
  canUpload: boolean;
  onChange: (list: DocumentChecklist) => void;
}) {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const { item } = target;
  const c = item.current;
  const r = describeTarget(target);
  const types = r.types;
  const status = statusOf(item, r.isMandatory);
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
      const formData = new FormData();
      formData.append('file', file);
      const query = target.kind === 'requirement' ? { requirementId: r.id } : {};
      const stored = await api.call<{ id: string }>((cl) =>
        cl.POST('/api/files', {
          params: { query },
          body: { file: file.name },
          bodySerializer: () => formData,
        }),
      );
      const list = await api.call<DocumentChecklist>((cl) =>
        target.kind === 'requirement'
          ? cl.POST('/api/applications/{id}/documents/{requirementId}', {
              params: { path: { id: applicationId, requirementId: r.id } },
              body: { fileId: stored.id },
            })
          : cl.POST('/api/applications/{id}/documents/additional/{requestId}', {
              params: { path: { id: applicationId, requestId: r.id } },
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
          <h3 id={headingId} className="font-semibold">
            {r.name}
            {!r.isMandatory && <span className="ml-1 font-normal text-muted">(optional)</span>}
          </h3>
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
        <p className="mt-3 rounded-md bg-danger-050 px-3 py-2 text-sm text-danger">
          A virus was found in this file and it was removed. Upload a clean copy.
        </p>
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
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void view(c.fileId)}
              aria-label={`View ${r.name}`}
            >
              View
            </Button>
          )}
        </div>
      )}
      {item.previous.length > 0 && (
        <p className="mt-1 text-xs text-muted">
          {item.previous.length === 1
            ? 'Your earlier upload is kept.'
            : `Your ${item.previous.length} earlier uploads are kept.`}
        </p>
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
        <p className="mt-3 text-xs text-muted">
          {c.status === 'APPROVED'
            ? 'Approved documents can’t be replaced.'
            : 'This document is being reviewed and can’t be replaced right now.'}
        </p>
      )}

      {problem && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {problem}
        </p>
      )}
    </li>
  );
}
