import { z } from 'zod';
import { USER_STATUSES } from './admin-customers';

const isoDate = z.string().datetime();

export const adminStaffListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type AdminStaffListQuery = z.infer<typeof adminStaffListQuerySchema>;

export const adminStaffRoleSchema = z.object({ key: z.string(), name: z.string() });
export const adminStaffRowSchema = z.object({
  id: z.string().uuid(), name: z.string(), email: z.string().nullable(), mobile: z.string().nullable(),
  roles: z.array(adminStaffRoleSchema), status: z.enum(USER_STATUSES), active: z.boolean(),
  twoFactorEnabled: z.boolean(), lastLoginAt: isoDate.nullable(),
});
export type AdminStaffRow = z.infer<typeof adminStaffRowSchema>;
export const adminStaffListResponseSchema = z.object({ items: z.array(adminStaffRowSchema), total: z.number().int(), page: z.number().int(), limit: z.number().int() });
export type AdminStaffListResponse = z.infer<typeof adminStaffListResponseSchema>;
export const adminStaffRoleOptionsSchema = z.array(adminStaffRoleSchema);
export const createAdminStaffInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254).transform((v) => v.toLowerCase()),
  mobile: z.string().trim().min(8).max(20),
  roles: z.array(z.string().min(1)).min(1).max(10),
  temporaryPassword: z.string().min(8).max(128),
});
export type CreateAdminStaffInput = z.infer<typeof createAdminStaffInputSchema>;
export const updateAdminStaffRolesInputSchema = z.object({ roles: z.array(z.string().min(1)).min(1).max(10) });
export type UpdateAdminStaffRolesInput = z.infer<typeof updateAdminStaffRolesInputSchema>;
export const adminStaffStatusInputSchema = z.object({ active: z.boolean() });
export type AdminStaffStatusInput = z.infer<typeof adminStaffStatusInputSchema>;
export const adminStaffActionResponseSchema = adminStaffRowSchema;
export const adminStaffTwoFactorResetResponseSchema = z.object({ success: z.literal(true) });
