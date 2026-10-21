/**
 * A customer's saved businesses (M3.7). One customer can own many; they are reused to prefill
 * application forms (M3.9) and carry the buyer GSTIN and state for invoices.
 *
 * Formats are checked in full, not just by pattern: a GSTIN's check character, its state code and the
 * PAN inside it; a PAN's 4th letter against the type of business; a CIN for companies, an LLPIN for LLPs.
 */
import { z } from 'zod';
import { OPTION_SOURCES } from './form-schema';

export const ENTITY_TYPES = [
  { value: 'PROPRIETORSHIP', label: 'Sole proprietorship' },
  { value: 'PARTNERSHIP', label: 'Partnership firm' },
  { value: 'LLP', label: 'Limited Liability Partnership (LLP)' },
  { value: 'PRIVATE_LIMITED', label: 'Private Limited Company' },
  { value: 'OPC', label: 'One Person Company (OPC)' },
  { value: 'PUBLIC_LIMITED', label: 'Public Limited Company' },
  { value: 'SECTION_8', label: 'Section 8 company' },
  { value: 'TRUST_SOCIETY', label: 'Trust or society' },
  { value: 'HUF', label: 'Hindu Undivided Family (HUF)' },
  { value: 'OTHER', label: 'Other' },
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number]['value'];
const ENTITY_TYPE_VALUES = ENTITY_TYPES.map((t) => t.value) as [EntityType, ...EntityType[]];

/** A customer may save at most this many businesses. */
export const MAX_BUSINESS_ENTITIES = 50;

const COMPANY_TYPES = new Set<EntityType>(['PRIVATE_LIMITED', 'OPC', 'PUBLIC_LIMITED', 'SECTION_8']);

/**
 * 4th letter of a PAN (holder status) each type of business may have. P = person (a proprietorship
 * uses the owner's PAN), C = company, F = firm/LLP, H = HUF, T = trust, A = association of persons
 * (most societies). OTHER is not checked.
 */
const PAN_HOLDER: Partial<Record<EntityType, { letters: string; name: string }>> = {
  PROPRIETORSHIP: { letters: 'P', name: "a proprietorship (the owner's PAN)" },
  PARTNERSHIP: { letters: 'F', name: 'a partnership firm' },
  LLP: { letters: 'F', name: 'an LLP' },
  PRIVATE_LIMITED: { letters: 'C', name: 'a company' },
  OPC: { letters: 'C', name: 'a company' },
  PUBLIC_LIMITED: { letters: 'C', name: 'a company' },
  SECTION_8: { letters: 'C', name: 'a company' },
  HUF: { letters: 'H', name: 'an HUF' },
  TRUST_SOCIETY: { letters: 'TA', name: 'a trust or society' },
};

/** GST state codes → state names as in `OPTION_SOURCES.states`. 97 (other territory) and 99 (centre) have none. */
export const GST_STATE_CODES: Record<string, (typeof OPTION_SOURCES.states)[number]> = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand',
  '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim',
  '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya',
  '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh',
  '24': 'Gujarat', '25': 'Dadra and Nagar Haveli and Daman and Diu', '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra', '28': 'Andhra Pradesh', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala',
  '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman and Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh',
  '38': 'Ladakh',
};
const OTHER_GST_CODES = new Set(['97', '99']);

const PAN = /^[A-Z]{5}\d{4}[A-Z]$/;
const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const CIN = /^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/;
const LLPIN = /^[A-Z]{3}-\d{4}$/;
const PINCODE = /^[1-9]\d{5}$/;
const GST_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

type BusinessEntityValues = {
  entityType: EntityType;
  pan: string | null;
  gstin: string | null;
  cin: string | null;
  address?: { state: string } | null;
  state?: string | null;
};
type AddEntityIssue = (path: string, message: string) => void;

function validatePanForEntity(v: BusinessEntityValues, issue: AddEntityIssue): void {
  const holder = PAN_HOLDER[v.entityType];
  if (v.pan && PAN.test(v.pan) && holder && !holder.letters.includes(v.pan[3])) {
    issue('pan', `The 4th letter of the PAN of ${holder.name} is ${holder.letters.split('').join(' or ')}`);
  }
}

function validateGstinForEntity(v: BusinessEntityValues, issue: AddEntityIssue): void {
  if (!v.gstin || !isValidGstin(v.gstin)) return;
  if (v.pan && v.gstin.slice(2, 12) !== v.pan) issue('gstin', 'This GSTIN belongs to a different PAN');
  const registered = gstinState(v.gstin);
  const given = v.address?.state ?? v.state;
  if (registered && given && registered !== given) issue('gstin', `This GSTIN is registered in ${registered}, not ${given}`);
}

