/**
 * Response contracts. The API publishes these in its OpenAPI document (→ packages/api-client),
 * and integration tests check real responses against them so the spec cannot drift.
 * Dates are ISO strings on the wire.
 */
import { z } from 'zod';
import { CERTIFICATE_STATUSES } from './status';

const isoDate = z.string().datetime();

export const certificateVerifyResultSchema = z.object({
  found: z.boolean(),
  verifiedAt: isoDate,
  /** true/false only when the lookup came from a signed QR link; null otherwise. */
  qrAuthentic: z.boolean().nullable().optional(),
  certificate: z
    .object({
      certificateNumber: z.string(),
      verificationId: z.string(),
      type: z.string(),
      organizationName: z.string(),
      scope: z.string().nullable(),
      issueDate: isoDate,
      validFrom: isoDate,
      validUntil: isoDate,
      status: z.enum(CERTIFICATE_STATUSES),
      statusNote: z.string().nullable(),
      certificationBody: z.object({ name: z.string(), accreditation: z.string().nullable(), website: z.string().nullable() }),
      pdfAvailable: z.boolean(),
    })
    .optional(),
});
export type CertificateVerifyResult = z.infer<typeof certificateVerifyResultSchema>;

export const certificateOrgResultSchema = z.array(
  z.object({
    certificateNumber: z.string(),
    verificationId: z.string(),
    organizationName: z.string(),
    type: z.string(),
    validUntil: isoDate,
    status: z.enum(CERTIFICATE_STATUSES),
    certificationBody: z.string(),
  }),
);
export type CertificateOrgResult = z.infer<typeof certificateOrgResultSchema>;

/** One row of the admin services list (M2.5.8). Prices in paise. */
export const adminServiceRowSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  isActive: z.boolean(),
  isPopular: z.boolean(),
  category: z.object({ id: z.string().uuid(), name: z.string() }),
  subcategory: z.string().nullable(),
  /** Cheapest active package's professional fee; null when the service has no active package. */
  startingPrice: z.number().int().nullable(),
  activePackages: z.number().int(),
  applications: z.number().int(),
  updatedAt: isoDate,
});
export type AdminServiceRow = z.infer<typeof adminServiceRowSchema>;
export const adminServiceListSchema = z.array(adminServiceRowSchema);

/** One row of the admin categories list: every category, active or not, with service counts (deleted services excluded). */
export const adminCategoryRowSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  isActive: z.boolean(),
  sortOrder: z.number().int(),
  services: z.number().int(),
  activeServices: z.number().int(),
  /** For the service editor's subcategory picker; inactive ones included. */
  subcategories: z.array(z.object({ id: z.string().uuid(), name: z.string(), isActive: z.boolean() })),
});
export type AdminCategoryRow = z.infer<typeof adminCategoryRowSchema>;
export const adminCategoryListSchema = z.array(adminCategoryRowSchema);

const httpsUrl = z
  .string()
  .trim()
  .url('Must be a valid URL')
  .refine((u) => u.startsWith('https://'), 'Must be an https:// URL')
  .or(z.literal(''))
  .nullable()
  .optional()
  .transform((v) => (v === '' ? null : v));

export const createCertificationBodyInput = z.object({
  name: z.string({ required_error: 'Enter body name' }).trim().min(2, 'Name must be at least 2 characters').max(200, 'Name is too long'),
  accreditation: z.string().trim().max(500).nullable().optional().transform((v) => (v === '' ? null : v)),
  website: httpsUrl,
  logoUrl: httpsUrl,
});
export type CreateCertificationBodyInput = z.infer<typeof createCertificationBodyInput>;

export const updateCertificationBodyInput = createCertificationBodyInput.partial();
export type UpdateCertificationBodyInput = z.infer<typeof updateCertificationBodyInput>;

export const certificationBodySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  accreditation: z.string().nullable(),
  logoUrl: z.string().nullable(),
  website: z.string().nullable(),
});
export type CertificationBodyRow = z.infer<typeof certificationBodySchema>;
export const certificationBodyListSchema = z.array(certificationBodySchema);

export const adminCertificateRowSchema = z.object({
  id: z.string().uuid(),
  certificateNumber: z.string(),
  verificationId: z.string(),
  type: z.string(),
  organizationName: z.string(),
  scope: z.string().nullable(),
  address: z.string().nullable(),
  issueDate: isoDate,
  validFrom: isoDate,
  validUntil: isoDate,
  certificationBodyId: z.string().uuid(),
  certificationBody: z.object({ id: z.string().uuid().optional(), name: z.string() }),
  status: z.enum(CERTIFICATE_STATUSES),
  statusReason: z.string().nullable(),
  pdfKey: z.string().nullable(),
  showPdfPublicly: z.boolean(),
  applicationId: z.string().uuid().nullable(),
  businessEntityId: z.string().uuid().nullable(),
  createdAt: isoDate,
  updatedAt: isoDate,
  _count: z.object({ lookups: z.number().int() }),
});
export type AdminCertificateRow = z.infer<typeof adminCertificateRowSchema>;
export const adminCertificateListSchema = z.object({
  items: z.array(adminCertificateRowSchema),
  total: z.number().int(),
  page: z.number().int(),
  limit: z.number().int(),
});

export const customerCertificateRowSchema = z.object({
  id: z.string().uuid(),
  certificateNumber: z.string(),
  verificationId: z.string(),
  type: z.string(),
  organizationName: z.string(),
  scope: z.string().nullable(),
  address: z.string().nullable(),
  issueDate: isoDate,
  validFrom: isoDate,
  validUntil: isoDate,
  certificationBody: z.object({
    name: z.string(),
    accreditation: z.string().nullable(),
    website: z.string().nullable(),
  }),
  status: z.enum(CERTIFICATE_STATUSES),
  effectiveStatus: z.enum(CERTIFICATE_STATUSES),
  pdfAvailable: z.boolean(),
  qrUrl: z.string(),
  qrDataUrl: z.string().optional(),
  daysUntilExpiry: z.number().int(),
  isExpiringSoon: z.boolean(),
  createdAt: isoDate,
});
export type CustomerCertificateRow = z.infer<typeof customerCertificateRowSchema>;

export const customerCertificateListSchema = z.object({
  items: z.array(customerCertificateRowSchema),
  total: z.number().int(),
});
export type CustomerCertificateList = z.infer<typeof customerCertificateListSchema>;

