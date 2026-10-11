/**
 * Validates an application's `formData` against its form schema (M3.2). Used by the web renderer
 * (`ApplicationForm` in `packages/ui`) and by the API on autosave and final submit.
 *
 * Value shapes (what the renderer sends and what is stored):
 * - text, textarea, email, tel, date (`YYYY-MM-DD`), select → string
 * - number → number (numeric strings from inputs are accepted and converted)
 * - multi-select → string[]; file → string[] of `StoredFile` ids (the API checks they belong to the applicant)
 * - address → { line1, line2?, city, state, pincode }
 * - repeater → array of row objects keyed by the repeater's own fields
 *
 * Fields are checked in declaration order. A field whose `showIf` is false is not validated and is
 * dropped, as are unknown keys and empty optional values, so the result is exactly what to store.
 * Issue paths match form field names: `directors.1.pan`, `address.pincode`.
 */
import { z } from 'zod';
import { fieldOptions, OPTION_SOURCES, type FormCondition, type FormField, type FormLeafField, type FormSchema } from './form-schema';

export interface FormAddress {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  pincode: string;
}
/** A value of any field except a repeater (repeaters do not nest). */
export type FormLeafValue = string | number | string[] | FormAddress;
export type FormRow = Record<string, FormLeafValue>;
export type FormValue = FormLeafValue | FormRow[];
export type FormData = Record<string, FormValue>;

export interface FormDataOptions {
  /**
   * Autosave of a draft: only check that values have the right shape and size. Required fields,
   * formats, ranges, options and item counts are checked on final submit.
   */
  partial?: boolean;
  /** "Today" for date limits, as `YYYY-MM-DD`. Defaults to the current date in India (IST). */
  today?: string;
}

/** Longest value accepted when a text field sets no `maxLength`; also bounds the work a `pattern` does. */
export const DEFAULT_TEXT_MAX = { text: 500, email: 254, tel: 20, textarea: 5000 } as const;

const PINCODE = /^[1-9]\d{5}$/;
const PHONE = /^\+?\d[\d\s-]{4,16}\d$/;
const DECIMAL = /^-?\d+(\.\d+)?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const STATES = new Set<string>(OPTION_SOURCES.states);

export const todayInIndia = (now = new Date()) => new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);

/** Empty means "not answered": missing, blank text, an empty list, or an address with every part blank. */
export function isEmptyValue(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.values(v).every(isEmptyValue);
  return false;
}

