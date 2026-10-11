/**
 * Application form schema (PROMPT §4, §7.4): the JSON an admin saves per service as a versioned
 * `ServiceFormSchema`, rendered by web/mobile as a multi-step form. `formData` is one flat object
 * keyed by field name; a repeater's value is an array of row objects keyed by its own fields.
 *
 * Conventions the renderer and the form-data validator (M3.2) rely on:
 * - Field names are unique across the whole form (and within each repeater row).
 * - `showIf` may only refer to a field declared earlier — an earlier top-level field, or an earlier
 *   field in the same repeater row (which wins over a top-level field of the same name). This keeps
 *   conditions acyclic. A hidden field is neither required nor stored.
 * - `pattern` must match the whole value (it is anchored when applied).
 */
import { z } from 'zod';
import { DEFAULT_ACCEPTED_TYPES, DEFAULT_MAX_UPLOAD_MB, FILE_TYPES, type FileMimeType } from './uploads';

export const FORM_FIELD_TYPES = ['text', 'textarea', 'email', 'tel', 'number', 'date', 'select', 'multi-select', 'file', 'address', 'repeater'] as const;
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

/** Built-in option lists a select can use instead of typing the options out. */
export const OPTION_SOURCES = {
  states: [
    'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh',
    'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha',
    'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
    'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Jammu and Kashmir', 'Ladakh',
    'Lakshadweep', 'Puducherry',
  ],
} as const satisfies Record<string, readonly string[]>;
export type OptionSource = keyof typeof OPTION_SOURCES;

const FIELD_NAME = /^[A-Za-z]\w*$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const fieldName = z.string().max(64).regex(FIELD_NAME, 'Use letters, digits and _ only, starting with a letter');
const label = z.string().trim().min(1, 'Enter a label').max(200);
const optionValue = z.string().trim().min(1).max(200);
type Scalar = string | number;
const scalar = z.union([z.string().max(200), z.number()]);

/** `"Private Limited"` is shorthand for `{ value: "Private Limited", label: "Private Limited" }`. */
const option = z.union([optionValue, z.object({ value: optionValue, label }).strict()]).transform((o) => (typeof o === 'string' ? { value: o, label: o } : o));
export type FormOption = z.output<typeof option>;

/** Show the field only when an earlier field `equals` a value, is `oneOf` some values, or is (not) `filled`. On a multi-select, `equals`/`oneOf` mean "includes". */
const showIf = z.union([
  z.object({ field: fieldName, equals: scalar }).strict(),
  z.object({ field: fieldName, oneOf: z.array(scalar).min(1).max(50) }).strict(),
  z.object({ field: fieldName, filled: z.boolean() }).strict(),
]);
export type FormCondition = z.infer<typeof showIf>;

const base = {
  name: fieldName,
  label,
  helpText: z.string().trim().max(500).optional(),
  required: z.boolean().default(false),
  showIf: showIf.optional(),
};

const textOptions = {
  ...base,
  placeholder: z.string().max(200).optional(),
  minLength: z.number().int().min(0).max(10_000).optional(),
  maxLength: z.number().int().min(1).max(10_000).optional(),
  pattern: z.string().min(1).max(500).optional(),
  patternMessage: z.string().trim().max(200).optional(),
};

const dateBound = z.union([z.literal('today'), z.string().regex(ISO_DATE, 'Use YYYY-MM-DD or "today"')]);
const choice = { ...base, options: z.array(option).min(1).max(500).optional(), optionsSource: z.enum(Object.keys(OPTION_SOURCES) as [OptionSource]).optional() };

const fileType = z.enum(Object.keys(FILE_TYPES) as [FileMimeType, ...FileMimeType[]]);

const leafFields = [
  z.object({ type: z.literal('text'), ...textOptions }).strict(),
  z.object({ type: z.literal('textarea'), ...textOptions }).strict(),
  z.object({ type: z.literal('email'), ...textOptions }).strict(),
  z.object({ type: z.literal('tel'), ...textOptions }).strict(),
  z
    .object({
      type: z.literal('number'),
      ...base,
      placeholder: z.string().max(200).optional(),
      min: z.number().finite().optional(),
      max: z.number().finite().optional(),
      integer: z.boolean().default(false),
    })
    .strict(),
  z.object({ type: z.literal('date'), ...base, min: dateBound.optional(), max: dateBound.optional() }).strict(),
  z.object({ type: z.literal('select'), ...choice }).strict(),
  z
    .object({
      type: z.literal('multi-select'),
      ...choice,
      minItems: z.number().int().min(0).max(500).optional(),
      maxItems: z.number().int().min(1).max(500).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('file'),
      ...base,
      accept: z.array(fileType).min(1).default(DEFAULT_ACCEPTED_TYPES),
      maxSizeMb: z.number().positive().max(50).default(DEFAULT_MAX_UPLOAD_MB),
      maxFiles: z.number().int().min(1).max(10).default(1),
    })
    .strict(),
  /** Line 1, line 2, city, state, PIN code. */
  z.object({ type: z.literal('address'), ...base }).strict(),
] as const;

const leafField = z.discriminatedUnion('type', [...leafFields]);

/** A repeating group, e.g. "directors": each row is an object of its own fields. Repeaters do not nest. */
const repeaterField = z
  .object({
    type: z.literal('repeater'),
    ...base,
    itemLabel: z.string().trim().min(1).max(60).default('Item'),
    minItems: z.number().int().min(0).max(100).optional(),
    maxItems: z.number().int().min(1).max(100).optional(),
    fields: z.array(leafField).min(1).max(30),
  })
  .strict();

const field = z.discriminatedUnion('type', [...leafFields, repeaterField]);

