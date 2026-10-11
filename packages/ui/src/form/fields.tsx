'use client';

import { useState, type ReactNode } from 'react';
import {
  acceptAttribute,
  conditionMet,
  DEFAULT_TEXT_MAX,
  describeFileTypes,
  fieldOptions,
  fileTypeFromName,
  isKnownFileType,
  OPTION_SOURCES,
  todayInIndia,
  type FormField,
  type FormLeafField,
} from '@biznexa/types';
import { Button } from '../button';
import { Checkbox, Field, Select, TextArea } from '../field';

/**
 * One input per application-form field type (M3.6), shared by the website's form renderer and the
 * admin form builder's preview so both show a form the same way. Values have the shapes
 * `formDataValidator` expects; errors are keyed by its issue paths (`directors.1.pan`).
 */

export type FormValues = Record<string, unknown>;
/** Messages keyed by issue path joined with dots, e.g. `businessAddress.pincode`. */
export type FormErrors = Record<string, string>;
/** Uploads chosen files and returns their `StoredFile` ids, in order. Throw an `Error` to show its message. */
export type UploadFiles = (files: File[], field: Extract<FormLeafField, { type: 'file' }>) => Promise<string[]>;

type Path = (string | number)[];

export interface FormFieldInputProps<F extends FormField = FormField> {
  field: F;
  path: Path;
  value: unknown;
  /** Values a `showIf` can see (for a repeater row: earlier top-level answers, then the row). */
  scope: FormValues;
  errors: FormErrors;
  onChange: (value: unknown) => void;
  /** Prefix for element ids, unique per form on the page. */
  idPrefix: string;
  uploadFiles?: UploadFiles;
  /** "Today" for date limits, as `YYYY-MM-DD`. */
  today?: string;
}

/** Element id of the control (or group) for a field path. Error summaries link to it. */
export const fieldId = (idPrefix: string, path: Path) => `${idPrefix}-${path.join('-')}`;
export const fieldLabel = (f: FormField) => (f.required ? f.label : `${f.label} (optional)`);
/** First message at or under `path`. */
export const errorAt = (errors: FormErrors, path: Path) => {
  const key = path.join('.');
  return errors[key] ?? Object.entries(errors).find(([k]) => k.startsWith(`${key}.`))?.[1];
};

/** A pattern that uses capital letters and never lower-case ones (PAN, GSTIN, IFSC…) only accepts capitals. */
export const capitalsOnly = (pattern?: string) => !!pattern && /A-Z/.test(pattern) && !/a-z|\\w|\./.test(pattern);

const text = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');

/** Renders the input for any field type. */
export function FormFieldInput(props: FormFieldInputProps) {
  const { field: f } = props;
  switch (f.type) {
    case 'text':
    case 'email':
    case 'tel':
      return <TextInput {...props} field={f} />;
    case 'textarea':
      return <TextAreaInput {...props} field={f} />;
    case 'number':
      return <NumberInput {...props} field={f} />;
    case 'date':
      return <DateInput {...props} field={f} />;
    case 'select':
      return <SelectInput {...props} field={f} />;
    case 'multi-select':
      return <MultiSelectInput {...props} field={f} />;
    case 'file':
      return <FileInput {...props} field={f} />;
    case 'address':
      return <AddressInput {...props} field={f} />;
    case 'repeater':
      return <RepeaterInput {...props} field={f} />;
  }
}

type Of<T extends FormField['type']> = FormFieldInputProps<Extract<FormField, { type: T }>>;

const AUTOCOMPLETE: Partial<Record<string, string>> = { email: 'email', tel: 'tel' };

export function TextInput({ field: f, path, value, errors, onChange, idPrefix }: Of<'text' | 'email' | 'tel'>) {
  const caps = capitalsOnly(f.pattern);
  return (
    <Field
      id={fieldId(idPrefix, path)}
      label={fieldLabel(f)}
      type={f.type}
      inputMode={f.type === 'tel' ? 'tel' : undefined}
      autoComplete={AUTOCOMPLETE[f.type]}
      autoCapitalize={caps ? 'characters' : undefined}
      spellCheck={caps ? false : undefined}
      placeholder={f.placeholder}
      maxLength={f.maxLength ?? DEFAULT_TEXT_MAX[f.type]}
      error={errorAt(errors, path)}
      hint={f.helpText}
      value={text(value)}
      onChange={(e) => onChange(caps ? e.target.value.toUpperCase() : e.target.value)}
    />
  );
}

