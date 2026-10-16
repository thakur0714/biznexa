import { z } from 'zod';
import { messageSchema, messageThreadPageSchema } from './messages';
import { TICKET_STATUSES } from './status';

export const TICKET_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];
export const ticketPrioritySchema = z.enum(TICKET_PRIORITIES);

export const createTicketInput = z
  .object({
    subject: z
      .string({ required_error: 'Enter a subject' })
      .trim()
      .min(3, 'Subject must be at least 3 characters')
      .max(200, 'Subject cannot exceed 200 characters'),
    description: z
      .string({ required_error: 'Enter a description' })
      .trim()
      .min(5, 'Description must be at least 5 characters')
      .max(5000, 'Description cannot exceed 5000 characters'),
    priority: z.enum(TICKET_PRIORITIES).default('MEDIUM'),
    applicationId: z.string().uuid().optional().nullable(),
  })
  .strict();
export type CreateTicketInput = z.infer<typeof createTicketInput>;

export const customerTicketListQuery = z.object({
  status: z.enum(TICKET_STATUSES).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type CustomerTicketListQuery = z.output<typeof customerTicketListQuery>;

export const ticketSummarySchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  subject: z.string(),
  description: z.string(),
  priority: ticketPrioritySchema,
  status: z.enum(TICKET_STATUSES),
  applicationId: z.string().uuid().nullable().optional(),
  applicationCode: z.string().nullable().optional(),
  applicationService: z.string().nullable().optional(),
  assignedToId: z.string().uuid().nullable().optional(),
  assignedTo: z
    .object({
      id: z.string().uuid(),
      name: z.string(),
    })
    .nullable()
    .optional(),
  firstResponseAt: z.string().datetime().nullable(),
  resolvedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type TicketSummary = z.infer<typeof ticketSummarySchema>;

export const customerTicketListSchema = z.object({
  items: z.array(ticketSummarySchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  limit: z.number().int().min(1),
});
export type CustomerTicketListPage = z.infer<typeof customerTicketListSchema>;

export const ticketDetailSchema = ticketSummarySchema.extend({
  thread: messageThreadPageSchema,
  messages: z.array(messageSchema),
});
export type TicketDetail = z.infer<typeof ticketDetailSchema>;

export const adminTicketListQuery = z.object({
  status: z.enum(TICKET_STATUSES).optional(),
  priority: ticketPrioritySchema.optional(),
  assignee: z.string().optional(),
  q: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type AdminTicketListQuery = z.output<typeof adminTicketListQuery>;

export const adminTicketSummarySchema = ticketSummarySchema.extend({
  customerId: z.string().uuid(),
  customer: z.object({
    id: z.string().uuid(),
    name: z.string(),
    email: z.string().nullable().optional(),
    mobile: z.string().nullable().optional(),
  }),
});
export type AdminTicketSummary = z.infer<typeof adminTicketSummarySchema>;

export const adminTicketListSchema = z.object({
  items: z.array(adminTicketSummarySchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  limit: z.number().int().min(1),
});
export type AdminTicketListPage = z.infer<typeof adminTicketListSchema>;

export const adminTicketDetailSchema = adminTicketSummarySchema.extend({
  thread: messageThreadPageSchema,
  messages: z.array(messageSchema),
});
export type AdminTicketDetail = z.infer<typeof adminTicketDetailSchema>;

export const updateTicketStatusInput = z
  .object({
    status: z.enum(TICKET_STATUSES),
  })
  .strict();
export type UpdateTicketStatusInput = z.infer<typeof updateTicketStatusInput>;

export const updateTicketAssigneeInput = z
  .object({
    assignedToId: z.string().uuid().nullable(),
  })
  .strict();
export type UpdateTicketAssigneeInput = z.infer<typeof updateTicketAssigneeInput>;

export const updateTicketPriorityInput = z
  .object({
    priority: ticketPrioritySchema,
  })
  .strict();
export type UpdateTicketPriorityInput = z.infer<typeof updateTicketPriorityInput>;

export const updateTicketInput = z
  .object({
    status: z.enum(TICKET_STATUSES).optional(),
    assignedToId: z.string().uuid().nullable().optional(),
    priority: ticketPrioritySchema.optional(),
  })
  .strict();
export type UpdateTicketInput = z.infer<typeof updateTicketInput>;

export const postTicketMessageInput = z
  .object({
    body: z
      .string({ required_error: 'Enter a message' })
      .trim()
      .min(1, 'Message cannot be empty')
      .max(4000, 'Message cannot exceed 4000 characters'),
  })
  .strict();
export type PostTicketMessageInput = z.infer<typeof postTicketMessageInput>;