function validateEntityState(v: BusinessEntityValues, issue: AddEntityIssue): void {
  if (v.address && v.state && v.address.state !== v.state) issue('state', 'The state does not match the address');
}

function validateCinForEntity(v: BusinessEntityValues, issue: AddEntityIssue): void {
  if (!v.cin) return;
  if (v.entityType === 'LLP') {
    if (!LLPIN.test(v.cin)) issue('cin', 'Enter an LLPIN like AAB-1234');
  } else if (COMPANY_TYPES.has(v.entityType)) {
    if (!CIN.test(v.cin)) issue('cin', 'Enter a 21-character CIN like U74999PB2020PTC012345');
  } else {
    issue('cin', 'Only companies have a CIN and LLPs an LLPIN — leave this blank');
  }
}

/** The 15th character of a GSTIN, computed from the first 14 (GSTN's mod-36 checksum). */
export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const product = GST_CHARS.indexOf(first14[i]) * (i % 2 ? 2 : 1);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GST_CHARS[(36 - (sum % 36)) % 36];
}

export const isValidGstin = (v: string) => GSTIN.test(v) && gstinCheckChar(v.slice(0, 14)) === v[14] && (v.slice(0, 2) in GST_STATE_CODES || OTHER_GST_CODES.has(v.slice(0, 2)));

/** State a GSTIN is registered in, or null for codes 97/99 and invalid input. */
export const gstinState = (gstin: string) => GST_STATE_CODES[gstin.slice(0, 2)] ?? null;

/** `ABCDE1234F` → `ABCDE****F` for lists and logs. */
export const maskPan = (pan: string) => `${pan.slice(0, 5)}****${pan.slice(9)}`;

/** Optional ID: trimmed, capitalised, and blank means "none". */
const id = (max: number) =>
  z
    .string({ invalid_type_error: 'Enter text' })
    .trim()
    .toUpperCase()
    .max(max, `Use at most ${max} characters`)
    .nullish()
    .transform((v) => v || null);

const STATES = new Set<string>(OPTION_SOURCES.states);
const state = z.string({ invalid_type_error: 'Choose the state' }).refine((v) => STATES.has(v), 'Choose the state');

export const businessAddressSchema = z
  .object({
    line1: z.string().trim().min(1, 'Enter the address').max(200),
    line2: z.string().trim().max(200).nullish().transform((v) => v || undefined),
    city: z.string().trim().min(1, 'Enter the city').max(100),
    state,
    pincode: z.string().trim().regex(PINCODE, 'Enter a valid 6-digit PIN code'),
  })
  .strict();
export type BusinessAddress = z.infer<typeof businessAddressSchema>;

/**
 * Body of `POST /api/business-entities` and `PUT /api/business-entities/{id}` (the whole business is
 * sent each time). `state` may be left out: it is taken from the address, else from the GSTIN.
 */
export const businessEntityInput = z
  .object({
    legalName: z.string({ required_error: 'Enter the legal name' }).trim().min(2, 'Enter the legal name').max(200),
    entityType: z.enum(ENTITY_TYPE_VALUES, { errorMap: () => ({ message: 'Choose the type of business' }) }),
    pan: id(10).refine((v) => !v || PAN.test(v), 'Enter a PAN like ABCDE1234F'),
    gstin: id(15).refine((v) => !v || isValidGstin(v), 'This is not a valid GSTIN — check each character'),
    cin: id(21),
    address: businessAddressSchema.nullish().transform((v) => v ?? null),
    state: state.nullish().transform((v) => v ?? null),
  })
  .strict()
  .superRefine((v, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    validatePanForEntity(v, issue);
    validateGstinForEntity(v, issue);
    validateEntityState(v, issue);
    validateCinForEntity(v, issue);
  })
  .transform((v) => ({ ...v, state: v.address?.state ?? v.state ?? (v.gstin ? gstinState(v.gstin) : null) }));
export type BusinessEntityInput = z.input<typeof businessEntityInput>;
export type BusinessEntityData = z.output<typeof businessEntityInput>;

export const businessEntitySchema = z.object({
  id: z.string().uuid(),
  legalName: z.string(),
  entityType: z.enum(ENTITY_TYPE_VALUES),
  pan: z.string().nullable(),
  gstin: z.string().nullable(),
  cin: z.string().nullable(),
  address: businessAddressSchema.nullable(),
  state: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type BusinessEntity = z.infer<typeof businessEntitySchema>;

export const businessEntityListSchema = z.object({ items: z.array(businessEntitySchema) });
export type BusinessEntityList = z.infer<typeof businessEntityListSchema>;
