import { z } from 'zod';
import {
  createServiceInput,
  DEFAULT_ACCEPTED_TYPES,
  DEFAULT_MAX_UPLOAD_MB,
  type AdminServiceDetail,
  type CreateServiceInput,
  type CreateServiceRequest,
  type FileMimeType,
  type UpdateServiceInput,
} from '@biznexa/types';

/**
 * Service editor form (M2.5.9). Inputs hold what the admin types (rupees, one benefit per line…);
 * `serviceFormSchema` turns that into the API request and validates it with the API's own
 * `createServiceInput`, so the form shows exactly the rules and messages the server applies (D7).
 */

const packageRow = z.object({
  /** Existing id, or a new random UUID so documents can be limited to a package before it is saved. */
  id: z.string(),
  name: z.string(),
  professionalFee: z.string(),
  governmentFee: z.string(),
  gstRate: z.string(),
  inclusions: z.string(),
  estimatedTime: z.string(),
  isMostPopular: z.boolean(),
  allowPartial: z.boolean(),
  advancePercent: z.string(),
  isActive: z.boolean(),
  inUse: z.boolean(),
});

const documentRow = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  isMandatory: z.boolean(),
  acceptedTypes: z.array(z.string()),
  maxSizeMb: z.string(),
  packageIds: z.array(z.string()),
  inUse: z.boolean(),
});

const stageRow = z.object({ id: z.string(), name: z.string(), description: z.string(), inUse: z.boolean() });
const faqRow = z.object({ question: z.string(), answer: z.string() });

export const formValuesSchema = z.object({
  name: z.string(),
  slug: z.string(),
  categoryId: z.string(),
  subcategoryId: z.string(),
  shortDescription: z.string(),
  overview: z.string(),
  icon: z.string(),
  imageUrl: z.string(),
  benefits: z.string(),
  estimatedTime: z.string(),
  estimatedDaysMin: z.string(),
  estimatedDaysMax: z.string(),
  sacCode: z.string(),
  popularity: z.string(),
  isPopular: z.boolean(),
  isActive: z.boolean(),
  recurrence: z.string(),
  reminderOffsets: z.string(),
  seoTitle: z.string(),
  metaDescription: z.string(),
  packages: z.array(packageRow),
  documents: z.array(documentRow),
  stages: z.array(stageRow),
  faqs: z.array(faqRow),
  relatedServiceIds: z.array(z.string()),
});

export type ServiceFormValues = z.infer<typeof formValuesSchema>;
export type PackageRow = ServiceFormValues['packages'][number];
export type DocumentRow = ServiceFormValues['documents'][number];
export type StageRow = ServiceFormValues['stages'][number];

const lines = (v: string) =>
  v
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
/** Blank → null; anything that is not a number → NaN, which the API schema reports in its own words. */
const numberOrNull = (v: string) => (v.trim() === '' ? null : /^\d+$/.test(v.trim()) ? Number(v.trim()) : NaN);
/** "1,499.50" rupees → 149950 paise; blank → `blank`. */
const rupeesToPaise = (v: string, blank: number) => {
  const clean = v.replace(/[₹,\s]/g, '');
  if (clean === '') return blank;
  return /^\d+(\.\d{1,2})?$/.test(clean) ? Math.round(Number(clean) * 100) : NaN;
};
const paiseToRupees = (p: number) => (p % 100 === 0 ? String(p / 100) : (p / 100).toFixed(2));

