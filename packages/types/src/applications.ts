/**
 * Starting an application (M3.8): "Continue to your details" creates a draft order and a draft
 * application for one package, optionally for one of the customer's saved businesses.
 *
 * Codes are human-readable and come from database sequences, so concurrent requests never share one:
 * orders `ORD-2026-000123` (year of creation in IST + running number), applications `BN10025`.
 * Numbers are unique, not gap-free — a rolled-back request uses one up (invoices are the gap-free ones, M3.20).
 */
import { z } from 'zod';
import type { BusinessEntity } from './business-entities';
import { canUploadDocuments } from './application-documents';
import { fieldOptions, formSchema, type FormSchema } from './form-schema';
import { APPLICATION_STATUSES, type ApplicationStatus } from './status';

/** First application number, so the first code is BN10001. */
export const FIRST_APPLICATION_NUMBER = 10001;

export const ORDER_CODE_PATTERN = /^ORD-\d{4}-\d{6,}$/;
export const APPLICATION_CODE_PATTERN = /^BN\d{5,}$/;

/** Calendar year of a moment in India (orders created at 00:30 IST on 1 Jan belong to the new year). */
export function istYear(at: Date): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', year: 'numeric' }).format(at));
}

/** `ORD-2026-000123`; numbers past 999999 keep all their digits. */
export function formatOrderCode(n: number, at: Date = new Date()): string {
  if (!Number.isSafeInteger(n) || n < 1) throw new Error('Order number must be a positive integer');
  return `ORD-${istYear(at)}-${String(n).padStart(6, '0')}`;
}

/** `BN10025` */
export function formatApplicationCode(n: number): string {
  if (!Number.isSafeInteger(n) || n < 1) throw new Error('Application number must be a positive integer');
  return `BN${n}`;
}

/** Body of `POST /api/applications`. The package decides the service; no business means "applying as an individual". */
export const createApplicationInput = z
  .object({
    packageId: z.string({ required_error: 'Choose a package' }).uuid('Choose a package'),
    businessEntityId: z
      .string()
      .uuid('Choose one of your businesses')
      .nullish()
      .transform((v) => v ?? null),
  })
  .strict();
export type CreateApplicationInput = z.input<typeof createApplicationInput>;
export type CreateApplicationData = z.output<typeof createApplicationInput>;

export const draftApplicationSchema = z.object({
  id: z.string().uuid(),
  code: z.string().regex(APPLICATION_CODE_PATTERN),
  status: z.enum(APPLICATION_STATUSES),
  serviceId: z.string().uuid(),
  packageId: z.string().uuid(),
  businessEntityId: z.string().uuid().nullable(),
  formSchemaVersion: z.number().int().positive(),
  order: z.object({
    id: z.string().uuid(),
    code: z.string().regex(ORDER_CODE_PATTERN),
    status: z.string(),
    /** Paise. Provisional: the order summary (M3.13) recomputes it with coupon and place of supply. */
    total: z.number().int(),
  }),
  createdAt: z.string().datetime(),
  /** True when an unpaid draft for the same package and business already existed and was returned instead. */
  resumed: z.boolean(),
});
export type DraftApplication = z.infer<typeof draftApplicationSchema>;

/** `GET /api/applications/:id` (M3.9): enough to render the form page and resume a draft. */
export const applicationDetailSchema = z.object({
  id: z.string().uuid(),
  code: z.string().regex(APPLICATION_CODE_PATTERN),
  status: z.enum(APPLICATION_STATUSES),
  serviceId: z.string().uuid(),
  packageId: z.string().uuid(),
  businessEntityId: z.string().uuid().nullable(),
  formSchemaVersion: z.number().int().positive(),
  formData: z.record(z.unknown()),
  /** The exact form this application was started on — the customer has no access to the admin form-schema endpoints. */
  formSchema: formSchema,
  createdAt: z.string().datetime(),
});
export type ApplicationDetail = z.infer<typeof applicationDetailSchema>;

/**
 * Body of `PATCH /api/applications/:id`: autosave of a draft's answers, loosely checked (M3.9).
 * `final: true` is the form's "Submit" step — every field is checked, not just its shape.
 */
export const updateApplicationFormInput = z.object({ formData: z.record(z.unknown()), final: z.boolean().optional() }).strict();
export type UpdateApplicationFormInput = z.infer<typeof updateApplicationFormInput>;

/** What a new draft can be prefilled from: the business it is for and the signed-in customer. */
export interface PrefillSources {
  business?:
    | (Pick<BusinessEntity, 'legalName' | 'entityType' | 'pan' | 'gstin' | 'cin'> & {
        address: { line1: string; line2?: string | null; city: string; state: string; pincode: string } | null;
      })
    | null;
  user?: { name?: string | null; email?: string | null; mobile?: string | null } | null;
}

