import { z } from 'zod';
import { mobileSchema } from './schemas';

export const leadSourceSchema = z.enum(['service_page', 'contact', 'home', 'consultants']);

export const leadInputSchema = z.object({
  name: z.string().trim().min(2, 'Enter your name').max(100),
  mobile: mobileSchema,
  email: z.string().trim().email('Enter a valid email').optional().or(z.literal('').transform(() => undefined)),
  city: z.string().trim().max(80).optional(),
  serviceId: z.string().uuid().optional(),
  message: z.string().trim().max(1000).optional(),
  source: leadSourceSchema.default('contact'),
});
export type LeadInput = z.infer<typeof leadInputSchema>;

export const leadQuerySchema = z.object({
  q: z.string().optional(),
  source: leadSourceSchema.optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(50),
});
export type LeadQuery = z.infer<typeof leadQuerySchema>;

export const leadResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  mobile: z.string(),
  email: z.string().nullable(),
  city: z.string().nullable(),
  serviceId: z.string().nullable(),
  serviceName: z.string().nullable(),
  message: z.string().nullable(),
  source: z.string(),
  createdAt: z.string().datetime(),
});
export type LeadResponse = z.infer<typeof leadResponseSchema>;

export const leadListResponseSchema = z.object({
  items: z.array(leadResponseSchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  limit: z.number().int().min(1),
});
export type LeadListResponse = z.infer<typeof leadListResponseSchema>;
