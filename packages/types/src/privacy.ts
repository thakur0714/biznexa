/** Data export and account deletion requests (DPDP Act 2023, M5.12). */
import { z } from 'zod';

export const DATA_REQUEST_TYPES = ['EXPORT', 'DELETION'] as const;
export type DataRequestType = (typeof DATA_REQUEST_TYPES)[number];

/** PENDING → PROCESSING → COMPLETED, or PENDING → REJECTED. PENDING and PROCESSING are "open". */
export const DATA_REQUEST_STATUSES = ['PENDING', 'PROCESSING', 'COMPLETED', 'REJECTED'] as const;
export type DataRequestStatus = (typeof DATA_REQUEST_STATUSES)[number];
export const OPEN_DATA_REQUEST_STATUSES = ['PENDING', 'PROCESSING'] as const satisfies readonly DataRequestStatus[];

export const DATA_REQUEST_TYPE_LABEL: Record<DataRequestType, string> = {
  EXPORT: 'Data export',
  DELETION: 'Account deletion',
};

export const DATA_REQUEST_STATUS_LABEL: Record<DataRequestStatus, string> = {
  PENDING: 'Pending',
  PROCESSING: 'Processing',
  COMPLETED: 'Completed',
  REJECTED: 'Rejected',
};

/** How long a finished export can be downloaded before the cleanup job deletes it. */
export const DATA_EXPORT_TTL_DAYS = 7;

/**
 * `POST /api/privacy/requests`. A deletion must be confirmed and re-checked with the account password
 * or a code sent by `POST /api/privacy/otp` (exactly one of the two).
 */
export const createDataRequestInput = z
  .object({
    type: z.enum(DATA_REQUEST_TYPES),
    reason: z.string().trim().max(500, 'Keep the reason under 500 characters').optional(),
    confirm: z.boolean().optional().describe('Deletion only: the customer ticked "I understand"'),
    password: z.string().min(1, 'Enter your password').max(200).optional().describe('Deletion only'),
    otp: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code').optional().describe('Deletion only'),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.type !== 'DELETION') return;
    if (v.confirm !== true) ctx.addIssue({ code: 'custom', path: ['confirm'], message: 'Please confirm you want to delete your account' });
    if (Boolean(v.password) === Boolean(v.otp)) ctx.addIssue({ code: 'custom', path: ['password'], message: 'Enter your password or the code we sent you' });
  });
export type CreateDataRequestInput = z.infer<typeof createDataRequestInput>;

export const dataRequestSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(DATA_REQUEST_TYPES),
  status: z.enum(DATA_REQUEST_STATUSES),
  reason: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  createdAt: z.string().datetime(),
  handledAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  /** Export only: when the file is deleted. */
  expiresAt: z.string().datetime().nullable(),
  /** Export only: the file is ready and not expired — ask `POST /api/privacy/requests/{id}/link`. */
  downloadable: z.boolean(),
});
export type DataRequest = z.infer<typeof dataRequestSchema>;

export const dataRequestListSchema = z.object({
  items: z.array(dataRequestSchema),
  /** Which re-checks a deletion can use for this account. */
  reauth: z.object({
    password: z.boolean(),
    otpChannel: z.enum(['MOBILE', 'EMAIL']).nullable(),
  }),
});
export type DataRequestList = z.infer<typeof dataRequestListSchema>;

export const privacyOtpResponseSchema = z.object({
  channel: z.enum(['MOBILE', 'EMAIL']),
  /** Masked mobile or email the code went to. */
  sentTo: z.string(),
  expiresIn: z.number().int(),
  resendAfter: z.number().int(),
  /** Development only (console SMS provider). */
  devCode: z.string().optional(),
});
export type PrivacyOtpResponse = z.infer<typeof privacyOtpResponseSchema>;

/** Staff queue (`privacy.manage`): `GET /api/admin/privacy/requests`. */
export const adminDataRequestListQuery = z.object({
  type: z.enum(DATA_REQUEST_TYPES).optional(),
  status: z.enum(DATA_REQUEST_STATUSES).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type AdminDataRequestListQuery = z.output<typeof adminDataRequestListQuery>;

export const adminDataRequestRowSchema = dataRequestSchema.omit({ downloadable: true }).extend({
  user: z.object({
    id: z.string().uuid(),
    name: z.string(),
    email: z.string().nullable(),
    mobile: z.string().nullable(),
    deleted: z.boolean(),
  }),
  handledBy: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
  /** Pending deletions only: why it can't be approved yet (empty = it can). */
  blockers: z.array(z.string()),
});
export type AdminDataRequestRow = z.infer<typeof adminDataRequestRowSchema>;

export const adminDataRequestListSchema = z.object({
  items: z.array(adminDataRequestRowSchema),
  total: z.number().int(),
  page: z.number().int(),
  limit: z.number().int(),
});
export type AdminDataRequestList = z.infer<typeof adminDataRequestListSchema>;

export const rejectDataRequestInput = z
  .object({
    reason: z.string({ required_error: 'Give the customer a reason' }).trim().min(5, 'Give the customer a reason (at least 5 characters)').max(500),
  })
  .strict();
export type RejectDataRequestInput = z.infer<typeof rejectDataRequestInput>;
