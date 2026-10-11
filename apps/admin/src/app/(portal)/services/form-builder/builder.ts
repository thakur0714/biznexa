/**
 * Form builder logic (M3.4): the admin edits the form as JSON text; everything else — the outline,
 * the preview, the problems list — is derived from that text. Outline actions edit the parsed JSON and
 * write it back as text, so the JSON stays the single source of truth.
 */
import {
  DEFAULT_ACCEPTED_TYPES,
  DEFAULT_MAX_UPLOAD_MB,
  formSchema,
  type FormField,
  type FormFieldType,
  type FormSchema,
  type FormSchemaInput,
} from '@biznexa/types';

export type Path = (string | number)[];

export interface FormIssue {
  path: Path;
  message: string;
  /** Where in the form, in words: `Step 2 “Directors” › “PAN” › pattern`. */
  where: string;
  /** Character offset in the JSON text of the closest thing the path points at. */
  offset: number;
  line: number;
}

export type ParsedForm =
  | { kind: 'syntax'; message: string; offset: number; line: number; column: number }
  | { kind: 'invalid'; raw: unknown; issues: FormIssue[] }
  | { kind: 'valid'; raw: unknown; form: FormSchema };

export const toJson = (value: unknown) => JSON.stringify(value, null, 2);

export function lineOf(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) if (text[i] === '\n') line++;
  return line;
}

/** Reads a position out of the engine's JSON.parse message (V8: "at position 42 (line 3 column 5)"; Firefox: "at line 3 column 5"). */
function syntaxError(text: string, err: unknown): ParsedForm {
  const raw = err instanceof Error ? err.message : String(err);
  let offset = text.length;
  const pos = /at position (\d+)/.exec(raw);
  const lc = /line (\d+) column (\d+)/.exec(raw);
  if (pos) offset = Number(pos[1]);
  else if (lc) {
    const lines = text.split('\n');
    offset = lines.slice(0, Number(lc[1]) - 1).reduce((n, l) => n + l.length + 1, 0) + Number(lc[2]) - 1;
  }
  offset = Math.min(offset, text.length);
  const line = lineOf(text, offset);
  const column = offset - text.lastIndexOf('\n', offset - 1);
  const message = raw
    .replace(/^JSON\.parse: /, '')
    .replace(/\s*(in JSON )?at (position \d+|line \d+ column \d+).*$/s, '')
    .replace(/^Unexpected end of JSON input$/, 'The JSON ends too early — a bracket or quote is probably missing');
  return { kind: 'syntax', message: message || 'This is not valid JSON', offset, line, column };
}

export function parseFormText(text: string): ParsedForm {
  if (!text.trim()) return { kind: 'syntax', message: 'Enter the form as JSON', offset: 0, line: 1, column: 1 };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return syntaxError(text, err);
  }
  const res = formSchema.safeParse(raw);
  if (res.success) return { kind: 'valid', raw, form: res.data };
  return { kind: 'invalid', raw, issues: res.error.issues.map((i) => issueAt(text, raw, i.path, i.message)) };
}

export function issueAt(text: string, raw: unknown, path: Path, message: string): FormIssue {
  const offset = locateNearest(text, path);
  return { path, message, where: describePath(raw, path), offset, line: lineOf(text, offset) };
}

/** Field errors from the API (`schema.steps.0.fields.1.name`) as issues on the text. */
export function serverIssues(text: string, raw: unknown, errors: { field: string; message: string }[]): FormIssue[] {
  return errors.map((e) => {
    const path = e.field
      .split('.')
      .filter((s, i) => !(i === 0 && s === 'schema') && s !== '')
      .map((s) => (/^\d+$/.test(s) ? Number(s) : s));
    return issueAt(text, raw, path, e.message);
  });
}

// ─────────────── Locating a path in the text ───────────────

/**
 * Offset of the value at `path` in valid JSON `text` (for an object member, the offset of its key), or
 * null if the path does not exist. A small recursive-descent walk; the text has already parsed.
 */
