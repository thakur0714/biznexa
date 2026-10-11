'use client';

import { useState } from 'react';
import { conditionMet, formDataValidator, stepFieldNames, type FormData, type FormSchema } from '@biznexa/types';
import { Button, FormFieldInput, Notice, type FormErrors as Errors, type FormValues as Values, type UploadFiles } from '@biznexa/ui';

/**
 * What a customer would see (M3.4), built from the form as it is now. Answers are checked with the
 * same `formDataValidator` the API uses, step by step and in full on the last step. Fields are drawn
 * by the same components as the website's `ApplicationForm` (M3.6); this wrapper adds the admin
 * extras (jump to any step, show what would be stored, clear answers).
 */
export function FormPreview({ form }: { form: FormSchema }) {
  const [step, setStep] = useState(0);
  const [values, setValues] = useState<Values>({});
  const [errors, setErrors] = useState<Errors>({});
  const [result, setResult] = useState<FormData | null>(null);
  // A new form (any edit) makes earlier messages stale.
  const [seen, setSeen] = useState(form);
  if (seen !== form) {
    setSeen(form);
    setErrors({});
    setResult(null);
  }

  const current = Math.min(step, form.steps.length - 1);
  const s = form.steps[current];
  const last = current === form.steps.length - 1;

  /** Validates every answer; shows the messages for fields in `only` (default: all). */
  const check = (only?: string[]) => {
    const res = formDataValidator(form).safeParse(values);
    const issues = res.success ? [] : res.error.issues;
    const found: Errors = {};
    for (const i of issues) {
      if (only && !only.includes(String(i.path[0]))) continue;
      found[i.path.join('.')] ??= i.message;
    }
    setErrors(found);
    return { ok: Object.keys(found).length === 0, data: res.success ? res.data : null, first: issues[0] ? String(issues[0].path[0]) : null };
  };

  const go = (to: number) => {
    setStep(to);
    setErrors({});
    setResult(null);
  };

  const next = () => {
    if (check(stepFieldNames(form, current)).ok) go(current + 1);
  };

  const finish = () => {
    const { ok, data, first } = check();
    if (ok) return setResult(data);
    // Show the first step with a problem, with only that step's messages.
    const at = form.steps.findIndex((st) => st.fields.some((f) => f.name === first));
    if (at >= 0 && at !== current) {
      setStep(at);
      check(stepFieldNames(form, at));
    }
  };

  const set = (name: string, value: unknown) => {
    setValues((v) => ({ ...v, [name]: value }));
    setResult(null);
    setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => k !== name && !k.startsWith(`${name}.`))));
  };

  return (
    <div className="rounded-lg border border-rule bg-white">
      <div className="border-b border-rule px-5 py-4">
        <p className="text-sm text-muted">
          Step {current + 1} of {form.steps.length}
        </p>
        <ol className="mt-2 flex flex-wrap gap-1.5" aria-label="Steps">
          {form.steps.map((st, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => go(i)}
                aria-current={i === current ? 'step' : undefined}
                className={`rounded-full px-3 py-1 text-xs font-medium ${i === current ? 'bg-ink text-white' : 'bg-paper text-muted hover:text-night'}`}
              >
                {i + 1}. {st.title}
              </button>
            </li>
          ))}
        </ol>
      </div>

      <div className="space-y-5 p-5">
        <div>
          <h3 className="text-lg font-semibold">{s.title}</h3>
          {s.description && <p className="mt-0.5 text-sm text-muted">{s.description}</p>}
        </div>
        {s.fields.map((f) =>
          f.showIf && !conditionMet(f.showIf, values) ? null : (
            <FormFieldInput key={f.name} field={f} path={[f.name]} value={values[f.name]} scope={values} errors={errors} onChange={(v) => set(f.name, v)} idPrefix="pv" uploadFiles={fakeUpload} />
          ),
        )}

        {result && (
          <Notice tone="success">
            All answers pass the form’s rules. This is what would be saved:
            <pre className="mt-2 max-h-64 overflow-auto rounded bg-white/70 p-2 text-xs text-night">{JSON.stringify(result, null, 2)}</pre>
          </Notice>
        )}
        {Object.keys(errors).length > 0 && (
          <p role="alert" className="text-sm text-danger">
            Some answers need attention.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t border-rule pt-4">
          <Button type="button" variant="outline" size="sm" disabled={current === 0} onClick={() => go(current - 1)}>
            Back
          </Button>
          {last ? (
            <Button type="button" variant="ink" size="sm" onClick={finish}>
              Check answers
            </Button>
          ) : (
            <Button type="button" variant="ink" size="sm" onClick={next}>
              Next
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() => {
              setValues({});
              go(0);
            }}
          >
            Clear answers
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Files are not uploaded in the preview: each chosen file stands in as a made-up file id. */
const fakeUpload: UploadFiles = async (files) => files.map(() => crypto.randomUUID());
