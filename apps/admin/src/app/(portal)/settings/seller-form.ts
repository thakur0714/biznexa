import { sellerSettingsInput, type BusinessAddress, type SellerSettings, type SellerSettingsInput } from '@biznexa/types';

/**
 * Seller details form (M3.14). Inputs hold what the admin types; the request is checked with the API's
 * own `sellerSettingsInput`, so the page shows the server's rules and messages (D7).
 */
export interface SellerFormValues {
  name: string;
  legalName: string;
  gstin: string;
  email: string;
  phone: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  pincode: string;
  invoicePrefix: string;
}

export type SellerFormField = keyof SellerFormValues;

/** `SellerSettings` as the generated client types it (the address's `line2` may come back as null). */
export type SavedSellerSettings = Omit<SellerSettings, 'address'> & { address: (Omit<BusinessAddress, 'line2'> & { line2?: string | null }) | null };

/** Saved settings → form; a state stored before the address existed (`PB`) preselects that state. */
export function toSellerForm(s: SavedSellerSettings): SellerFormValues {
  return {
    name: s.name ?? '',
    legalName: s.legalName ?? '',
    gstin: s.gstin ?? '',
    email: s.email ?? '',
    phone: s.phone ?? '',
    line1: s.address?.line1 ?? '',
    line2: s.address?.line2 ?? '',
    city: s.address?.city ?? '',
    state: s.address?.state ?? s.state ?? '',
    pincode: s.address?.pincode ?? '',
    invoicePrefix: s.invoicePrefix ?? '',
  };
}

export function toSellerRequest(v: SellerFormValues): SellerSettingsInput {
  return {
    name: v.name,
    legalName: v.legalName,
    gstin: v.gstin,
    email: v.email,
    phone: v.phone,
    address: { line1: v.line1, line2: v.line2, city: v.city, state: v.state, pincode: v.pincode },
    invoicePrefix: v.invoicePrefix,
  };
}

/** Request field (`address.city`) → the form input that shows its error. */
export const formFieldOf = (path: string): SellerFormField => (path.startsWith('address.') ? path.slice(8) : path.split('.')[0]) as SellerFormField;

/** Field errors for the form, keyed by input; empty when the request is valid. */
export function sellerFormErrors(v: SellerFormValues): Partial<Record<SellerFormField, string>> {
  const errors: Partial<Record<SellerFormField, string>> = {};
  for (const i of sellerSettingsInput.safeParse(toSellerRequest(v)).error?.issues ?? []) errors[formFieldOf(i.path.map(String).join('.'))] ??= i.message;
  return errors;
}
