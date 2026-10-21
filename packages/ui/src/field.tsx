import type { ComponentProps, ReactNode } from 'react';

const control = 'h-11 w-full rounded-md border bg-white text-[15px] outline-none transition-colors focus:border-ink';

interface FieldProps {
  label: string;
  id: string;
  error?: string;
  hint?: string;
}

/** Label + control + error/hint, wired with aria-invalid and aria-describedby. */
function FieldShell({ label, id, error, hint, className, children }: FieldProps & { className: string; children: ReactNode }) {
  let helper: ReactNode = null;
  if (error) {
    helper = <p id={`${id}-err`} className="mt-1.5 text-sm text-danger">{error}</p>;
  } else if (hint) {
    helper = <p id={`${id}-hint`} className="mt-1.5 text-sm text-muted">{hint}</p>;
  }

  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-night">
        {label}
      </label>
      {children}
      {helper}
    </div>
  );
}

const describedBy = (id: string, error?: string, hint?: string) => {
  if (error) return `${id}-err`;
  if (hint) return `${id}-hint`;
  return undefined;
};

/** Text input with label. */
export function Field({ label, error, hint, id, className = '', ...rest }: ComponentProps<'input'> & FieldProps) {
  return (
    <FieldShell label={label} id={id} error={error} hint={hint} className={className}>
      <input
        id={id}
        aria-invalid={!!error}
        aria-describedby={describedBy(id, error, hint)}
        className={`${control} px-3.5 placeholder:text-muted/70 ${error ? 'border-danger' : 'border-rule'}`}
        {...rest}
      />
    </FieldShell>
  );
}

/** Native select with label; pass `<option>`s as children. */
export function Select({ label, error, hint, id, className = '', children, ...rest }: ComponentProps<'select'> & FieldProps) {
  return (
    <FieldShell label={label} id={id} error={error} hint={hint} className={className}>
      <select id={id} aria-invalid={!!error} aria-describedby={describedBy(id, error, hint)} className={`${control} px-3 ${error ? 'border-danger' : 'border-rule'}`} {...rest}>
        {children}
      </select>
    </FieldShell>
  );
}

/** Multi-line text with label. */
export function TextArea({ label, error, hint, id, className = '', rows = 3, ...rest }: ComponentProps<'textarea'> & FieldProps) {
  return (
    <FieldShell label={label} id={id} error={error} hint={hint} className={className}>
      <textarea
        id={id}
        rows={rows}
        aria-invalid={!!error}
        aria-describedby={describedBy(id, error, hint)}
        className={`w-full rounded-md border bg-white px-3.5 py-2.5 text-[15px] leading-relaxed outline-none transition-colors placeholder:text-muted/70 focus:border-ink ${error ? 'border-danger' : 'border-rule'}`}
        {...rest}
      />
    </FieldShell>
  );
}

/** Checkbox with its label to the right and an optional hint below. */
export function Checkbox({ label, hint, id, className = '', ...rest }: Omit<ComponentProps<'input'>, 'type'> & { label: ReactNode; hint?: string; id: string }) {
  return (
    <div className={`flex items-start gap-2.5 ${className}`}>
      <input id={id} type="checkbox" aria-describedby={hint ? `${id}-hint` : undefined} className="mt-0.5 size-4.5 shrink-0 accent-ink" {...rest} />
      <div>
        <label htmlFor={id} className="text-[15px] text-night">
          {label}
        </label>
        {hint && (
          <p id={`${id}-hint`} className="text-sm text-muted">
            {hint}
          </p>
        )}
      </div>
    </div>
  );
}