export function TextAreaInput({ field: f, path, value, errors, onChange, idPrefix }: Of<'textarea'>) {
  return (
    <TextArea
      id={fieldId(idPrefix, path)}
      label={fieldLabel(f)}
      placeholder={f.placeholder}
      rows={4}
      maxLength={f.maxLength ?? DEFAULT_TEXT_MAX.textarea}
      error={errorAt(errors, path)}
      hint={f.helpText}
      value={text(value)}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/** A text box with a numeric keyboard: `type="number"` changes values on scroll and accepts "e". The validator converts the text. */
export function NumberInput({ field: f, path, value, errors, onChange, idPrefix }: Of<'number'>) {
  return (
    <Field
      id={fieldId(idPrefix, path)}
      label={fieldLabel(f)}
      type="text"
      inputMode={f.integer && (f.min == null || f.min >= 0) ? 'numeric' : 'decimal'}
      placeholder={f.placeholder}
      error={errorAt(errors, path)}
      hint={f.helpText}
      value={text(value)}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function DateInput({ field: f, path, value, errors, onChange, idPrefix, today = todayInIndia() }: Of<'date'>) {
  const bound = (b?: string) => (b === 'today' ? today : b);
  return (
    <Field
      id={fieldId(idPrefix, path)}
      label={fieldLabel(f)}
      type="date"
      min={bound(f.min)}
      max={bound(f.max)}
      error={errorAt(errors, path)}
      hint={f.helpText}
      value={text(value)}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function SelectInput({ field: f, path, value, errors, onChange, idPrefix }: Of<'select'>) {
  return (
    <Select id={fieldId(idPrefix, path)} label={fieldLabel(f)} error={errorAt(errors, path)} hint={f.helpText} value={text(value)} onChange={(e) => onChange(e.target.value)}>
      <option value="">Choose…</option>
      {fieldOptions(f).map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </Select>
  );
}

export function MultiSelectInput({ field: f, path, value, errors, onChange, idPrefix }: Of<'multi-select'>) {
  const id = fieldId(idPrefix, path);
  const chosen = Array.isArray(value) ? (value as string[]) : [];
  const options = fieldOptions(f);
  const limits = [f.minItems && `Choose at least ${f.minItems}.`, f.maxItems && `Choose at most ${f.maxItems}.`].filter(Boolean).join(' ');
  return (
    <Group id={id} legend={fieldLabel(f)} error={errorAt(errors, path)} hint={[f.helpText, limits].filter(Boolean).join(' ') || undefined}>
      <div className={options.length > 6 ? 'grid gap-x-5 gap-y-2 sm:grid-cols-2' : 'flex flex-wrap gap-x-5 gap-y-2'}>
        {options.map((o, i) => (
          <Checkbox
            key={o.value}
            id={`${id}-${i}`}
            label={o.label}
            checked={chosen.includes(o.value)}
            onChange={(e) => onChange(e.target.checked ? [...chosen, o.value] : chosen.filter((v) => v !== o.value))}
          />
        ))}
      </div>
    </Group>
  );
}

/** Checks type, size and count before anything is uploaded; returns a message or null. */
function checkFiles(f: Extract<FormLeafField, { type: 'file' }>, files: File[], already: number): string | null {
  const types = describeFileTypes(f.accept);
  if (already + files.length > f.maxFiles) return f.maxFiles === 1 ? 'Upload one file' : `Upload at most ${f.maxFiles} files`;
  for (const file of files) {
    const type = isKnownFileType(file.type) ? file.type : fileTypeFromName(file.name);
    if (!type || !f.accept.includes(type)) return `${file.name} is not a ${types} file`;
    if (file.size > f.maxSizeMb * 1024 * 1024) return `${file.name} is larger than ${f.maxSizeMb} MB`;
  }
  return null;
}

/**
 * Uploads through `uploadFiles` as soon as files are chosen; the value is the list of file ids.
 * Names are only known for files chosen on this visit — earlier ones are shown as a count.
 */
export function FileInput({ field: f, path, value, errors, onChange, idPrefix, uploadFiles }: Of<'file'>) {
  const id = fieldId(idPrefix, path);
  const ids = Array.isArray(value) ? (value as string[]) : [];
  const [names, setNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const error = problem ?? errorAt(errors, path);
  const limits = `${describeFileTypes(f.accept)}, up to ${f.maxSizeMb} MB${f.maxFiles > 1 ? `, at most ${f.maxFiles} files` : ''}.`;
  const full = ids.length >= f.maxFiles;

  const choose = async (files: File[]) => {
    if (!files.length) return;
    const bad = checkFiles(f, files, f.maxFiles === 1 ? 0 : ids.length);
    if (bad) return setProblem(bad);
    if (!uploadFiles) return setProblem('Files cannot be uploaded here');
    setProblem(null);
    setBusy(true);
    try {
      const added = await uploadFiles(files, f);
      setNames((n) => ({ ...n, ...Object.fromEntries(added.map((fid, i) => [fid, files[i]?.name ?? 'File'])) }));
      onChange(f.maxFiles === 1 ? added : [...ids, ...added]);
    } catch (e) {
      setProblem(e instanceof Error && e.message ? e.message : 'The upload failed. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-night">
        {fieldLabel(f)}
      </label>
      <input
        id={id}
        type="file"
        multiple={f.maxFiles > 1}
        accept={acceptAttribute(f.accept)}
        disabled={busy || (full && f.maxFiles > 1)}
        aria-invalid={!!error}
        aria-describedby={`${id}-hint`}
        className="block w-full text-sm text-muted file:mr-3 file:rounded-md file:border file:border-rule file:bg-white file:px-3 file:py-1.5 file:text-sm file:text-night"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          void choose(files);
        }}
      />
      <div aria-live="polite">
        {busy ? (
          <p className="mt-1 text-sm text-muted">Uploading…</p>
        ) : (
          ids.length > 0 && (
            <ul className="mt-2 space-y-1">
              {ids.map((fid, i) => (
                <li key={fid} className="flex items-center gap-2 text-sm text-night">
                  <span className="min-w-0 truncate">{names[fid] ?? `File ${i + 1} attached`}</span>
                  <Button type="button" variant="ghost" size="sm" aria-label={`Remove ${names[fid] ?? `file ${i + 1}`}`} onClick={() => onChange(ids.filter((x) => x !== fid))}>
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )
        )}
      </div>
      <p id={`${id}-hint`} className={`mt-1.5 text-sm ${error ? 'text-danger' : 'text-muted'}`}>
        {error ?? `${f.helpText ? `${f.helpText} ` : ''}${limits}`}
      </p>
    </div>
  );
}

export function AddressInput({ field: f, path, value, errors, onChange, idPrefix }: Of<'address'>) {
  const id = fieldId(idPrefix, path);
  const a = (value && typeof value === 'object' ? value : {}) as Record<string, string>;
  const part = (k: string) => ({
    id: `${id}-${k}`,
    value: a[k] ?? '',
    error: errors[[...path, k].join('.')],
    onChange: (e: { target: { value: string } }) => onChange({ ...a, [k]: e.target.value }),
  });
  return (
    <Group id={id} legend={fieldLabel(f)} error={errors[path.join('.')]} hint={f.helpText}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Address line 1" className="sm:col-span-2" autoComplete="address-line1" maxLength={200} {...part('line1')} />
        <Field label="Address line 2 (optional)" className="sm:col-span-2" autoComplete="address-line2" maxLength={200} {...part('line2')} />
        <Field label="City" autoComplete="address-level2" maxLength={100} {...part('city')} />
        <Select label="State" autoComplete="address-level1" {...part('state')}>
          <option value="">Choose…</option>
          {OPTION_SOURCES.states.map((st) => (
            <option key={st}>{st}</option>
          ))}
        </Select>
        <Field label="PIN code" inputMode="numeric" autoComplete="postal-code" maxLength={6} {...part('pincode')} />
      </div>
    </Group>
  );
}

export function RepeaterInput(props: Of<'repeater'>) {
  const { field: f, path, value, scope, errors, onChange, idPrefix } = props;
  const rows = Array.isArray(value) ? (value as FormValues[]) : [];
  const item = f.itemLabel;
  const max = f.maxItems ?? 100;
  const id = fieldId(idPrefix, path);
  const setRow = (i: number, row: FormValues) => onChange(rows.map((r, j) => (j === i ? row : r)));
  const add = () => {
    onChange([...rows, {}]);
    // Move focus to the new row so keyboard and screen-reader users land on it.
    setTimeout(() => document.getElementById(`${id}--${rows.length}`)?.focus());
  };
  const hint = [f.helpText, f.minItems ? `Add at least ${f.minItems}.` : '', f.maxItems ? `Up to ${f.maxItems}.` : ''].filter(Boolean).join(' ');
  return (
    <Group id={id} legend={fieldLabel(f)} error={errors[path.join('.')]} hint={hint || undefined}>
      <ol className="space-y-3">
        {rows.map((row, i) => {
          const rowScope = { ...scope, ...row };
          return (
            <li key={i} className="rounded-md border border-rule p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h4 id={`${id}--${i}`} tabIndex={-1} className="font-semibold outline-none">
                  {item} {i + 1}
                </h4>
                <Button type="button" variant="ghost" size="sm" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label={`Remove ${item.toLowerCase()} ${i + 1}`}>
                  Remove
                </Button>
              </div>
              <div className="space-y-4">
                {f.fields.map((sub) =>
                  sub.showIf && !conditionMet(sub.showIf, rowScope) ? null : (
                    <FormFieldInput
                      key={sub.name}
                      {...props}
                      field={sub}
                      path={[...path, i, sub.name]}
                      value={row[sub.name]}
                      scope={rowScope}
                      onChange={(v) => setRow(i, { ...row, [sub.name]: v })}
                    />
                  ),
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <Button type="button" variant="outline" size="sm" className={rows.length ? 'mt-3' : ''} disabled={rows.length >= max} onClick={add}>
        Add {item.toLowerCase()}
      </Button>
    </Group>
  );
}

/** A fieldset for fields with several controls (multi-select, address, repeater). */
function Group({ id, legend, error, hint, children }: { id: string; legend: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset id={id} aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined} aria-invalid={error ? true : undefined}>
      <legend className="mb-1.5 text-sm font-medium text-night">{legend}</legend>
      {children}
      {error ? (
        <p id={`${id}-err`} className="mt-1.5 text-sm text-danger">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="mt-1.5 text-sm text-muted">
            {hint}
          </p>
        )
      )}
    </fieldset>
  );
}
