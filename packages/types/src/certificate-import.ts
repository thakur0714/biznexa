import { z } from 'zod';

export const certificateImportRowErrorSchema = z.object({
  rowNumber: z.number().int(),
  field: z.string().optional(),
  message: z.string(),
});
export type CertificateImportRowError = z.infer<typeof certificateImportRowErrorSchema>;

export const certificateImportPreviewRowSchema = z.object({
  rowNumber: z.number().int(),
  certificateNumber: z.string().optional(),
  type: z.string(),
  organizationName: z.string(),
  scope: z.string().optional(),
  address: z.string().optional(),
  issueDate: z.string(),
  validFrom: z.string(),
  validUntil: z.string(),
  certificationBodyId: z.string(),
  certificationBodyName: z.string(),
  showPdfPublicly: z.boolean(),
});
export type CertificateImportPreviewRow = z.infer<typeof certificateImportPreviewRowSchema>;

export const certificateImportPreviewResponseSchema = z.object({
  totalRows: z.number().int(),
  validRows: z.number().int(),
  invalidRows: z.number().int(),
  errors: z.array(certificateImportRowErrorSchema),
  preview: z.array(certificateImportPreviewRowSchema),
});
export type CertificateImportPreviewResponse = z.infer<typeof certificateImportPreviewResponseSchema>;

export const certificateImportInputSchema = z.object({
  csv: z.string().min(1, 'CSV content is required'),
});
export type CertificateImportInput = z.infer<typeof certificateImportInputSchema>;

export const certificateImportResponseSchema = z.object({
  success: z.boolean(),
  importedCount: z.number().int(),
  certificateIds: z.array(z.string().uuid()),
});
export type CertificateImportResponse = z.infer<typeof certificateImportResponseSchema>;
