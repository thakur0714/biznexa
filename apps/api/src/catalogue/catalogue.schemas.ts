import { z } from 'zod';

// Service and category write schemas are shared with the admin editor (packages/types/src/catalogue.ts).
export {
  createServiceInput,
  documentInput,
  faqInput,
  packageInput,
  relatedServicesInput,
  stageInput,
  updateServiceInput,
  type CreateServiceInput,
} from '@biznexa/types';
import { slugSchema as slug } from '@biznexa/types';

export const listServicesQuery = z.object({
  category: z.string().optional(),
  subcategory: z.string().optional(),
  q: z.string().trim().max(100).optional(),
  minPrice: z.coerce.number().int().min(0).optional(), // rupees
  maxPrice: z.coerce.number().int().min(0).optional(), // rupees
  popular: z.enum(['true', 'false']).optional(),
  sort: z.enum(['popular', 'price_asc', 'price_desc', 'name']).default('popular'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(60).default(24),
});
export type ListServicesQuery = z.infer<typeof listServicesQuery>;

export const adminServicesQuery = z.object({
  includeInactive: z.enum(['true', 'false']).default('false').describe('true = active and inactive services (deleted ones never)'),
  categoryId: z.string().uuid().optional(),
});

export const categoryInput = z.object({
  slug,
  name: z.string().trim().min(2).max(80),
  tagline: z.string().max(160).optional(),
  description: z.string().max(2000).optional(),
  icon: z.string().max(40).optional(),
  journeyStage: z.enum(['START', 'PROTECT', 'CERTIFY', 'COMPLY', 'CONSULT', 'GROW']).optional(),
  sortOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
  seoTitle: z.string().max(70).optional(),
  metaDescription: z.string().max(170).optional(),
});

export const subcategoryInput = z.object({
  slug,
  name: z.string().trim().min(2).max(80),
  sortOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
});
