import { z } from 'zod';

export const auditLogFilterSchema = z.object({
  actorId: z.string().uuid().optional(),
  entityType: z.string().max(100).optional(),
  entityId: z.string().max(100).optional(),
  action: z.string().max(100).optional(),
  from: z.string().datetime().optional(), // Expected to be beginning of IST day
  to: z.string().datetime().optional(),   // Expected to be end of IST day
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type AuditLogFilter = z.infer<typeof auditLogFilterSchema>;

export const auditLogSchema = z.object({
  id: z.string().uuid(),
  actorId: z.string().uuid().nullable(),
  actorName: z.string().nullable(),
  actorEmail: z.string().email().nullable(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  before: z.record(z.unknown()).nullable(),
  after: z.record(z.unknown()).nullable(),
  ip: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type AuditLog = z.infer<typeof auditLogSchema>;

export const auditLogPageSchema = z.object({
  items: z.array(auditLogSchema),
  total: z.number().int(),
  page: z.number().int(),
  limit: z.number().int(),
  pages: z.number().int(),
});
export type AuditLogPage = z.infer<typeof auditLogPageSchema>;
