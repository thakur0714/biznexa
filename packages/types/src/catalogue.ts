/**
 * Catalogue editing rules (D7): the API validates service writes with these schemas and the admin
 * service editor (M2.5.9) builds its forms from the same fields and messages. Amounts are in paise.
 */
import { z } from 'zod';
import { DEFAULT_ACCEPTED_TYPES, DEFAULT_MAX_UPLOAD_MB, FILE_TYPES, type FileMimeType } from './uploads';

const isoDate = z.string().datetime();

export const slugSchema = z
  .string()
  .trim()
  .min(2, 'Use at least 2 characters')
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and single hyphens');

/** "Pollution NOC (Delhi)" → "pollution-noc-delhi" */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
}

/** An optional field where a blank value clears it (stored as null). */
const blankable = <T extends z.ZodTypeAny>(schema: T) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), schema.nullish());
const optionalText = (max: number) => blankable(z.string().trim().max(max, `Keep it under ${max} characters`));

const paise = z.number({ invalid_type_error: 'Enter an amount' }).int().min(0, 'Cannot be negative');
const uuid = z.string().uuid();
const wholeNumber = (max = 1_000_000) =>
  z.number({ invalid_type_error: 'Enter a whole number' }).int('Enter a whole number').min(0, 'Cannot be negative').max(max, `At most ${max}`);
const noDuplicates = (ids: string[]) => new Set(ids).size === ids.length;

