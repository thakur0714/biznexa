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
