'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { conditionMet, formDataValidator, stepFieldNames, type FormData, type FormField, type FormSchema } from '@biznexa/types';
import { Button } from '../button';
import { fieldId, FormFieldInput, type FormErrors, type FormValues, type UploadFiles } from './fields';

export interface ApplicationFormProps {
  form: FormSchema;
  /** Saved answers to resume from (a draft, or a prefill from the business entity). */
  initialValues?: FormValues;
  initialStep?: number;
  /** Every change to the answers, as typed — for autosave. Hidden fields keep their answers here; the validator drops them. */
  onChange?: (values: FormValues) => void;
  onStepChange?: (step: number) => void;
  /**
   * Called with the cleaned answers once every step is valid. May return the server's own field
   * problems (path → message, e.g. `directors.1.pan`); they are shown like the form's own, on the first
   * step that has one.
   */
  onSubmit: (data: FormData) => void | FormErrors | Promise<void | FormErrors>;
  submitLabel?: string;
  uploadFiles?: UploadFiles;
  /** "Today" for date limits, as `YYYY-MM-DD` (defaults to today in India). */
  today?: string;
  /** Prefix for element ids, unique per form on the page. */
  idPrefix?: string;
}

/** Part names of an address, for error summary labels. */
const ADDRESS_PARTS: Record<string, string> = { line1: 'Address line 1', line2: 'Address line 2', city: 'City', state: 'State', pincode: 'PIN code' };

/** "Directors › Director 2 › PAN" for an issue path like `directors.1.pan`. */
export function issueLabel(form: FormSchema, path: (string | number)[]): string {
  const top = form.steps.flatMap((s) => s.fields);
  const parts: string[] = [];
  let fields: FormField[] = top;
  let current: FormField | undefined;
  for (const seg of path) {
    if (typeof seg === 'number') {
      if (current?.type === 'repeater') parts.push(`${current.itemLabel} ${seg + 1}`);
      continue;
    }
    if (current?.type === 'address') {
      parts.push(ADDRESS_PARTS[seg] ?? seg);
      break;
    }
    current = fields.find((f) => f.name === seg);
    if (!current) break;
    parts.push(current.label);
    if (current.type === 'repeater') fields = current.fields;
  }
  return parts.join(' › ');
}

/**
 * The customer-facing application form (M3.6): one step at a time with a progress indicator.
 * "Next" checks the current step and "Submit" checks everything with the same `formDataValidator`
 * the API uses; problems are listed in a summary that links to each field.
 */
