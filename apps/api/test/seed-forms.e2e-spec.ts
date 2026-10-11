/**
 * Application forms seed (M3.5) against a real database: services get their ready-made or the generic
 * form, services still on a seeded form move to a new version, and forms saved by an admin are kept.
 * Uses run-scoped services, so the real catalogue is untouched.
 */
import { formSchema, SERVICE_FORMS, type FormSchemaInput } from '@biznexa/types';
import { PrismaService } from '../src/prisma/prisma.service';
import { CATEGORIES } from '../prisma/seed-data';
import { PRE_M35_FORM, seedForms } from '../prisma/seed-forms';

const prisma = new PrismaService();
const run = `e2e-sf-${Date.now().toString().slice(-7)}${Math.floor(Math.random() * 100)}`;
const slug = (name: string) => `${run}-${name}`;

const form = (label: string): FormSchemaInput => ({ steps: [{ title: 'Step', fields: [{ type: 'text', name: 'answer', label, required: true }] }] });
const READY = form('Ready-made');
const GENERIC = form('Generic');
let forms: Record<string, FormSchemaInput>;
const seed = () => seedForms(prisma, { forms, generic: GENERIC, where: { slug: { startsWith: run } } });

async function service(name: string) {
  const cat = await prisma.category.findUniqueOrThrow({ where: { slug: 'licenses' } });
  return prisma.service.create({ data: { slug: slug(name), name: `Seed forms ${name} (test)`, shortDescription: 'Test service', categoryId: cat.id } });
}

async function versions(name: string) {
  const rows = await prisma.serviceFormSchema.findMany({ where: { service: { slug: slug(name) } }, orderBy: { version: 'asc' } });
  return rows.map((r) => ({ version: r.version, isCurrent: r.isCurrent, label: formSchema.parse(r.schema).steps[0].fields[0].label }));
}

beforeAll(() => {
  forms = { [slug('ready')]: READY, [slug('legacy')]: READY, [slug('edited')]: READY };
});

afterAll(async () => {
  await prisma.service.deleteMany({ where: { slug: { startsWith: run } } });
  await prisma.$disconnect();
});

describe('seedForms', () => {
  it('gives a service without a form its ready-made form, or the generic one, as version 1', async () => {
    await service('ready');
    await service('other');

    expect(await seed()).toEqual({ created: 2, upgraded: 0, kept: 0 });
    expect(await versions('ready')).toEqual([{ version: 1, isCurrent: true, label: 'Ready-made' }]);
    expect(await versions('other')).toEqual([{ version: 1, isCurrent: true, label: 'Generic' }]);
  });

  it('changes nothing when run again', async () => {
    expect(await seed()).toEqual({ created: 0, upgraded: 0, kept: 2 });
    expect(await versions('ready')).toHaveLength(1);
  });

  it('moves a service on the pre-M3.5 placeholder to its ready-made form as a new version, keeping the old one', async () => {
    const s = await service('legacy');
    await prisma.serviceFormSchema.create({ data: { serviceId: s.id, version: 1, schema: PRE_M35_FORM as object } });

    expect(await seed()).toMatchObject({ upgraded: 1 });
    const rows = await prisma.serviceFormSchema.findMany({ where: { serviceId: s.id }, orderBy: { version: 'asc' } });
    expect(rows.map((r) => [r.version, r.isCurrent])).toEqual([[1, false], [2, true]]);
    expect(rows[0].schema).toEqual(PRE_M35_FORM);
    expect(formSchema.parse(rows[1].schema).steps[0].fields[0].label).toBe('Ready-made');
  });

  it('moves a service from the generic form when it gets a ready-made one', async () => {
    forms[slug('other')] = READY;
    expect(await seed()).toMatchObject({ upgraded: 1 });
    expect(await versions('other')).toEqual([
      { version: 1, isCurrent: false, label: 'Generic' },
      { version: 2, isCurrent: true, label: 'Ready-made' },
    ]);
  });

  it('keeps a form an admin saved, and a service with only draft versions', async () => {
    const edited = await service('edited');
    await prisma.serviceFormSchema.create({ data: { serviceId: edited.id, version: 1, schema: formSchema.parse(GENERIC) as object, isCurrent: false } });
    await prisma.serviceFormSchema.create({ data: { serviceId: edited.id, version: 2, schema: formSchema.parse(form('Edited by admin')) as object } });
    const drafts = await service('drafts');
    await prisma.serviceFormSchema.create({ data: { serviceId: drafts.id, version: 1, schema: formSchema.parse(GENERIC) as object, isCurrent: false } });

    expect(await seed()).toEqual({ created: 0, upgraded: 0, kept: 5 });
    expect((await versions('edited')).map((v) => v.version)).toEqual([1, 2]);
    expect(await versions('drafts')).toEqual([{ version: 1, isCurrent: false, label: 'Generic' }]);
  });
});

describe('ready-made forms', () => {
  it('are all for services in the seeded catalogue', () => {
    const slugs = new Set(CATEGORIES.flatMap((c) => c.services.map((s) => s.slug)));
    expect(Object.keys(SERVICE_FORMS).filter((s) => !slugs.has(s))).toEqual([]);
  });
});
