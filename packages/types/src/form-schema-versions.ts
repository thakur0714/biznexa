/**
 * Versioned application forms (D30). Every save of a service's form creates version N+1; old versions
 * are never edited, so an application keeps rendering and validating against `formSchemaVersion`.
 * One version per service is "current" — the one new applications start on.
 */
import { z } from 'zod';
import { formSchema, type FormSchema } from './form-schema';

const isoDate = z.string().datetime();

/** Body of `POST /api/admin/catalogue/services/{id}/form-schemas`. */
export const saveFormSchemaInput = z
  .object({
    schema: formSchema,
    activate: z.boolean().default(true).describe('true = new applications use this version at once; false = save as a draft version'),
  })
  .strict();
export type SaveFormSchemaInput = z.input<typeof saveFormSchemaInput>;

/** `latest`, `current` or a version number. */
export const formSchemaVersionRef = z.union([z.enum(['latest', 'current']), z.coerce.number().int().min(1).max(1_000_000)]);
export type FormSchemaVersionRef = z.infer<typeof formSchemaVersionRef>;

const versionBase = z.object({
  id: z.string().uuid(),
  serviceId: z.string().uuid(),
  version: z.number().int(),
  isCurrent: z.boolean(),
  createdAt: isoDate,
  /** Applications whose `formSchemaVersion` is this version. */
  applications: z.number().int(),
});

export const formSchemaVersionSchema = versionBase.extend({ schema: formSchema });
export type FormSchemaVersion = z.infer<typeof formSchemaVersionSchema>;

export const formSchemaVersionRowSchema = versionBase.extend({ steps: z.number().int(), fields: z.number().int() });
export type FormSchemaVersionRow = z.infer<typeof formSchemaVersionRowSchema>;

export const formSchemaVersionListSchema = z.object({
  latest: z.number().int().nullable(),
  current: z.number().int().nullable(),
  /** Newest first. */
  versions: z.array(formSchemaVersionRowSchema),
});
export type FormSchemaVersionList = z.infer<typeof formSchemaVersionListSchema>;

/** Number of steps and fields (repeater sub-fields included) — for version lists. */
export function formSchemaSize(form: FormSchema): { steps: number; fields: number } {
  const fields = form.steps.reduce((n, s) => n + s.fields.reduce((m, f) => m + 1 + (f.type === 'repeater' ? f.fields.length : 0), 0), 0);
  return { steps: form.steps.length, fields };
}
