/**
 * Upload rules (PROMPT §7.4): PDF/JPG/PNG by default, 10 MB, configurable per document requirement
 * (`ServiceDocumentRequirement.acceptedTypes` / `maxSizeMb`). The API checks the extension and the
 * file's magic bytes; web and mobile use the same table for `accept=` and early size messages.
 */
import { z } from 'zod';

/** File types the API can verify by content. A requirement may only accept types listed here. */
export const FILE_TYPES = {
  'application/pdf': { label: 'PDF', extensions: ['pdf'] },
  'image/jpeg': { label: 'JPG', extensions: ['jpg', 'jpeg'] },
  'image/png': { label: 'PNG', extensions: ['png'] },
  'image/webp': { label: 'WebP', extensions: ['webp'] },
} as const satisfies Record<string, { label: string; extensions: readonly string[] }>;

export type FileMimeType = keyof typeof FILE_TYPES;

export const DEFAULT_ACCEPTED_TYPES: FileMimeType[] = ['application/pdf', 'image/jpeg', 'image/png'];
export const DEFAULT_MAX_UPLOAD_MB = 10;

export const isKnownFileType = (mime: string): mime is FileMimeType => Object.prototype.hasOwnProperty.call(FILE_TYPES, mime);

/** The type a file name claims by its extension, or null when the extension is unknown. */
export function fileTypeFromName(name: string): FileMimeType | null {
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (!ext) return null;
  const hit = Object.entries(FILE_TYPES).find(([, t]) => (t.extensions as readonly string[]).includes(ext));
  return (hit?.[0] as FileMimeType | undefined) ?? null;
}

/** "PDF, JPG or PNG" */
export function describeFileTypes(types: readonly FileMimeType[]): string {
  const labels = types.map((t) => FILE_TYPES[t].label);
  return labels.length <= 1 ? (labels[0] ?? '') : `${labels.slice(0, -1).join(', ')} or ${labels[labels.length - 1]}`;
}

/** Value for an `<input type="file" accept>` attribute. */
export function acceptAttribute(types: readonly FileMimeType[]): string {
  return types.flatMap((t) => [t, ...FILE_TYPES[t].extensions.map((e) => `.${e}`)]).join(',');
}

/** Every upload is virus-scanned by a background job; only CLEAN files can be downloaded. */
export const FILE_SCAN_STATUSES = ['PENDING', 'CLEAN', 'INFECTED'] as const;
export type FileScanStatus = (typeof FILE_SCAN_STATUSES)[number];

export const storedFileSchema = z.object({
  id: z.string().uuid(),
  fileName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  sha256: z.string(),
  requirementId: z.string().uuid().nullable(),
  scanStatus: z.enum(FILE_SCAN_STATUSES).describe('PENDING right after upload; a download link is only given once CLEAN'),
  createdAt: z.string().datetime(),
});
export type StoredFileResult = z.infer<typeof storedFileSchema>;

export const fileLinkSchema = z.object({
  /** Path under the API origin, e.g. `/api/files/{id}/download?…`. Works without a login until it expires. */
  url: z.string(),
  expiresAt: z.string().datetime(),
});
export type FileLinkResult = z.infer<typeof fileLinkSchema>;