/** Form values → the create request (also the source of every section of an update). */
export function toRequest(v: ServiceFormValues): CreateServiceRequest {
  const packageIds = new Set(v.packages.map((p) => p.id));
  return {
    name: v.name,
    slug: v.slug,
    categoryId: v.categoryId,
    subcategoryId: v.subcategoryId || null,
    shortDescription: v.shortDescription,
    overview: v.overview,
    icon: v.icon,
    imageUrl: v.imageUrl,
    benefits: lines(v.benefits),
    estimatedTime: v.estimatedTime,
    estimatedDaysMin: numberOrNull(v.estimatedDaysMin),
    estimatedDaysMax: numberOrNull(v.estimatedDaysMax),
    sacCode: v.sacCode,
    popularity: numberOrNull(v.popularity) ?? 0,
    isPopular: v.isPopular,
    isActive: v.isActive,
    recurrence: v.recurrence,
    reminderOffsets: v.recurrence ? v.reminderOffsets.split(',').map((s) => s.trim()).filter(Boolean).map((s) => numberOrNull(s) ?? NaN) : undefined,
    seoTitle: v.seoTitle,
    metaDescription: v.metaDescription,
    packages: v.packages.map((p) => ({
      id: p.id,
      name: p.name,
      professionalFee: rupeesToPaise(p.professionalFee, NaN),
      governmentFee: rupeesToPaise(p.governmentFee, 0),
      gstRate: Number(p.gstRate),
      inclusions: lines(p.inclusions),
      estimatedTime: p.estimatedTime,
      isMostPopular: p.isMostPopular,
      allowPartial: p.allowPartial,
      advancePercent: p.allowPartial ? numberOrNull(p.advancePercent) : null,
      isActive: p.isActive,
    })),
    documents: v.documents.map((d) => ({
      id: d.id || undefined,
      name: d.name,
      description: d.description,
      isMandatory: d.isMandatory,
      acceptedTypes: d.acceptedTypes as FileMimeType[],
      maxSizeMb: numberOrNull(d.maxSizeMb) ?? NaN,
      // A package removed in this edit no longer limits the document.
      packageIds: d.packageIds.filter((id) => packageIds.has(id)),
    })),
    stages: v.stages.map((s) => ({ id: s.id || undefined, name: s.name, description: s.description })),
    faqs: v.faqs,
    relatedServiceIds: v.relatedServiceIds,
  };
}

export const serviceFormSchema = formValuesSchema.transform(toRequest).pipe(createServiceInput);

export const newPackage = (name = ''): PackageRow => ({
  id: crypto.randomUUID(),
  name,
  professionalFee: '',
  governmentFee: '',
  gstRate: '18',
  inclusions: '',
  estimatedTime: '',
  isMostPopular: false,
  allowPartial: false,
  advancePercent: '',
  isActive: true,
  inUse: false,
});

export const newDocument = (): DocumentRow => ({
  id: '',
  name: '',
  description: '',
  isMandatory: true,
  acceptedTypes: [...DEFAULT_ACCEPTED_TYPES],
  maxSizeMb: String(DEFAULT_MAX_UPLOAD_MB),
  packageIds: [],
  inUse: false,
});

export const newStage = (name = ''): StageRow => ({ id: '', name, description: '', inUse: false });

/** A blank service, with the parts every service needs already started. */
export function emptyValues(): ServiceFormValues {
  return {
    name: '',
    slug: '',
    categoryId: '',
    subcategoryId: '',
    shortDescription: '',
    overview: '',
    icon: '',
    imageUrl: '',
    benefits: '',
    estimatedTime: '',
    estimatedDaysMin: '',
    estimatedDaysMax: '',
    sacCode: '',
    popularity: '0',
    isPopular: false,
    isActive: true,
    recurrence: '',
    reminderOffsets: '30, 15, 7, 1',
    seoTitle: '',
    metaDescription: '',
    packages: [newPackage('Basic')],
    documents: [],
    stages: [newStage('Application received'), newStage('Filed with the department'), newStage('Completed')],
    faqs: [],
    relatedServiceIds: [],
  };
}

const text = (v: string | null | undefined) => v ?? '';
const count = (v: number | null | undefined) => (v == null ? '' : String(v));