/**
 * First answers for an empty draft (M3.9), using the field names the ready-made forms share (D32):
 * `businessName`, `entityType`, `businessPan`, `gstin`, `cin`, `businessAddress` from the business and
 * `contactName` / `contactEmail` / `contactMobile` from the account. Only top-level fields the form has,
 * of a type that can hold the value, are filled — an admin-built form that reuses a name for something
 * else is left alone. Nothing is saved until the customer changes an answer.
 */
export function prefillAnswers(form: FormSchema, { business, user }: PrefillSources): Record<string, unknown> {
  const fields = new Map(form.steps.flatMap((s) => s.fields).map((f) => [f.name, f]));
  const out: Record<string, unknown> = {};
  const put = (name: string, value: unknown, types: string[]) => {
    const f = fields.get(name);
    if (value == null || value === '' || !f || !types.includes(f.type)) return;
    // A select only takes one of its own options.
    if (f.type === 'select' && !fieldOptions(f).some((o) => o.value === value)) return;
    out[name] = value;
  };
  const TEXT = ['text', 'email', 'tel'];
  if (business) {
    put('businessName', business.legalName, TEXT);
    put('entityType', business.entityType, ['select']);
    put('businessPan', business.pan, TEXT);
    put('gstin', business.gstin, TEXT);
    put('cin', business.cin, TEXT);
    const a = business.address;
    if (a) put('businessAddress', { line1: a.line1, line2: a.line2 ?? '', city: a.city, state: a.state, pincode: a.pincode }, ['address']);
  }
  if (user) {
    put('contactName', user.name, TEXT);
    put('contactEmail', user.email, ['email', 'text']);
    if (user.mobile && /^[6-9]\d{9}$/.test(user.mobile)) put('contactMobile', user.mobile, ['tel', 'text']);
  }
  return out;
}




/** Internal notes (M4.10) */
export const internalNoteSchema = z.object({
  id: z.string().uuid(),
  applicationId: z.string().uuid(),
  content: z.string().trim().min(1),
  authorId: z.string().uuid(),
  authorName: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type InternalNote = z.infer<typeof internalNoteSchema>;

export const internalNoteListSchema = z.array(internalNoteSchema);

export const createInternalNoteInput = z.object({
  content: z.string({ required_error: 'Enter a note' }).trim().min(1, 'Note cannot be empty').max(5000, 'Use at most 5000 characters'),
}).strict();
export type CreateInternalNoteInput = z.infer<typeof createInternalNoteInput>;

export const updateInternalNoteInput = createInternalNoteInput;
export type UpdateInternalNoteInput = z.infer<typeof updateInternalNoteInput>;

/** Customer My Services list (M5.3). */
export const CUSTOMER_APPLICATION_TABS = ['active', 'completed', 'cancelled'] as const;
export type CustomerApplicationTab = (typeof CUSTOMER_APPLICATION_TABS)[number];

export const CUSTOMER_APPLICATION_NEXT_ACTIONS = ['upload_documents', 'pay_balance', 'download', 'view'] as const;
export type CustomerApplicationNextAction = (typeof CUSTOMER_APPLICATION_NEXT_ACTIONS)[number];

export const customerApplicationListQuery = z.object({
  tab: z.enum(CUSTOMER_APPLICATION_TABS).default('active'),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type CustomerApplicationListQuery = z.output<typeof customerApplicationListQuery>;

export const customerApplicationRowSchema = z.object({
  id: z.string().uuid(),
  code: z.string().regex(APPLICATION_CODE_PATTERN),
  status: z.enum(APPLICATION_STATUSES),
  statusLabel: z.string(),
  serviceName: z.string(),
  serviceSlug: z.string(),
  packageName: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  nextAction: z.enum(CUSTOMER_APPLICATION_NEXT_ACTIONS),
});
export type CustomerApplicationRow = z.infer<typeof customerApplicationRowSchema>;

export const customerApplicationListSchema = z.object({
  items: z.array(customerApplicationRowSchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  limit: z.number().int().min(1),
});
export type CustomerApplicationList = z.infer<typeof customerApplicationListSchema>;

/** Context-aware action for a customer application row (M5.3). */
export function customerNextAction(input: {
  status: ApplicationStatus;
  pendingMandatory: number;
  orderBalance: number;
}): CustomerApplicationNextAction {
  const { status, pendingMandatory, orderBalance } = input;
  if (status === 'COMPLETED' || status === 'DELIVERED') return 'download';
  if (status === 'CANCELLED' || status === 'DRAFT') return 'view';
  if (status === 'PAYMENT_PENDING') return 'pay_balance';
  if (status === 'DOCUMENTS_PENDING' || (canUploadDocuments(status) && pendingMandatory > 0)) {
    return 'upload_documents';
  }
  if (orderBalance > 0) return 'pay_balance';
  return 'view';
}


