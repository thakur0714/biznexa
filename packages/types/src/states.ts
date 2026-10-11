/**
 * Indian states and union territories for GST place of supply (M3.13). Business addresses and forms store
 * the state's name (`OPTION_SOURCES.states`); the seller's state in Settings may be typed as a name, a
 * two-letter code (`PB`) or the GST state code (`03`). `stateName` turns any of these into the name, so
 * two spellings of one state always compare equal.
 */
import { GST_STATE_CODES } from './business-entities';
import { OPTION_SOURCES } from './form-schema';

export type IndianState = (typeof OPTION_SOURCES.states)[number];

/** Common two-letter codes (vehicle / ISO-style), including older and alternative ones. */
export const STATE_ABBREVIATIONS: Record<string, IndianState> = {
  AP: 'Andhra Pradesh', AR: 'Arunachal Pradesh', AS: 'Assam', BR: 'Bihar', CG: 'Chhattisgarh', CT: 'Chhattisgarh',
  GA: 'Goa', GJ: 'Gujarat', HR: 'Haryana', HP: 'Himachal Pradesh', JH: 'Jharkhand', KA: 'Karnataka', KL: 'Kerala',
  MP: 'Madhya Pradesh', MH: 'Maharashtra', MN: 'Manipur', ML: 'Meghalaya', MZ: 'Mizoram', NL: 'Nagaland',
  OD: 'Odisha', OR: 'Odisha', PB: 'Punjab', RJ: 'Rajasthan', SK: 'Sikkim', TN: 'Tamil Nadu', TS: 'Telangana',
  TG: 'Telangana', TR: 'Tripura', UP: 'Uttar Pradesh', UK: 'Uttarakhand', UT: 'Uttarakhand', WB: 'West Bengal',
  AN: 'Andaman and Nicobar Islands', CH: 'Chandigarh', DH: 'Dadra and Nagar Haveli and Daman and Diu',
  DN: 'Dadra and Nagar Haveli and Daman and Diu', DD: 'Dadra and Nagar Haveli and Daman and Diu', DL: 'Delhi',
  JK: 'Jammu and Kashmir', LA: 'Ladakh', LD: 'Lakshadweep', PY: 'Puducherry',
};

const BY_NAME = new Map<string, IndianState>(OPTION_SOURCES.states.map((s) => [s.toLowerCase(), s]));

/** `"Punjab"`, `"punjab"`, `"PB"` and `"03"` → `"Punjab"`; anything else → null. */
export function stateName(value: string | null | undefined): IndianState | null {
  const v = value?.trim();
  if (!v) return null;
  return BY_NAME.get(v.toLowerCase()) ?? STATE_ABBREVIATIONS[v.toUpperCase()] ?? GST_STATE_CODES[v.padStart(2, '0')] ?? null;
}