const step = z
  .object({
    title: label,
    description: z.string().trim().max(500).optional(),
    fields: z.array(field).min(1, 'A step needs at least one field').max(50),
  })
  .strict();

export type FormLeafField = z.output<typeof leafField>;
export type FormRepeaterField = z.output<typeof repeaterField>;
export type FormField = z.output<typeof field>;
export type FormStep = z.output<typeof step>;

/** Options a choice field offers, from its own list or its `optionsSource`. */
export function fieldOptions(f: Extract<FormField, { type: 'select' | 'multi-select' }>): FormOption[] {
  if (f.options) return f.options;
  return f.optionsSource ? OPTION_SOURCES[f.optionsSource].map((v) => ({ value: v, label: v })) : [];
}

type Issue = { path: (string | number)[]; message: string };

const outOfOrder = (lo: number | string | undefined, hi: number | string | undefined) => lo != null && hi != null && lo > hi;

/** Format errors are reported by the field schema itself; this only catches dates like 2026-02-30. */
function isRealDate(v: string): boolean {
  if (!ISO_DATE.test(v)) return true;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** Rules that look at one field on its own. */
function checkField(f: FormField): Issue[] {
  const issues: Issue[] = [];
  const add = (path: string, message: string) => issues.push({ path: [path], message });
  switch (f.type) {
    case 'text':
    case 'textarea':
    case 'email':
    case 'tel':
      if (outOfOrder(f.minLength, f.maxLength)) add('minLength', 'Minimum length is more than the maximum');
      if (f.pattern != null) {
        try {
          new RegExp(f.pattern);
        } catch {
          add('pattern', 'Not a valid regular expression');
        }
      }
      if (f.patternMessage && f.pattern == null) add('patternMessage', 'Pattern message without a pattern');
      break;
    case 'number':
      if (outOfOrder(f.min, f.max)) add('min', 'Minimum is more than the maximum');
      break;
    case 'date':
      for (const k of ['min', 'max'] as const) {
        const v = f[k];
        if (v && v !== 'today' && !isRealDate(v)) add(k, 'Not a real date');
      }
      if (f.min !== 'today' && f.max !== 'today' && outOfOrder(f.min, f.max)) add('min', 'Earliest date is after the latest date');
      break;
    case 'select':
    case 'multi-select': {
      if (!!f.options === !!f.optionsSource) add('options', 'Give either options or optionsSource');
      const values = (f.options ?? []).map((o) => o.value);
      const dup = values.find((v, i) => values.indexOf(v) !== i);
      if (dup) add('options', `Option "${dup}" is listed twice`);
      if (f.type === 'multi-select' && outOfOrder(f.minItems, f.maxItems)) add('minItems', 'Minimum is more than the maximum');
      break;
    }
    case 'file': {
      if (new Set(f.accept).size !== f.accept.length) add('accept', 'A file type is listed twice');
      break;
    }
    case 'repeater':
      if (outOfOrder(f.minItems, f.maxItems)) add('minItems', 'Minimum is more than the maximum');
      break;
  }
  return issues;
}

/** Rules for a `showIf` pointing at `target` (an earlier field), or the reason it cannot. */
function checkCondition(cond: FormCondition, target: FormField | undefined): string | null {
  if (!target) return `"${cond.field}" is not a field declared before this one`;
  if ('filled' in cond) return null;
  if (target.type === 'file' || target.type === 'address' || target.type === 'repeater') return `A ${target.type} field can only be checked with "filled"`;
  const wanted = 'equals' in cond ? [cond.equals] : cond.oneOf;
  if (target.type === 'select' || target.type === 'multi-select') {
    const values = new Set(fieldOptions(target).map((o) => o.value));
    const bad = wanted.find((v) => typeof v !== 'string' || !values.has(v));
    return bad === undefined ? null : `"${bad}" is not an option of "${target.name}"`;
  }
  const numeric = target.type === 'number';
  if (wanted.every((v: Scalar) => (typeof v === 'number') === numeric)) return null;
  return `Compare "${target.name}" with ${numeric ? 'numbers' : 'text'}`;
}

/** The whole form definition stored in `ServiceFormSchema.schema`. */
export const formSchema = z
  .object({
    steps: z.array(step).min(1, 'A form needs at least one step').max(20),
  })
  .strict()
  .superRefine((form, ctx) => {
    const report = (path: (string | number)[], message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
    const declared = new Map<string, FormField>();

    form.steps.forEach((s, si) =>
      s.fields.forEach((f, fi) => {
        const at = ['steps', si, 'fields', fi];
        for (const i of checkField(f)) report([...at, ...i.path], i.message);
        if (f.showIf) {
          const msg = checkCondition(f.showIf, declared.get(f.showIf.field));
          if (msg) report([...at, 'showIf', 'field'], msg);
        }
        if (declared.has(f.name)) report([...at, 'name'], `Another field is already named "${f.name}"`);

        if (f.type === 'repeater') {
          const row = new Map<string, FormField>();
          f.fields.forEach((sub, ri) => {
            const subAt = [...at, 'fields', ri];
            for (const i of checkField(sub)) report([...subAt, ...i.path], i.message);
            if (sub.showIf) {
              const msg = checkCondition(sub.showIf, row.get(sub.showIf.field) ?? declared.get(sub.showIf.field));
              if (msg) report([...subAt, 'showIf', 'field'], msg);
            }
            if (row.has(sub.name)) report([...subAt, 'name'], `Another field in "${f.name}" is already named "${sub.name}"`);
            row.set(sub.name, sub);
          });
        }
        declared.set(f.name, f);
      }),
    );
  });

/** What an admin writes (option shorthands, defaults omitted). */
export type FormSchemaInput = z.input<typeof formSchema>;
/** What renderers and validators receive (options normalised, defaults filled in). */
export type FormSchema = z.output<typeof formSchema>;
