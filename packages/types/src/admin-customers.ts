import { z } from 'zod';
import { APPLICATION_STATUSES } from './status';
import { PAYMENT_STATUSES } from './payments';

const isoDate = z.string().datetime();

export const USER_STATUSES = ['ACTIVE', 'BLOCKED', 'DEACTIVATED', 'PENDING_DELETION'] as const;
export const ORDER_STATUSES = ['CREATED', 'PAYMENT_PENDING', 'PARTIALLY_PAID', 'PAID', 'CANCELLED', 'REFUNDED'] as const;

export const adminCustomerListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(USER_STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type AdminCustomerListQuery = z.infer<typeof adminCustomerListQuerySchema>;

export const adminCustomerRowSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().nullable(),
  mobile: z.string().nullable(),
  status: z.enum(USER_STATUSES),
  createdAt: isoDate,
  applicationCount: z.number().int(),
});
export type AdminCustomerRow = z.infer<typeof adminCustomerRowSchema>;

export const adminCustomerListResponseSchema = z.object({
  items: z.array(adminCustomerRowSchema),
  total: z.number().int(),
  page: z.number().int(),
  limit: z.number().int(),
});

export const adminCustomerDetailSchema = z.object({
  profile: z.object({
    id: z.string().uuid(),
    name: z.string(),
    email: z.string().nullable(),
    mobile: z.string().nullable(),
    status: z.enum(USER_STATUSES),
    createdAt: isoDate,
  }),
  businessEntities: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
      type: z.string(),
    })
  ),
  applications: z.array(
    z.object({
      id: z.string().uuid(),
      code: z.string(),
      status: z.enum(APPLICATION_STATUSES),
      serviceName: z.string(),
      createdAt: isoDate,
    })
  ),
  orders: z.array(
    z.object({
      id: z.string().uuid(),
      code: z.string(),
      total: z.number().int(),
      amountPaid: z.number().int(),
      status: z.enum(ORDER_STATUSES),
      createdAt: isoDate,
    })
  ),
  payments: z.array(
    z.object({
      id: z.string().uuid(),
      amount: z.number().int(),
      status: z.enum(PAYMENT_STATUSES),
      createdAt: isoDate,
    })
  ),
});
export type AdminCustomerDetail = z.infer<typeof adminCustomerDetailSchema>;
