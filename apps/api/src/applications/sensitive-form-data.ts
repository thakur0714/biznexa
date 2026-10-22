import { FORM_PATTERNS, maskPan, type FormField, type FormSchema } from '@biznexa/types';
import { decryptField, encryptField } from '../common/encryption';

/**
 * Sensitive answers in an application form (M12.2, D65): PAN and bank account numbers are stored
 * encrypted inside `Application.formData` as `{ "$enc": "v1.…" }`, so a database dump or backup does
 * not show them. A field counts as sensitive by the format it asks for — the same patterns the
 * ready-made forms and the form builder use — so a new form gets this without extra settings.
 *
 * Reading needs no form: sealed values describe themselves. Callers decide who sees the full value
 * (the customer who owns the application, staff who work on it); everyone else gets it masked.
 */
const SEALED = '$enc';
type Sealed = { [SEALED]: string };

const SENSITIVE_PATTERNS = new Set<string>([FORM_PATTERNS.pan.pattern, FORM_PATTERNS.bankAccount.pattern]);

export function isSensitiveField(f: FormField): boolean {
  return (f.type === 'text' || f.type === 'tel') && !!f.pattern && SENSITIVE_PATTERNS.has(f.pattern);
}

const isSealed = (v: unknown): v is Sealed =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).length === 1 && typeof (v as Sealed)[SEALED] === 'string';

const seal = (v: unknown) => (typeof v === 'string' && v !== '' ? { [SEALED]: encryptField(v) } : v);

/** Answers as stored: sensitive fields (top level and inside repeater rows) encrypted. */
export function sealFormData(form: FormSchema, data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };
  for (const step of form.steps) {
    for (const f of step.fields) {
      if (!(f.name in out)) continue;
      if (f.type === 'repeater') {
        const sub = f.fields.filter((item) => isSensitiveField(item));
        if (!sub.length || !Array.isArray(out[f.name])) continue;
        out[f.name] = (out[f.name] as unknown[]).map((row) => {
          if (typeof row !== 'object' || row === null) return row;
          const r = { ...(row as Record<string, unknown>) };
          for (const s of sub) if (s.name in r) r[s.name] = seal(r[s.name]);
          return r;
        });
      } else if (isSensitiveField(f)) {
        out[f.name] = seal(out[f.name]);
      }
    }
  }
  return out;
}

/** `ABCDE1234F` → `ABCDE****F`; anything else keeps its last four characters. */
export function maskSensitive(value: string): string {
  if (/^[A-Z]{5}\d{4}[A-Z]$/.test(value)) return maskPan(value);
  return value.length > 4 ? `${'•'.repeat(Math.min(value.length - 4, 8))}${value.slice(-4)}` : '••••';
}

/** Answers for a reader: sealed values decrypted when `reveal`, else masked. Plain (older) answers pass through. */
export function openFormData(data: unknown, reveal: boolean): Record<string, unknown> {
  const walk = (v: unknown): unknown => {
    if (isSealed(v)) {
      const plain = decryptField(v[SEALED]);
      return reveal ? plain : maskSensitive(plain);
    }
    if (Array.isArray(v)) return v.map((item) => walk(item));
    if (typeof v === 'object' && v !== null) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  const opened = walk(data ?? {});
  return typeof opened === 'object' && opened !== null && !Array.isArray(opened) ? (opened as Record<string, unknown>) : {};
}