export const SERVICE_RECURRENCES = ['MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'ANNUAL'] as const;
/** Icon names the website can draw for a service (apps/web/src/components/icons.tsx). */
export const SERVICE_ICONS = ['file', 'building', 'shield', 'badge', 'receipt', 'clipboard', 'stamp', 'laptop', 'people', 'search', 'rupee', 'lock'] as const;
export const MAX_RELATED_SERVICES = 12;

export const packageFields = z.object({
  /** Existing package id, or a new client-generated UUID so documents in the same save can refer to it. */
  id: uuid.optional(),
  name: z.string().trim().min(2, 'Enter a package name').max(40),
  professionalFee: paise,
  governmentFee: paise.default(0),
  gstRate: z.number().int().min(0).max(28).default(18),
  inclusions: z.array(z.string().trim().min(1).max(160)).max(30, 'At most 30 inclusions').default([]),
  estimatedTime: optionalText(60),
  isMostPopular: z.boolean().default(false),
  allowPartial: z.boolean().default(false),
  advancePercent: z.number({ invalid_type_error: 'Enter a percentage' }).int().min(10, 'Between 10% and 90%').max(90, 'Between 10% and 90%').nullish(),
  isActive: z.boolean().default(true),
});
export const packageInput = packageFields.superRefine((p, ctx) => {
  if (p.allowPartial && p.advancePercent == null) ctx.addIssue({ code: 'custom', path: ['advancePercent'], message: 'Enter the advance to collect' });
});

export const documentFields = z.object({
  id: uuid.optional(),
  name: z.string().trim().min(2, 'Enter the document name').max(120),
  description: optionalText(500),
  isMandatory: z.boolean().default(true),
  acceptedTypes: z
    .array(z.enum(Object.keys(FILE_TYPES) as [FileMimeType, ...FileMimeType[]]))
    .min(1, 'Accept at least one file type')
    .default(DEFAULT_ACCEPTED_TYPES),
  maxSizeMb: z.number({ invalid_type_error: 'Enter a size' }).int().min(1, 'Between 1 and 25 MB').max(25, 'Between 1 and 25 MB').default(DEFAULT_MAX_UPLOAD_MB),
  /** Packages this document is needed for; empty = every package. */
  packageIds: z.array(uuid).default([]),
});
export const documentInput = documentFields;

export const stageInput = z.object({
  id: uuid.optional(),
  name: z.string().trim().min(2, 'Enter the stage name').max(80),
  description: optionalText(300),
});

export const faqInput = z.object({
  question: z.string().trim().min(5, 'Write the question (at least 5 characters)').max(300),
  answer: z.string().trim().min(2, 'Write the answer').max(3000),
});

export const relatedServicesInput = z
  .array(uuid)
  .max(MAX_RELATED_SERVICES, `Pick at most ${MAX_RELATED_SERVICES} related services`)
  .refine(noDuplicates, 'A service is listed twice');

export const serviceFields = z.object({
  slug: slugSchema,
  categoryId: z.string({ required_error: 'Choose a category' }).uuid('Choose a category'),
  subcategoryId: uuid.nullish(),
  name: z.string().trim().min(2, 'Enter the service name').max(120),
  shortDescription: z.string().trim().min(10, 'Write at least 10 characters').max(300, 'Keep it under 300 characters'),
  overview: optionalText(20000),
  icon: blankable(z.enum(SERVICE_ICONS)),
  imageUrl: blankable(z.string().trim().max(500).url('Enter a full link, starting with https://')),
  benefits: z.array(z.string().trim().min(2).max(200)).max(20, 'At most 20 benefits').default([]),
  estimatedTime: optionalText(60),
  estimatedDaysMin: wholeNumber(365).nullish(),
  estimatedDaysMax: wholeNumber(365).nullish(),
  sacCode: blankable(z.string().trim().regex(/^\d{4,8}$/, 'A SAC code is 4 to 8 digits')),
  popularity: wholeNumber().default(0),
  isPopular: z.boolean().default(false),
  isActive: z.boolean().default(true),
  recurrence: blankable(z.enum(SERVICE_RECURRENCES)),
  reminderOffsets: z.array(wholeNumber(365)).max(10, 'At most 10 reminders').default([30, 15, 7, 1]),
  seoTitle: optionalText(70),
  metaDescription: optionalText(170),
});

/** Full create: a service with its packages, documents, stages, FAQs and related services in one request. */
export const createServiceInput = serviceFields.extend({
  packages: z.array(packageInput).min(1, 'Add at least one package'),
  documents: z.array(documentInput).default([]),
  stages: z.array(stageInput).min(1, 'Add at least one process stage'),
  faqs: z.array(faqInput).default([]),
  relatedServiceIds: relatedServicesInput.default([]),
});
export type CreateServiceInput = z.infer<typeof createServiceInput>;
export type CreateServiceRequest = z.input<typeof createServiceInput>;

export const updateServiceInput = serviceFields.partial();
export type UpdateServiceInput = z.infer<typeof updateServiceInput>;
export type PackageInput = z.infer<typeof packageInput>;
export type DocumentInput = z.infer<typeof documentInput>;
export type StageInput = z.infer<typeof stageInput>;
export type FaqInput = z.infer<typeof faqInput>;

/** A service with everything the editor shows (GET/POST/PATCH/PUT under /admin/catalogue/services). */
export const adminServiceDetailSchema = z.object({
  id: uuid,
  slug: z.string(),
  name: z.string(),
  categoryId: uuid,
  category: z.object({ id: uuid, slug: z.string(), name: z.string() }),
  subcategoryId: uuid.nullable(),
  shortDescription: z.string(),
  overview: z.string().nullable(),
  icon: z.string().nullable(),
  imageUrl: z.string().nullable(),
  benefits: z.array(z.string()),
  estimatedTime: z.string().nullable(),
  estimatedDaysMin: z.number().int().nullable(),
  estimatedDaysMax: z.number().int().nullable(),
  sacCode: z.string().nullable(),
  popularity: z.number().int(),
  isPopular: z.boolean(),
  isActive: z.boolean(),
  recurrence: z.enum(SERVICE_RECURRENCES).nullable(),
  reminderOffsets: z.array(z.number().int()),
  seoTitle: z.string().nullable(),
  metaDescription: z.string().nullable(),
  updatedAt: isoDate,
  packages: z.array(
    z.object({
      id: uuid,
      name: z.string(),
      professionalFee: z.number().int(),
      governmentFee: z.number().int(),
      gstRate: z.number().int(),
      inclusions: z.array(z.string()),
      estimatedTime: z.string().nullable(),
      isMostPopular: z.boolean(),
      allowPartial: z.boolean(),
      advancePercent: z.number().int().nullable(),
      isActive: z.boolean(),
      /** Orders/applications use this package: removing it only deactivates it. */
      inUse: z.boolean(),
    }),
  ),
  documents: z.array(
    z.object({
      id: uuid,
      name: z.string(),
      description: z.string().nullable(),
      isMandatory: z.boolean(),
      acceptedTypes: z.array(z.string()),
      maxSizeMb: z.number().int(),
      packageIds: z.array(uuid),
      /** Customers have uploaded against it: it cannot be removed. */
      inUse: z.boolean(),
    }),
  ),
  stages: z.array(
    z.object({
      id: uuid,
      name: z.string(),
      description: z.string().nullable(),
      sortOrder: z.number().int(),
      /** Part of an application's timeline: it cannot be removed. */
      inUse: z.boolean(),
    }),
  ),
  faqs: z.array(z.object({ question: z.string(), answer: z.string() })),
  relatedServiceIds: z.array(uuid),
});
export type AdminServiceDetail = z.infer<typeof adminServiceDetailSchema>;

/** The category segment needed to build a public service URL from a service slug. */
export const serviceCategoryLookupSchema = z.object({
  category: z.object({ slug: z.string() }),
});
export type ServiceCategoryLookup = z.infer<typeof serviceCategoryLookupSchema>;

// Public Catalogue Types
import type { PriceBreakdown } from './pricing';

export interface ServicePackage {
  id: string;
  name: string;
  professionalFee: number;
  governmentFee: number;
  gstRate: number;
  inclusions: string[];
  estimatedTime: string | null;
  isMostPopular: boolean;
  allowPartial: boolean;
  advancePercent: number | null;
  price: PriceBreakdown;
}

export interface ServiceCard {
  id: string;
  slug: string;
  name: string;
  shortDescription: string;
  icon: string | null;
  estimatedTime: string | null;
  startingPrice: number | null;
  governmentFeeFrom: number;
  popularity: number;
  isPopular: boolean;
  category: { slug: string; name: string };
  subcategory: { slug: string; name: string } | null;
}

export interface ServiceList {
  items: ServiceCard[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export interface ServiceDetail {
  id: string;
  slug: string;
  name: string;
  shortDescription: string;
  overview: string | null;
  icon: string | null;
  benefits: string[];
  estimatedTime: string | null;
  estimatedDaysMin: number | null;
  estimatedDaysMax: number | null;
  startingPrice: number | null;
  seoTitle: string | null;
  metaDescription: string | null;
  recurrence: string | null;
  category: { slug: string; name: string };
  subcategory: { slug: string; name: string } | null;
  packages: ServicePackage[];
  documents: { id: string; name: string; description: string | null; isMandatory: boolean }[];
  stages: { id: string; name: string; description: string | null; sortOrder: number }[];
  faqs: { question: string; answer: string }[];
  related: ServiceCard[];
}

export interface CategorySummary {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  description: string | null;
  icon: string | null;
  journeyStage: string | null;
  serviceCount: number;
  subcategories: { slug: string; name: string }[];
  topServices: { slug: string; name: string }[];
}
