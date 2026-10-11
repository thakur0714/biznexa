/**
 * Application forms seed (M3.5). Gives every service a form and moves services that are still on a
 * seeded form to their ready-made one (`SERVICE_FORMS` in `@biznexa/types`), without touching forms an
 * admin saved:
 * - a service with no form gets version 1: its ready-made form, or the generic one;
 * - a service whose current version is a form the seed wrote (the generic form, or the placeholder that
 *   seeds before M3.5 wrote) and differs from its ready-made form gets version N+1, made current;
 * - any other current form was saved in the builder and is kept. Old versions are never changed (D30).
 *
 * Later edits to a ready-made form are not re-applied to services that already have it — change those in
 * the form builder.
 */
import { formSchema, GENERIC_SERVICE_FORM, SERVICE_FORMS, type FormSchemaInput } from '@biznexa/types';
import type { Prisma, PrismaClient } from '../src/generated/prisma/client';

/** The placeholder form every service got before M3.5. */
export const PRE_M35_FORM: FormSchemaInput = {
  steps: [
    {
      title: 'Applicant details',
      fields: [
        { name: 'fullName', label: 'Full name', type: 'text', required: true },
        { name: 'email', label: 'Email', type: 'email', required: true },
        { name: 'mobile', label: 'Mobile number', type: 'tel', required: true },
        { name: 'state', label: 'State', type: 'select', optionsSource: 'states', required: true },
      ],
    },
    {
      title: 'Business details',
      fields: [
        { name: 'businessName', label: 'Business / proposed name', type: 'text', required: true },
        { name: 'businessType', label: 'Business type', type: 'select', options: ['Proprietorship', 'Partnership', 'LLP', 'Private Limited', 'OPC', 'Public Limited', 'Other'], required: true },
        { name: 'address', label: 'Business address', type: 'address', required: true },
        { name: 'notes', label: 'Anything else we should know?', type: 'textarea', required: false },
      ],
    },
  ],
};

export interface SeedFormsOptions {
  forms?: Record<string, FormSchemaInput>;
  generic?: FormSchemaInput;
  /** Limit the run to some services (tests). */
  where?: Prisma.ServiceWhereInput;
}

/** JSON with object keys sorted, so forms compare equal whatever order Postgres returns keys in. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_, v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v));
}

/** The normalised form as the API would store it, or null if it does not parse. */
function normalised(json: unknown): string | null {
  const res = formSchema.safeParse(json);
  return res.success ? canonical(res.data) : null;
}

export async function seedForms(prisma: PrismaClient, { forms = SERVICE_FORMS, generic = GENERIC_SERVICE_FORM, where = {} }: SeedFormsOptions = {}) {
  const seeded = new Set([normalised(generic), normalised(PRE_M35_FORM)]);
  const result = { created: 0, upgraded: 0, kept: 0 };

  const services = await prisma.service.findMany({ where: { ...where, deletedAt: null }, select: { id: true, slug: true } });
  for (const s of services) {
    const form = formSchema.parse(forms[s.slug] ?? generic);
    const wanted = canonical(form);

    const outcome = await prisma.$transaction(async (tx) => {
      // Same lock as FormSchemasService, so a seed never races an admin's save.
      await tx.$queryRaw`SELECT id FROM "Service" WHERE id = ${s.id} FOR UPDATE`;
      const last = await tx.serviceFormSchema.findFirst({ where: { serviceId: s.id }, orderBy: { version: 'desc' }, select: { version: true } });
      const current = await tx.serviceFormSchema.findFirst({ where: { serviceId: s.id, isCurrent: true }, select: { schema: true } });
      if (last) {
        const now = current ? normalised(current.schema) : null;
        if (!current || now === wanted || !seeded.has(now)) return 'kept' as const;
        await tx.serviceFormSchema.updateMany({ where: { serviceId: s.id, isCurrent: true }, data: { isCurrent: false } });
      }
      await tx.serviceFormSchema.create({ data: { serviceId: s.id, version: (last?.version ?? 0) + 1, schema: form as Prisma.InputJsonValue, isCurrent: true } });
      return last ? ('upgraded' as const) : ('created' as const);
    });
    result[outcome]++;
  }
  return result;
}