export function ApplicationForm({ form, initialValues, initialStep = 0, onChange, onStepChange, onSubmit, submitLabel = 'Submit', uploadFiles, today, idPrefix = 'af' }: ApplicationFormProps) {
  const total = form.steps.length;
  const [step, setStep] = useState(() => Math.min(Math.max(initialStep, 0), total - 1));
  const [reached, setReached] = useState(step);
  const [values, setValues] = useState<FormValues>(() => initialValues ?? {});
  const [errors, setErrors] = useState<FormErrors>({});
  const [busy, setBusy] = useState(false);
  const validator = useMemo(() => formDataValidator(form, { today }), [form, today]);

  const current = Math.min(step, total - 1);
  const s = form.steps[current];
  const last = current === total - 1;

  // Move focus to the step heading after a step change, or to the summary when there are problems.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const focusNext = useRef<'heading' | 'summary' | null>(null);
  useEffect(() => {
    if (!focusNext.current) return;
    (focusNext.current === 'summary' ? summaryRef : headingRef).current?.focus();
    focusNext.current = null;
  });

  const goTo = (to: number, found: FormErrors = {}) => {
    setStep(to);
    setReached((r) => Math.max(r, to));
    setErrors(found);
    focusNext.current = Object.keys(found).length ? 'summary' : 'heading';
    onStepChange?.(to);
  };

  /** Messages for top-level fields in `names` (first message per path). */
  const validate = () => validator.safeParse(values);
  const messagesFor = (issues: { path: (string | number)[]; message: string }[], names: string[]): FormErrors => {
    const found: FormErrors = {};
    for (const i of issues) if (names.includes(String(i.path[0]))) found[i.path.join('.')] ??= i.message;
    return found;
  };

  const next = () => {
    const res = validate();
    const found = res.success ? {} : messagesFor(res.error.issues, stepFieldNames(form, current));
    if (Object.keys(found).length) {
      setErrors(found);
      focusNext.current = 'summary';
    } else goTo(current + 1);
  };

  /** Shows the first step with a problem, with only that step's messages. */
  const showIssues = (issues: { path: (string | number)[]; message: string }[]) => {
    const stepOf = (name: string) => form.steps.findIndex((st) => st.fields.some((f) => f.name === name));
    const steps = issues.map((i) => stepOf(String(i.path[0]))).filter((n) => n >= 0);
    const at = steps.length ? Math.min(...steps) : 0;
    const found = messagesFor(issues, stepFieldNames(form, at));
    if (at === current) {
      setErrors(found);
      focusNext.current = 'summary';
    } else goTo(at, found);
  };

  const submit = async () => {
    const res = validate();
    if (!res.success) return showIssues(res.error.issues);
    setBusy(true);
    try {
      const fromServer = await onSubmit(res.data);
      // Only problems on fields this form has can be shown next to a field; the caller shows the rest.
      const names = new Set(form.steps.flatMap((st) => st.fields.map((f) => f.name)));
      const issues = Object.entries(fromServer ?? {})
        .map(([path, message]) => ({ path: path.split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : p)), message }))
        .filter((i) => names.has(String(i.path[0])));
      if (issues.length) showIssues(issues);
    } finally {
      setBusy(false);
    }
  };

  const set = (name: string, value: unknown) => {
    const updated = { ...values, [name]: value };
    setValues(updated);
    onChange?.(updated);
    // A changed answer makes its own messages stale; others stay until the next check.
    setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => k !== name && !k.startsWith(`${name}.`))));
  };

  /** Focuses the control for an error, or the first control inside its group. */
  const focusField = (path: string) => {
    const el = document.getElementById(fieldId(idPrefix, path.split('.')));
    const target = el && (el.matches('input, select, textarea') ? el : el.querySelector<HTMLElement>('input, select, textarea, button'));
    target?.focus();
  };

  const problems = Object.entries(errors);
  const titleId = `${idPrefix}-step-title`;

  return (
    <form
      noValidate
      aria-labelledby={titleId}
      onSubmit={(e) => {
        e.preventDefault();
        if (busy) return;
        if (last) void submit();
        else next();
      }}
      className="rounded-lg border border-rule bg-white"
    >
      <div className="border-b border-rule px-5 py-4 sm:px-6">
        <p className="text-sm text-muted">
          Step {current + 1} of {total}
        </p>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-paper" aria-hidden>
          <div className="h-full rounded-full bg-ink transition-[width]" style={{ width: `${((current + 1) / total) * 100}%` }} />
        </div>
        {total > 1 && (
          <ol aria-label="Steps" className="mt-3 hidden flex-wrap gap-x-4 gap-y-1.5 sm:flex">
            {form.steps.map((st, i) => {
              const state = i === current ? 'current' : i <= reached ? 'visited' : 'upcoming';
              const label = (
                <>
                  <span aria-hidden className={`grid size-5 place-items-center rounded-full text-[11px] font-semibold ${state === 'current' ? 'bg-ink text-white' : state === 'visited' ? 'bg-ink-050 text-ink' : 'bg-paper text-muted'}`}>
                    {i < reached && i !== current ? '✓' : i + 1}
                  </span>
                  {st.title}
                </>
              );
              return (
                <li key={i} className="text-sm">
                  {state === 'visited' ? (
                    <button type="button" onClick={() => goTo(i)} className="flex items-center gap-1.5 rounded text-ink underline-offset-2 hover:underline">
                      {label}
                    </button>
                  ) : (
                    <span aria-current={state === 'current' ? 'step' : undefined} className={`flex items-center gap-1.5 ${state === 'current' ? 'font-medium text-night' : 'text-muted'}`}>
                      {label}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <div className="space-y-5 p-5 sm:p-6">
        <div>
          <h2 id={titleId} ref={headingRef} tabIndex={-1} className="text-xl font-semibold text-night outline-none">
            {s.title}
          </h2>
          {s.description && <p className="mt-1 text-sm text-muted">{s.description}</p>}
        </div>

        {problems.length > 0 && (
          <div ref={summaryRef} tabIndex={-1} role="alert" aria-labelledby={`${idPrefix}-problems`} className="rounded-md border border-danger/40 bg-danger-050 p-4 outline-none">
            <h3 id={`${idPrefix}-problems`} className="font-semibold text-danger">
              {problems.length === 1 ? 'One answer needs attention' : `${problems.length} answers need attention`}
            </h3>
            <ul className="mt-2 space-y-1 text-sm">
              {problems.map(([path, message]) => (
                <li key={path}>
                  <a
                    href={`#${fieldId(idPrefix, path.split('.'))}`}
                    className="text-danger underline underline-offset-2"
                    onClick={(e) => {
                      e.preventDefault();
                      focusField(path);
                    }}
                  >
                    {issueLabel(form, path.split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : p)))}: {message}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        {s.fields.map((f) =>
          f.showIf && !conditionMet(f.showIf, values) ? null : (
            <FormFieldInput
              key={f.name}
              field={f}
              path={[f.name]}
              value={values[f.name]}
              scope={values}
              errors={errors}
              onChange={(v) => set(f.name, v)}
              idPrefix={idPrefix}
              uploadFiles={uploadFiles}
              today={today}
            />
          ),
        )}

        <div className="flex flex-wrap items-center gap-3 border-t border-rule pt-5">
          {current > 0 && (
            <Button type="button" variant="outline" onClick={() => goTo(current - 1)}>
              Back
            </Button>
          )}
          <Button type="submit" variant="ink" className="ml-auto" disabled={busy}>
            {last ? (busy ? 'Submitting…' : submitLabel) : 'Next'}
          </Button>
        </div>
      </div>
    </form>
  );
}
