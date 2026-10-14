/**
 * Staff applications list (M4.2). Who sees what is decided by the API, not by these filters: with
 * `applications.view_all` every application, with only `applications.view_assigned` just the ones
 * assigned to the signed-in user — filters only narrow that further.
 */
import { z } from 'zod';
import { APPLICATION_STATUSES } from './status';

export const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export type Priority = (typeof PRIORITIES)[number];

/** Hours before `slaDueAt` from which an application counts as "due soon". */
export const SLA_DUE_SOON_HOURS = 24;

/** A calendar day in India, YYYY-MM-DD (e.g. from a date input). Impossible dates such as 2026-02-30 are refused. */
export const calendarDaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-13')
  .refine((d) => {
    const t = Date.parse(`${d}T00:00:00Z`);
    return !Number.isNaN(t) && new Date(t).toISOString().startsWith(d);
  }, 'Not a real date');

/** `?status=IN_PROGRESS,ON_HOLD` or repeated `?status=…`. */
const statusList = z.preprocess(
  (v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : v),
  z.array(z.enum(APPLICATION_STATUSES)).min(1).max(APPLICATION_STATUSES.length),
);

export const ADMIN_APPLICATION_SORTS = ['createdAt', 'updatedAt', 'submittedAt', 'slaDueAt', 'priority'] as const;

export const adminApplicationListQuery = z.object({
  /** Default: everything except DRAFT (an unpaid draft is still the customer's cart). */
  status: statusList.optional(),
  serviceId: z.string().uuid().optional(),
  /** A staff user id, `me`, or `unassigned`. */
  assignee: z.union([z.string().uuid(), z.enum(['me', 'unassigned'])]).optional(),
  priority: z.enum(PRIORITIES).optional(),
  /** `overdue`: past `slaDueAt`; `due_soon`: due within SLA_DUE_SOON_HOURS; both skip COMPLETED/DELIVERED/CANCELLED. */
  sla: z.enum(['overdue', 'due_soon']).optional(),
  /** Created on these days in India, both inclusive. */
  from: calendarDaySchema.optional(),
  to: calendarDaySchema.optional(),
  /** Application code, order code, or the customer's name, email or mobile. */
  q: z.string().trim().min(1).max(100).optional(),
  sort: z.enum(ADMIN_APPLICATION_SORTS).default('createdAt'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type AdminApplicationListQuery = z.output<typeof adminApplicationListQuery>;

export const adminApplicationRowSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  status: z.enum(APPLICATION_STATUSES),
  priority: z.enum(PRIORITIES),
  slaDueAt: z.string().datetime().nullable(),
  submittedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  service: z.object({ id: z.string().uuid(), name: z.string() }),
  packageName: z.string(),
  orderCode: z.string().nullable(),
  customer: z.object({ id: z.string().uuid(), name: z.string(), email: z.string().nullable(), mobile: z.string().nullable() }).nullable(),
  assignedTo: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
});
export type AdminApplicationRow = z.infer<typeof adminApplicationRowSchema>;

export const adminApplicationPageSchema = z.object({
  items: z.array(adminApplicationRowSchema),
  total: z.number().int(),
  page: z.number().int(),
  limit: z.number().int(),
});
export type AdminApplicationPage = z.infer<typeof adminApplicationPageSchema>;

import { formSchema } from './form-schema';

export const adminApplicationDetailSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  status: z.enum(APPLICATION_STATUSES),
  priority: z.enum(PRIORITIES),
  slaDueAt: z.string().datetime().nullable(),
  submittedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  
  customer: z.object({
    id: z.string().uuid(),
    name: z.string(),
    email: z.string().nullable(),
    mobile: z.string().nullable(),
  }).nullable(),

  service: z.object({
    id: z.string().uuid(),
    name: z.string(),
  }),
  package: z.object({
    id: z.string().uuid(),
    name: z.string(),
  }),

  businessEntity: z.object({
    id: z.string().uuid(),
    maskedPan: z.string().nullable(),
  }).nullable(),

  order: z.object({
    id: z.string().uuid(),
    code: z.string(),
    status: z.string(),
    total: z.number().int(),
    taxTotal: z.number().int(),
    subtotal: z.number().int(),
  }).nullable(),

  payments: z.array(z.object({
    id: z.string().uuid(),
    status: z.string(),
    amount: z.number().int(),
    method: z.string().nullable(),
    paidAt: z.string().datetime().nullable(),
  })),

  formSchema: formSchema.nullable(),
  formData: z.record(z.unknown()),

  documents: z.array(z.object({
    id: z.string().uuid(),
    requirementId: z.string().uuid(),
    name: z.string(),
    status: z.string(),
    fileKey: z.string(),
    fileName: z.string(),
    fileSize: z.number().int(),
    mimeType: z.string(),
  })),

  history: z.array(z.object({
    id: z.string().uuid(),
    status: z.string(),
    stageId: z.string().uuid().nullable(),
    visibleToCustomer: z.boolean(),
    changedBy: z.object({
      id: z.string().uuid(),
      name: z.string(),
    }).nullable(),
    createdAt: z.string().datetime(),
  })),

  assignedTo: z.object({
    id: z.string().uuid(),
    name: z.string(),
  }).nullable(),
  
  currentStage: z.object({
    id: z.string().uuid(),
    name: z.string(),
  }).nullable(),
});

export type AdminApplicationDetail = z.infer<typeof adminApplicationDetailSchema>;

export const assigneeInputSchema = z.object({
  assigneeId: z.string().uuid().nullable()
});

export type AssigneeInput = z.infer<typeof assigneeInputSchema>;

export const bulkAssignInputSchema = z.object({
  applicationIds: z.array(z.string().uuid()).min(1).max(100),
  assigneeId: z.string().uuid().nullable()
});

export type BulkAssignInput = z.infer<typeof bulkAssignInputSchema>;

export const eligibleStaffSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  role: z.string()
});

export const eligibleStaffListSchema = z.array(eligibleStaffSchema);
export type EligibleStaff = z.infer<typeof eligibleStaffSchema>;