export function toFormValues(s: AdminServiceDetail): ServiceFormValues {
  return {
    name: s.name,
    slug: s.slug,
    categoryId: s.categoryId,
    subcategoryId: text(s.subcategoryId),
    shortDescription: s.shortDescription,
    overview: text(s.overview),
    icon: text(s.icon),
    imageUrl: text(s.imageUrl),
    benefits: s.benefits.join('\n'),
    estimatedTime: text(s.estimatedTime),
    estimatedDaysMin: count(s.estimatedDaysMin),
    estimatedDaysMax: count(s.estimatedDaysMax),
    sacCode: text(s.sacCode),
    popularity: String(s.popularity),
    isPopular: s.isPopular,
    isActive: s.isActive,
    recurrence: text(s.recurrence),
    reminderOffsets: s.reminderOffsets.join(', '),
    seoTitle: text(s.seoTitle),
    metaDescription: text(s.metaDescription),
    packages: s.packages.map((p) => ({
      id: p.id,
      name: p.name,
      professionalFee: paiseToRupees(p.professionalFee),
      governmentFee: p.governmentFee ? paiseToRupees(p.governmentFee) : '',
      gstRate: String(p.gstRate),
      inclusions: p.inclusions.join('\n'),
      estimatedTime: text(p.estimatedTime),
      isMostPopular: p.isMostPopular,
      allowPartial: p.allowPartial,
      advancePercent: count(p.advancePercent),
      isActive: p.isActive,
      inUse: p.inUse,
    })),
    documents: s.documents.map((d) => ({
      id: d.id,
      name: d.name,
      description: text(d.description),
      isMandatory: d.isMandatory,
      acceptedTypes: d.acceptedTypes,
      maxSizeMb: String(d.maxSizeMb),
      packageIds: d.packageIds,
      inUse: d.inUse,
    })),
    stages: s.stages.map((st) => ({ id: st.id, name: st.name, description: text(st.description), inUse: st.inUse })),
    faqs: s.faqs.map((f) => ({ question: f.question, answer: f.answer })),
    relatedServiceIds: s.relatedServiceIds,
  };
}

// ─────────────── Tabs and sections ───────────────

export const TABS = [
  { id: 'basic', label: 'Basic info & SEO' },
  { id: 'packages', label: 'Packages' },
  { id: 'documents', label: 'Documents' },
  { id: 'stages', label: 'Stages' },
  { id: 'faqs', label: 'FAQs' },
  { id: 'related', label: 'Related services' },
] as const;
export type TabId = (typeof TABS)[number]['id'];

/** Which tab a top-level form field lives on. */
export function tabOf(field: string): TabId {
  const top = field.split('.')[0];
  if (top === 'packages' || top === 'documents' || top === 'stages' || top === 'faqs') return top;
  if (top === 'relatedServiceIds') return 'related';
  return 'basic';
}

/**
 * Where to show an error the API returned for `field`. `prefix` is the section the request was for
 * ("packages" for `PUT …/packages`, whose body is an array). Errors inside one-per-line lists point at the list.
 */
export function toFormPath(field: string, prefix = ''): string {
  const path = prefix ? (field ? `${prefix}.${field}` : prefix) : field;
  return path
    .replace(/^(benefits|reminderOffsets|relatedServiceIds)\.\d+$/, '$1')
    .replace(/^(packages\.\d+\.inclusions)\.\d+$/, '$1')
    .replace(/^(documents\.\d+\.(?:acceptedTypes|packageIds))\.\d+$/, '$1');
}

/** The parts of an update, in the order they must be saved (documents can refer to new packages). */
export const SECTIONS = ['details', 'packages', 'documents', 'stages', 'faqs', 'related'] as const;
export type Section = (typeof SECTIONS)[number];

export function sectionOf(field: string): Section {
  const tab = tabOf(field);
  return tab === 'basic' ? 'details' : tab;
}

/** The fields of the details section (everything that `PATCH /services/:id` takes). */
export function detailsOf(input: CreateServiceInput): UpdateServiceInput {
  return Object.fromEntries(Object.entries(input).filter(([k]) => sectionOf(k) === 'details'));
}

const SECTION_KEYS: Record<Exclude<Section, 'details'>, keyof ServiceFormValues> = {
  packages: 'packages',
  documents: 'documents',
  stages: 'stages',
  faqs: 'faqs',
  related: 'relatedServiceIds',
};

/** The form keys a section saves. */
export function keysOf(section: Section): (keyof ServiceFormValues)[] {
  if (section !== 'details') return [SECTION_KEYS[section]];
  return (Object.keys(formValuesSchema.shape) as (keyof ServiceFormValues)[]).filter((k) => sectionOf(k) === 'details');
}

/** Sections whose values differ from what was loaded — the only ones an update sends. */
export function changedSections(saved: ServiceFormValues, current: ServiceFormValues): Section[] {
  const same = (k: keyof ServiceFormValues) => JSON.stringify(saved[k]) === JSON.stringify(current[k]);
  return SECTIONS.filter((s) => keysOf(s).some((k) => !same(k)));
}