export function locate(text: string, path: Path): number | null {
  let i = 0;
  const ws = () => {
    while (i < text.length && /\s/.test(text[i])) i++;
  };
  const skipString = () => {
    i++;
    while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
    i++;
  };
  const skipValue = (): void => {
    ws();
    const open = text[i];
    if (open === '"') return skipString();
    if (open !== '{' && open !== '[') {
      while (i < text.length && !/[\s,\]}]/.test(text[i])) i++;
      return;
    }
    const close = open === '{' ? '}' : ']';
    i++;
    ws();
    if (text[i] === close) return void i++;
    for (;;) {
      if (open === '{') {
        ws();
        skipString();
        ws();
        i++; // ':'
      }
      skipValue();
      ws();
      if (text[i++] !== ',') return;
    }
  };
  const descend = (depth: number): number | null => {
    ws();
    if (depth === path.length) return i;
    const key = path[depth];
    const open = text[i];
    if (open === '{') {
      i++;
      for (;;) {
        ws();
        if (text[i] !== '"') return null;
        const keyAt = i;
        skipString();
        const name = JSON.parse(text.slice(keyAt, i)) as string;
        ws();
        i++; // ':'
        if (name === String(key)) return depth + 1 === path.length ? keyAt : descend(depth + 1);
        skipValue();
        ws();
        if (text[i++] !== ',') return null;
      }
    }
    if (open === '[' && typeof key === 'number') {
      i++;
      for (let index = 0; ; index++) {
        ws();
        if (text[i] === ']') return null;
        if (index === key) return descend(depth + 1);
        skipValue();
        ws();
        if (text[i++] !== ',') return null;
      }
    }
    return null;
  };
  try {
    return descend(0);
  } catch {
    return null;
  }
}

/** Offset of the deepest part of `path` that exists (a missing `label` points at its field). */
export function locateNearest(text: string, path: Path): number {
  for (let n = path.length; n >= 0; n--) {
    const at = locate(text, path.slice(0, n));
    if (at !== null) return at;
  }
  return 0;
}

// ─────────────── Describing a path in words ───────────────

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const quoted = (v: unknown) => (typeof v === 'string' && v.trim() ? `“${v.trim()}”` : '');

export function describePath(raw: unknown, path: Path): string {
  const parts: string[] = [];
  let node: unknown = raw;
  path.forEach((seg, k) => {
    const parent = path[k - 1];
    const next = isRecord(node) || Array.isArray(node) ? (node as Record<string | number, unknown>)[seg] : undefined;
    if (seg === 'steps' || seg === 'fields') {
      // Named by the item that follows.
    } else if (typeof seg === 'number' && parent === 'steps') {
      parts.push(`Step ${seg + 1}${isRecord(next) && quoted(next.title) ? ` ${quoted(next.title)}` : ''}`);
    } else if (typeof seg === 'number' && parent === 'fields') {
      parts.push(isRecord(next) ? quoted(next.label) || quoted(next.name) || `Field ${seg + 1}` : `Field ${seg + 1}`);
    } else if (typeof seg === 'number') {
      parts.push(`item ${seg + 1}`);
    } else {
      parts.push(seg);
    }
    node = next;
  });
  if (path[path.length - 1] === 'steps') parts.push('steps');
  if (path[path.length - 1] === 'fields') parts.push('fields');
  return parts.join(' › ') || 'Form';
}

// ─────────────── Outline ───────────────

export interface OutlineField {
  index: number;
  path: Path;
  type: string;
  name: string;
  label: string;
  required: boolean;
  showIf: string | null;
  /** Sub-fields of a repeater. */
  fields?: OutlineField[];
}

