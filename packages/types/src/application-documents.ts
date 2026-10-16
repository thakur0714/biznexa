/**
 * The document step of an application (M3.10, PROMPT §7.4 step 3). The checklist is the service's
 * document requirements that apply to the chosen package (`packageIds` empty = every package). Each
 * upload is a new `ApplicationDocument` version for its requirement; earlier versions are kept, only the
 * newest (`isLatest`) counts. Uploading can be skipped and done later; the application then shows
 * "Documents Pending".
 */
import { z } from 'zod';
import { DOCUMENT_STATUSES } from './status';
import { FILE_SCAN_STATUSES, isKnownFileType, type FileMimeType } from './uploads';

/** Statuses in which the customer may still add or replace documents (later ones are past document collection). */
export const DOCUMENT_UPLOAD_STATUSES = ['DRAFT', 'PAYMENT_PENDING', 'SUBMITTED', 'DOCUMENTS_UNDER_REVIEW', 'DOCUMENTS_PENDING'] as const;

export const canUploadDocuments = (applicationStatus: string): boolean => (DOCUMENT_UPLOAD_STATUSES as readonly string[]).includes(applicationStatus);

/** A requirement applies to a package when it names it, or names no packages at all. */
export function requirementApplies(req: { packageIds: readonly string[] }, packageId: string): boolean {
  return req.packageIds.length === 0 || req.packageIds.includes(packageId);
}

/** Only the file types the API can verify by content (a requirement may list others; they are ignored on upload). */
export const requirementFileTypes = (acceptedTypes: readonly string[]): FileMimeType[] => acceptedTypes.filter(isKnownFileType);

export const applicationDocumentSchema = z.object({
  id: z.string().uuid(),
  version: z.number().int().positive(),
  status: z.enum(DOCUMENT_STATUSES),
  rejectionReason: z.string().nullable(),
  /** The `StoredFile` id — ask `POST /api/files/{fileId}/link` for a download link. */
  fileId: z.string().uuid(),
  fileName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  scanStatus: z.enum(FILE_SCAN_STATUSES).describe('INFECTED means the file was removed: upload a clean copy'),
  uploadedAt: z.string().datetime(),
});
export type ApplicationDocumentResult = z.infer<typeof applicationDocumentSchema>;

export const documentChecklistItemSchema = z.object({
  requirement: z.object({
    id: z.string().uuid(),
    name: z.string(),
    description: z.string().nullable(),
    isMandatory: z.boolean(),
    acceptedTypes: z.array(z.string()),
    maxSizeMb: z.number().int(),
  }),
  /** The newest upload, or null while the document is still REQUIRED. */
  current: applicationDocumentSchema.nullable(),
  /** Earlier uploads, newest first. Never deleted (PROMPT §7.4: every replacement is kept). */
  previous: z.array(applicationDocumentSchema),
  /** False while the newest upload is under review or approved (state machine: only UPLOADED/REJECTED can be replaced). */
  canReplace: z.boolean(),
});
export type DocumentChecklistItem = z.infer<typeof documentChecklistItemSchema>;

/**
 * A document staff asked for on this application (M4.8), outside the service's checklist. Always needed;
 * uploaded with `POST /api/files` (no `requirementId`, so the default types and size limit apply) and
 * attached with `POST /api/applications/{id}/documents/additional/{requestId}`.
 */
export const additionalDocumentItemSchema = z.object({
  request: z.object({
    id: z.string().uuid(),
    name: z.string(),
    description: z.string().nullable(),
    requestedAt: z.string().datetime(),
  }),
  /** The newest upload, or null while nothing is uploaded yet. */
  current: applicationDocumentSchema.nullable(),
  previous: z.array(applicationDocumentSchema),
  canReplace: z.boolean(),
});
export type AdditionalDocumentItem = z.infer<typeof additionalDocumentItemSchema>;

export const documentChecklistSchema = z.object({
  applicationId: z.string().uuid(),
  /** Whether the customer can upload now (application not yet past document collection). */
  canUpload: z.boolean(),
  items: z.array(documentChecklistItemSchema),
  /** Documents staff asked for after submitting, oldest request first. */
  additional: z.array(additionalDocumentItemSchema),
  /** Mandatory and requested documents with no usable upload yet; > 0 means "Documents Pending". */
  pendingMandatory: z.number().int(),
});
export type DocumentChecklist = z.infer<typeof documentChecklistSchema>;

/** Customer's documents grouped by application (M5.9). */
export const customerDocumentsQuery = z.object({
  status: z.enum(['needs_action', 'all']).default('needs_action'),
});
export type CustomerDocumentsQuery = z.output<typeof customerDocumentsQuery>;

export const customerDocumentsSchema = z.array(z.object({
  applicationId: z.string().uuid(),
  applicationCode: z.string(),
  serviceName: z.string(),
  checklist: documentChecklistSchema,
}));
export type CustomerDocuments = z.infer<typeof customerDocumentsSchema>;

/**
 * Body of `POST /api/applications/{id}/documents/{requirementId}` (a file uploaded with `POST /api/files?requirementId=`)
 * and of `POST /api/applications/{id}/documents/additional/{requestId}` (a file uploaded without `requirementId`).
 */
export const attachDocumentInput = z.object({ fileId: z.string({ required_error: 'Upload a file first' }).uuid('Upload a file first') }).strict();
export type AttachDocumentInput = z.infer<typeof attachDocumentInput>;

/** The newest upload can be replaced while it is waiting or was rejected — never once review started or it was approved. */
export const canReplaceDocument = (status: (typeof DOCUMENT_STATUSES)[number]): boolean => status === 'UPLOADED' || status === 'REJECTED';

/**
 * Whether an item still needs the customer: nothing uploaded, the upload was rejected, or the virus
 * scan removed it. A file still being scanned counts as uploaded.
 */
export function needsUpload(item: Pick<DocumentChecklistItem | AdditionalDocumentItem, 'current'>): boolean {
  const c = item.current;
  return !c || c.status === 'REJECTED' || c.scanStatus === 'INFECTED';
}

/** Mandatory items that still need an upload — what "Documents Pending" means. */
export const pendingMandatoryCount = (
  items: Pick<DocumentChecklistItem, 'current' | 'requirement'>[],
  additional: Pick<AdditionalDocumentItem, 'current'>[] = [],
): number => items.filter((i) => i.requirement.isMandatory && needsUpload(i)).length + additional.filter(needsUpload).length;