/** Whether `cond` holds, given the already-cleaned values the field can see. On a multi-select, equals/oneOf mean "includes". */
export function conditionMet(cond: FormCondition, values: Record<string, unknown>): boolean {
  const v = values[cond.field];
  if ('filled' in cond) return isEmptyValue(v) !== cond.filled;
  const wanted: unknown[] = 'equals' in cond ? [cond.equals] : cond.oneOf;
  if (Array.isArray(v)) return v.some((x) => wanted.includes(x));
  return v !== undefined && wanted.includes(v);
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const trimmed = (max: number) => z.string({ invalid_type_error: 'Enter text' }).trim().max(max, `Use at most ${plural(max, 'character')}`);

function isRealDate(v: string): boolean {
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

const formatDate = (v: string) => new Date(`${v}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** Patterns are compiled once per schema and anchored so they must match the whole value. */
const patternCache = new WeakMap<object, RegExp>();
function anchored(f: { pattern?: string }): RegExp | null {
  if (!f.pattern) return null;
  let re = patternCache.get(f);
  if (!re) {
    re = new RegExp(`^(?:${f.pattern})$`);
    patternCache.set(f, re);
  }
  return re;
}

/** Schema for one non-empty answer to a leaf field. */
function leafValue(f: FormLeafField, o: Required<FormDataOptions>): z.ZodTypeAny {
  const strict = !o.partial;
  switch (f.type) {
    case 'text':
    case 'textarea':
    case 'email':
    case 'tel': {
      let s: z.ZodTypeAny = trimmed(f.maxLength ?? DEFAULT_TEXT_MAX[f.type]);
      if (!strict) return s;
      if (f.minLength) s = (s as z.ZodString).min(f.minLength, `Use at least ${plural(f.minLength, 'character')}`);
      if (f.type === 'email') s = (s as z.ZodString).email('Enter a valid email');
      if (f.type === 'tel' && !f.pattern) s = (s as z.ZodString).regex(PHONE, 'Enter a valid phone number');
      const re = anchored(f);
      if (re) s = (s as z.ZodString).regex(re, f.patternMessage ?? 'This is not in the expected format');
      return s;
    }
    case 'number': {
      let n = z.number({ invalid_type_error: 'Enter a number' }).finite('Enter a number');
      if (strict) {
        if (f.integer) n = n.int('Enter a whole number');
        if (f.min != null) n = n.min(f.min, `Enter ${f.min} or more`);
        if (f.max != null) n = n.max(f.max, `Enter ${f.max} or less`);
      }
      return z.preprocess((v) => (typeof v === 'string' && DECIMAL.test(v.trim()) ? Number(v) : v), n);
    }
    case 'date': {
      const d = z.string({ invalid_type_error: 'Enter a date' }).regex(ISO_DATE, 'Enter a date').refine(isRealDate, 'Enter a real date');
      if (!strict) return d;
      const min = f.min === 'today' ? o.today : f.min;
      const max = f.max === 'today' ? o.today : f.max;
      return d
        .refine((v) => !min || v >= min, f.min === 'today' ? 'Choose today or a later date' : `Choose ${formatDate(min ?? '')} or later`)
        .refine((v) => !max || v <= max, f.max === 'today' ? 'Date cannot be in the future' : `Choose ${formatDate(max ?? '')} or earlier`);
    }
    case 'select': {
      const s = z.string({ invalid_type_error: 'Choose an option' }).max(200);
      if (!strict) return s;
      const values = new Set(fieldOptions(f).map((x) => x.value));
      return s.refine((v) => values.has(v), 'Choose one of the listed options');
    }
    case 'multi-select': {
      const item = z.string().max(200);
      let list = z.array(item, { invalid_type_error: 'Choose options' }).max(500);
      if (!strict) return list;
      const values = new Set(fieldOptions(f).map((x) => x.value));
      if (f.minItems) list = list.min(f.minItems, `Choose at least ${f.minItems}`);
      if (f.maxItems) list = list.max(f.maxItems, `Choose at most ${f.maxItems}`);
      return list
        .refine((v) => v.every((x) => values.has(x)), 'Choose only the listed options')
        .refine((v) => new Set(v).size === v.length, 'An option is chosen twice');
    }
    case 'file': {
      const ids = z.array(z.string().uuid('Upload the file again'), { invalid_type_error: 'Upload a file' }).max(f.maxFiles, f.maxFiles === 1 ? 'Upload one file' : `Upload at most ${f.maxFiles} files`);
      return ids.refine((v) => new Set(v).size === v.length, 'A file is attached twice');
    }
    case 'address': {
      const part = (max: number) => trimmed(max).optional();
      if (!strict) return z.object({ line1: part(200), line2: part(200), city: part(100), state: part(100), pincode: part(10) });
      // A missing part is treated as blank so it gets its own message rather than zod's "Required".
      return z.object({
        line1: trimmed(200).min(1, 'Enter the address').default(''),
        line2: part(200).transform((v) => v || undefined),
        city: trimmed(100).min(1, 'Enter the city').default(''),
        state: z.string({ invalid_type_error: 'Choose the state' }).refine((v) => STATES.has(v), 'Choose the state').default(''),
        pincode: trimmed(10).min(1, 'Enter the PIN code').regex(PINCODE, 'Enter a valid 6-digit PIN code').default(''),
      });
    }
  }
}

const requiredMessage = (f: FormField) => {
  switch (f.type) {
    case 'select':
    case 'multi-select':
      return 'Choose an option';
    case 'file':
      return 'Upload a file';
    case 'repeater':
      return `Add at least one ${f.itemLabel.toLowerCase()}`;
    default:
      return 'This field is required';
  }
};

type Ctx = z.RefinementCtx;

/**
 * Validates the visible `fields` in order against `input`, writing clean values to `out`.
 * `scope` holds what conditions can see (for a repeater row: earlier top-level fields, then the row).
 */
function walk(fields: readonly FormField[], input: Record<string, unknown>, out: Record<string, unknown>, scope: Record<string, unknown>, path: (string | number)[], o: Required<FormDataOptions>, ctx: Ctx): void {
  for (const f of fields) {
    if (f.showIf && !conditionMet(f.showIf, scope)) continue;
    const raw = input[f.name];
    const at = [...path, f.name];
    if (isEmptyValue(raw)) {
      if (f.required && !o.partial) ctx.addIssue({ code: z.ZodIssueCode.custom, path: at, message: requiredMessage(f) });
      continue;
    }
    const value = f.type === 'repeater' ? rows(f, raw, scope, at, o, ctx) : parseInto(leafValue(f, o), raw, at, ctx);
    if (value !== undefined) {
      out[f.name] = value;
      scope[f.name] = value;
    }
  }
}

function parseInto(schema: z.ZodTypeAny, raw: unknown, at: (string | number)[], ctx: Ctx): unknown {
  const res = schema.safeParse(raw);
  if (res.success) return res.data;
  for (const i of res.error.issues) ctx.addIssue({ ...i, path: [...at, ...i.path] } as z.IssueData);
  return undefined;
}

function rows(f: Extract<FormField, { type: 'repeater' }>, raw: unknown, scope: Record<string, unknown>, at: (string | number)[], o: Required<FormDataOptions>, ctx: Ctx): FormRow[] | undefined {
  const issue = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: at, message });
  if (!Array.isArray(raw)) return void issue(`Add each ${f.itemLabel.toLowerCase()} as a row`);
  const item = f.itemLabel.toLowerCase();
  const max = f.maxItems ?? 100;
  if (raw.length > max) return void issue(`Add at most ${plural(max, item)}`);
  if (!o.partial && f.minItems && raw.length < f.minItems) issue(`Add at least ${plural(f.minItems, item)}`);
  return raw.map((r, i) => {
    const row: Record<string, unknown> = {};
    if (r === null || typeof r !== 'object' || Array.isArray(r)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [...at, i], message: `This ${item} is not valid` });
      return row as FormRow;
    }
    // Row fields see the top-level values declared before the repeater, then earlier fields in the row.
    walk(f.fields, r as Record<string, unknown>, row, { ...scope, ...row }, [...at, i], o, ctx);
    return row as FormRow;
  });
}

/**
 * A zod schema that validates `formData` against `form` and returns the cleaned data. Pass it to
 * `ZodPipe` in the API or `zodResolver` on the web; issue paths are field names.
 */
export function formDataValidator(form: FormSchema, options: FormDataOptions = {}): z.ZodType<FormData, z.ZodTypeDef, unknown> {
  const o: Required<FormDataOptions> = { partial: options.partial ?? false, today: options.today ?? todayInIndia() };
  const fields = form.steps.flatMap((s) => s.fields);
  return z.record(z.unknown(), { invalid_type_error: 'Form data must be an object' }).transform((input, ctx) => {
    const out: Record<string, unknown> = {};
    walk(fields, input, out, {}, [], o, ctx);
    return out as FormData;
  });
}

/** Names of the top-level fields in step `index`, e.g. to keep only the current step's errors. */
export const stepFieldNames = (form: FormSchema, index: number): string[] => form.steps[index]?.fields.map((f) => f.name) ?? [];

/** Every `StoredFile` id in cleaned `data` (file fields, including inside repeater rows), so the API can check who owns them. */
export function formFileIds(form: FormSchema, data: Record<string, unknown>): { path: (string | number)[]; id: string }[] {
  const found: { path: (string | number)[]; id: string }[] = [];
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  for (const f of form.steps.flatMap((s) => s.fields)) {
    if (f.type === 'file') ids(data[f.name]).forEach((id, i) => found.push({ path: [f.name, i], id }));
    if (f.type === 'repeater' && Array.isArray(data[f.name])) {
      (data[f.name] as unknown[]).forEach((row, r) => {
        if (!row || typeof row !== 'object') return;
        for (const sub of f.fields) if (sub.type === 'file') ids((row as Record<string, unknown>)[sub.name]).forEach((id, i) => found.push({ path: [f.name, r, sub.name, i], id }));
      });
    }
  }
  return found;
}