export interface OutlineStep {
  index: number;
  path: Path;
  title: string;
  description: string;
  fields: OutlineField[];
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');

function describeCondition(c: unknown): string | null {
  if (!isRecord(c)) return null;
  const f = str(c.field) || '?';
  if ('equals' in c) return `${f} is ${JSON.stringify(c.equals)}`;
  if ('oneOf' in c && Array.isArray(c.oneOf)) return `${f} is one of ${c.oneOf.map((v) => JSON.stringify(v)).join(', ')}`;
  if ('filled' in c) return c.filled ? `${f} is filled in` : `${f} is empty`;
  return null;
}

function outlineField(f: unknown, index: number, path: Path): OutlineField {
  const o = isRecord(f) ? f : {};
  const sub = o.type === 'repeater' && Array.isArray(o.fields) ? o.fields.map((s, i) => outlineField(s, i, [...path, 'fields', i])) : undefined;
  return { index, path, type: str(o.type) || '?', name: str(o.name), label: str(o.label), required: o.required === true, showIf: describeCondition(o.showIf), fields: sub };
}

/** Steps and fields as the outline shows them, or null if the JSON is not shaped like a form. */
export function outlineOf(raw: unknown): OutlineStep[] | null {
  if (!isRecord(raw) || !Array.isArray(raw.steps)) return null;
  if (!raw.steps.every((s) => isRecord(s) && Array.isArray(s.fields))) return null;
  return raw.steps.map((s: Record<string, unknown>, si) => ({
    index: si,
    path: ['steps', si],
    title: str(s.title),
    description: str(s.description),
    fields: (s.fields as unknown[]).map((f, fi) => outlineField(f, fi, ['steps', si, 'fields', fi])),
  }));
}

type RawForm = { steps: { fields: Record<string, unknown>[]; [k: string]: unknown }[]; [k: string]: unknown };

/** Runs `fn` on a deep copy of an outline-shaped form (callers check `outlineOf` first). */
function edit(raw: unknown, fn: (form: RawForm) => void): unknown {
  const copy = structuredClone(raw) as RawForm;
  fn(copy);
  return copy;
}

/** The list holding a field: a step's fields, or a repeater's sub-fields when `parent` is given. */
function listOf(form: RawForm, step: number, parent?: number): Record<string, unknown>[] {
  const fields = form.steps[step].fields;
  return parent === undefined ? fields : (fields[parent].fields as Record<string, unknown>[]);
}

const swap = <T>(list: T[], a: number, b: number) => ([list[a], list[b]] = [list[b], list[a]]);

export function moveStep(raw: unknown, from: number, to: number): unknown {
  return edit(raw, (f) => swap(f.steps, from, to));
}

export function removeStep(raw: unknown, index: number): unknown {
  return edit(raw, (f) => void f.steps.splice(index, 1));
}

export function addStep(raw: unknown): unknown {
  return edit(raw, (f) => {
    f.steps.push({ title: `Step ${f.steps.length + 1}`, fields: [fieldTemplate('text', uniqueName(f, 'text'))] });
  });
}

/**
 * Moves a field one place up (-1) or down (+1). A top-level field at the edge of its step moves into
 * the previous or next step; a repeater sub-field stays inside its repeater.
 */
export function moveField(raw: unknown, step: number, index: number, dir: -1 | 1, parent?: number): unknown {
  return edit(raw, (f) => {
    const list = listOf(f, step, parent);
    const to = index + dir;
    if (to >= 0 && to < list.length) return swap(list, index, to);
    if (parent !== undefined) return;
    const target = f.steps[step + dir];
    if (!target) return;
    const [moved] = list.splice(index, 1);
    if (dir < 0) target.fields.push(moved);
    else target.fields.unshift(moved);
  });
}

export function removeField(raw: unknown, step: number, index: number, parent?: number): unknown {
  return edit(raw, (f) => void listOf(f, step, parent).splice(index, 1));
}

export function addField(raw: unknown, step: number, type: FormFieldType, parent?: number): unknown {
  return edit(raw, (f) => {
    listOf(f, step, parent).push(fieldTemplate(type, uniqueName(f, NAME_BASE[type])));
  });
}

/** Can the field at `index` move in `dir`? (Across steps for top-level fields.) */
export function canMoveField(steps: OutlineStep[], step: number, index: number, dir: -1 | 1, parent?: number): boolean {
  const count = parent === undefined ? steps[step].fields.length : (steps[step].fields[parent].fields?.length ?? 0);
  const to = index + dir;
  if (to >= 0 && to < count) return true;
  return parent === undefined && !!steps[step + dir];
}

// ─────────────── Templates ───────────────

export const FIELD_TYPE_LABELS: Record<FormFieldType, string> = {
  text: 'Short text',
  textarea: 'Long text',
  email: 'Email',
  tel: 'Phone number',
  number: 'Number',
  date: 'Date',
  select: 'Dropdown',
  'multi-select': 'Multiple choice',
  file: 'File upload',
  address: 'Address',
  repeater: 'Repeating group',
};

const NAME_BASE: Record<FormFieldType, string> = {
  text: 'text',
  textarea: 'details',
  email: 'email',
  tel: 'phone',
  number: 'number',
  date: 'date',
  select: 'choice',
  'multi-select': 'choices',
  file: 'file',
  address: 'address',
  repeater: 'items',
};

function allNames(form: RawForm): Set<string> {
  const names = new Set<string>();
  const add = (fields: unknown) => {
    if (!Array.isArray(fields)) return;
    for (const f of fields) {
      if (!isRecord(f)) continue;
      if (typeof f.name === 'string') names.add(f.name);
      add(f.fields);
    }
  };
  for (const s of form.steps) add(s.fields);
  return names;
}

function uniqueName(form: RawForm, base: string): string {
  const names = allNames(form);
  if (!names.has(base)) return base;
  let n = 2;
  while (names.has(`${base}${n}`)) n++;
  return `${base}${n}`;
}

export function fieldTemplate(type: FormFieldType, name: string): Record<string, unknown> {
  const label = `New ${FIELD_TYPE_LABELS[type].toLowerCase()}`;
  switch (type) {
    case 'select':
    case 'multi-select':
      return { type, name, label, options: ['Option 1', 'Option 2'] };
    case 'repeater':
      return { type, name, label: 'New repeating group', itemLabel: 'Item', minItems: 1, fields: [{ type: 'text', name: 'name', label: 'Name', required: true }] };
    default:
      return { type, name, label };
  }
}

/** A 3-step company form with a "directors" repeater — a starting point that shows most features. */
export const EXAMPLE_FORM: FormSchemaInput = {
  steps: [
    {
      title: 'Company details',
      description: 'Tell us about the company you want to register.',
      fields: [
        { type: 'text', name: 'proposedName', label: 'Proposed company name', required: true, maxLength: 120 },
        { type: 'text', name: 'alternateName', label: 'Second choice of name', helpText: 'Used if the first name is not approved.' },
        { type: 'select', name: 'businessActivity', label: 'Main business activity', required: true, options: ['Manufacturing', 'Trading', 'Services', 'Other'] },
        { type: 'textarea', name: 'activityDetails', label: 'Describe the activity', required: true, showIf: { field: 'businessActivity', equals: 'Other' } },
        { type: 'number', name: 'authorisedCapital', label: 'Authorised capital (₹)', required: true, min: 100000, integer: true },
      ],
    },
    {
      title: 'Directors',
      description: 'A private limited company needs at least two directors.',
      fields: [
        {
          type: 'repeater',
          name: 'directors',
          label: 'Directors',
          itemLabel: 'Director',
          required: true,
          minItems: 2,
          maxItems: 15,
          fields: [
            { type: 'text', name: 'fullName', label: 'Full name (as on PAN)', required: true },
            { type: 'text', name: 'pan', label: 'PAN', required: true, pattern: '[A-Z]{5}[0-9]{4}[A-Z]', patternMessage: 'Enter a PAN like ABCDE1234F' },
            { type: 'email', name: 'email', label: 'Email', required: true },
            { type: 'tel', name: 'mobile', label: 'Mobile number', required: true },
            { type: 'select', name: 'hasDin', label: 'Already has a DIN?', required: true, options: ['Yes', 'No'] },
            { type: 'text', name: 'din', label: 'DIN', required: true, pattern: '\\d{8}', patternMessage: 'A DIN has 8 digits', showIf: { field: 'hasDin', equals: 'Yes' } },
            { type: 'file', name: 'photo', label: 'Passport-size photo', required: true, accept: ['image/jpeg', 'image/png'], maxSizeMb: 2 },
          ],
        },
      ],
    },
    {
      title: 'Registered office',
      fields: [
        { type: 'address', name: 'officeAddress', label: 'Registered office address', required: true },
        { type: 'select', name: 'premises', label: 'The office is', required: true, options: ['Owned', 'Rented'] },
        { type: 'file', name: 'rentAgreement', label: 'Rent agreement', required: true, showIf: { field: 'premises', equals: 'Rented' } },
        { type: 'file', name: 'utilityBill', label: 'Recent electricity or gas bill', required: true, helpText: 'Not older than two months.' },
      ],
    },
  ],
};

export const BLANK_FORM: FormSchemaInput = {
  steps: [{ title: 'Your details', fields: [{ type: 'text', name: 'fullName', label: 'Full name', required: true }] }],
};

// ─────────────── Compact JSON for a saved version ───────────────

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

function compactField(f: FormField): Record<string, unknown> {
  const out: Record<string, unknown> = { ...f };
  if (out.required === false) delete out.required;
  if (f.type === 'number' && !f.integer) delete out.integer;
  if (f.type === 'select' || f.type === 'multi-select') {
    if (f.options) out.options = f.options.map((o) => (o.value === o.label ? o.value : o));
  }
  if (f.type === 'file') {
    if (sameList(f.accept, DEFAULT_ACCEPTED_TYPES)) delete out.accept;
    if (f.maxSizeMb === DEFAULT_MAX_UPLOAD_MB) delete out.maxSizeMb;
    if (f.maxFiles === 1) delete out.maxFiles;
  }
  if (f.type === 'repeater') {
    if (f.itemLabel === 'Item') delete out.itemLabel;
    out.fields = f.fields.map(compactField);
  }
  return out;
}

/**
 * A saved (normalised) form without the defaults the API filled in, so the editor shows what an admin
 * would write. `formSchema.parse(compactForm(x))` gives `x` back.
 */
export function compactForm(form: FormSchema): FormSchemaInput {
  return { steps: form.steps.map((s) => ({ ...s, fields: s.fields.map(compactField) })) } as FormSchemaInput;
}
