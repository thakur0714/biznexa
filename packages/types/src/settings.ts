/**
 * Seller details (M3.14): the business that issues invoices. Stored as `Setting` rows, one key per field,
 * and read by the order summary (seller state → CGST+SGST or IGST, M3.13) and invoices (M3.21).
 * The state is not typed separately: it is the state of the registered address, stored as its name.
 */
import { z } from 'zod';
import { businessAddressSchema, gstinState, isValidGstin } from './business-entities';
import { stateName } from './states';

/** `Setting` keys holding the seller details. */
export const SELLER_SETTING_KEYS = {
  name: 'company.name',
  legalName: 'company.legalName',
  gstin: 'company.gstin',
  email: 'company.email',
  phone: 'company.phone',
  address: 'company.address',
  state: 'company.state',
  invoicePrefix: 'invoice.prefix',
} as const;
export type SellerSettingField = keyof typeof SELLER_SETTING_KEYS;

const PHONE = /^\+?[\d\s-]{8,20}$/;

const EMAIL = z.string().email();

/** Optional text: trimmed, blank means "none", and anything else must pass `valid`. */
const optional = (valid: (v: string) => boolean, message: string, upper = false) =>
  z
    .string({ invalid_type_error: 'Enter text' })
    .trim()
    .max(200, 'Use at most 200 characters')
    .transform((v) => (upper ? v.toUpperCase() : v))
    .nullish()
    .transform((v) => v || null)
    .refine((v) => v === null || valid(v), message);

/**
 * Invoice numbers look like `BN/2627/000123` (`formatInvoiceNumber`). At most 4 characters so the whole number
 * fits GST rule 46's 16; letters and digits only, as `/` already separates the parts.
 */
export const invoicePrefixSchema = z
  .string({ required_error: 'Enter the invoice prefix' })
  .trim()
  .toUpperCase()
  .min(1, 'Enter the invoice prefix')
  .max(4, 'Use at most 4 characters')
  .regex(/^[A-Z0-9]+$/, 'Use letters and digits only');

/** Body of `PUT /api/admin/settings/seller` (every field is sent each time). */
export const sellerSettingsInput = z
  .object({
    name: z.string({ required_error: 'Enter the brand name' }).trim().min(2, 'Enter the brand name').max(100),
    legalName: z.string({ required_error: 'Enter the legal name' }).trim().min(2, 'Enter the legal name').max(200),
    gstin: optional(isValidGstin, 'This is not a valid GSTIN — check each character', true),
    email: optional((v) => EMAIL.safeParse(v).success, 'Enter a valid email'),
    phone: optional((v) => PHONE.test(v), 'Enter a valid phone number'),
    address: businessAddressSchema,
    invoicePrefix: invoicePrefixSchema,
  })
  .strict()
  .superRefine((v, ctx) => {
    // zod runs this even when other fields failed; compare only a real GSTIN with a real state.
    const registered = v.gstin && isValidGstin(v.gstin) ? gstinState(v.gstin) : null;
    if (registered && stateName(v.address?.state) === v.address.state && registered !== v.address.state) {
      ctx.addIssue({ code: 'custom', path: ['gstin'], message: `This GSTIN is registered in ${registered}, not ${v.address.state}` });
    }
  });
export type SellerSettingsInput = z.input<typeof sellerSettingsInput>;
export type SellerSettingsData = z.output<typeof sellerSettingsInput>;

/** Response of `GET`/`PUT /api/admin/settings/seller`. A field never set (or stored in a form it no longer accepts) is null. */
export const sellerSettingsSchema = z.object({
  name: z.string().nullable(),
  legalName: z.string().nullable(),
  gstin: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  address: businessAddressSchema.nullable(),
  /** State name used for place of supply; from the address, or an older `company.state` row (`PB`, `03`…). */
  state: z.string().nullable(),
  invoicePrefix: z.string().nullable(),
  /** Last change to any of these keys. */
  updatedAt: z.string().datetime({ offset: true }).nullable(),
});
export type SellerSettings = z.infer<typeof sellerSettingsSchema>;

/** Stored `Setting` values → `SellerSettings`, tolerating missing keys, blanks and older spellings. */
export function readSellerSettings(values: Partial<Record<string, unknown>>, updatedAt: Date | null = null): SellerSettings {
  const text = (key: string) => {
    const v = values[key];
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  };
  const address = businessAddressSchema.safeParse(values[SELLER_SETTING_KEYS.address]);
  const state = address.success ? address.data.state : stateName(text(SELLER_SETTING_KEYS.state));
  return {
    name: text(SELLER_SETTING_KEYS.name),
    legalName: text(SELLER_SETTING_KEYS.legalName),
    gstin: text(SELLER_SETTING_KEYS.gstin),
    email: text(SELLER_SETTING_KEYS.email),
    phone: text(SELLER_SETTING_KEYS.phone),
    address: address.success ? address.data : null,
    state,
    invoicePrefix: text(SELLER_SETTING_KEYS.invoicePrefix),
    updatedAt: updatedAt?.toISOString() ?? null,
  };
}

/** Document rejection presets (M4.9). */
export const REJECTION_PRESETS_KEY = 'rejection.presets';

/** Body of `PUT /api/admin/settings/rejection-presets` */
export const rejectionPresetsInput = z
  .array(z.string({ invalid_type_error: 'Enter a valid preset' }).trim().min(1, 'Preset cannot be empty').max(200, 'Use at most 200 characters'))
  .max(50, 'Use at most 50 presets')
  .refine((items) => new Set(items).size === items.length, 'Presets must be unique');

export type RejectionPresetsInput = z.infer<typeof rejectionPresetsInput>;

/** Response of `GET`/`PUT /api/admin/settings/rejection-presets`. */
export const rejectionPresetsSchema = z.object({
  presets: z.array(z.string()),
  updatedAt: z.string().datetime({ offset: true }).nullable(),
});

export type RejectionPresets = z.infer<typeof rejectionPresetsSchema>;

/** Mobile app minimum supported version */
export const MOBILE_VERSION_KEY = 'mobile.minSupportedVersion';

export const mobileVersionInput = z.object({
  minSupportedVersion: z.string().trim().regex(/^\d+(\.\d+){0,2}$/, 'Enter a valid version number (e.g. 1.0.0)')
});
export type MobileVersionInput = z.infer<typeof mobileVersionInput>;

export const mobileVersionSchema = z.object({
  minSupportedVersion: z.string(),
  updatedAt: z.string().datetime({ offset: true }).nullable(),
});
export type MobileVersion = z.infer<typeof mobileVersionSchema>;

/** `SellerSettingsData` → the value stored under each key (blanks as `''`, like the seed). */
export function sellerSettingValues(d: SellerSettingsData): Record<string, unknown> {
  return {
    [SELLER_SETTING_KEYS.name]: d.name,
    [SELLER_SETTING_KEYS.legalName]: d.legalName,
    [SELLER_SETTING_KEYS.gstin]: d.gstin ?? '',
    [SELLER_SETTING_KEYS.email]: d.email ?? '',
    [SELLER_SETTING_KEYS.phone]: d.phone ?? '',
    [SELLER_SETTING_KEYS.address]: d.address,
    [SELLER_SETTING_KEYS.state]: d.address.state,
    [SELLER_SETTING_KEYS.invoicePrefix]: d.invoicePrefix,
  };
}
