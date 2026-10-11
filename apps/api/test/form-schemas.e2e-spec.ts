/**
 * Versioned application forms (M3.3, D30): every save is version N+1, old versions never change,
 * and applications keep the version they were started on.
 */
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { formSchemaVersionListSchema, formSchemaVersionSchema, type FormSchemaInput, type FormSchemaVersion, type FormSchemaVersionList } from '@biznexa/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { staffSession } from './staff';

let app: NestExpressApplication;
let http: ReturnType<typeof request>;
let prisma: PrismaService;
let admin: string;
let ops: string;
let serviceId: string;
let packageId: string;
let customerId: string;

const run = `${Date.now().toString().slice(-7)}${Math.floor(Math.random() * 100)}`;
const email = (n: number) => `e2e-fs-${run}-${n}@example.com`;
const base = () => `/api/admin/catalogue/services/${serviceId}/form-schemas`;

const form = (label: string): FormSchemaInput => ({
  steps: [
    { title: 'Company', fields: [{ type: 'text', name: 'name', label, required: true }] },
    { title: 'Directors', fields: [{ type: 'repeater', name: 'directors', label: 'Directors', minItems: 1, fields: [{ type: 'text', name: 'pan', label: 'PAN' }] }] },
  ],
});

const as = (token: string) => ({ authorization: `Bearer ${token}` });
const save = (body: unknown, token = admin) => http.post(base()).set(as(token)).send(body as object);

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
  await app.init();
  http = request(app.getHttpServer()) as unknown as ReturnType<typeof request>;
  prisma = app.get(PrismaService);
  admin = (await staffSession(http, prisma, 'ADMIN', email(1))).accessToken;
  ops = (await staffSession(http, prisma, 'OPERATIONS', email(2))).accessToken;

  const cat = await prisma.category.findUniqueOrThrow({ where: { slug: 'licenses' } });
  const created = await http
    .post('/api/admin/catalogue/services')
    .set(as(admin))
    .send({
      slug: `e2e-fs-${run}`,
      categoryId: cat.id,
      name: 'Form versions (test)',
      shortDescription: 'A service used to test versioned application forms.',
      packages: [{ name: 'Basic', professionalFee: 100000 }],
      stages: [{ name: 'Submitted' }],
    })
    .expect(201);
  serviceId = created.body.id;
  packageId = created.body.packages[0].id;
  customerId = (
    await prisma.user.create({ data: { name: 'E2E customer', email: email(3), passwordHash: 'x', emailVerified: true, consentAt: new Date() } })
  ).id;
});

afterAll(async () => {
  await prisma.application.deleteMany({ where: { serviceId } });
  await prisma.service.deleteMany({ where: { id: serviceId } });
  await prisma.user.deleteMany({ where: { email: { startsWith: `e2e-fs-${run}` } } });
  await app.close();
});

describe('form schema versions (M3.3)', () => {
  it('starts with no versions', async () => {
    const list = await http.get(base()).set(as(admin)).expect(200);
    expect(list.body).toEqual({ latest: null, current: null, versions: [] });
    await http.get(`${base()}/current`).set(as(admin)).expect(404);
    await http.get(`${base()}/latest`).set(as(admin)).expect(404);
  });

  it('saves version 1, then 2 — and version 1 is unchanged', async () => {
    const v1 = (await save({ schema: form('Company name') }).expect(201)).body as FormSchemaVersion;
    expect(formSchemaVersionSchema.strict().safeParse(v1).error).toBeUndefined();
    expect(v1).toMatchObject({ version: 1, isCurrent: true, applications: 0 });
    // Stored normalised: defaults filled in.
    expect(v1.schema.steps[1].fields[0]).toMatchObject({ itemLabel: 'Item', required: false });

    const v2 = (await save({ schema: form('Proposed company name') }).expect(201)).body as FormSchemaVersion;
    expect(v2).toMatchObject({ version: 2, isCurrent: true });

    const again = (await http.get(`${base()}/1`).set(as(admin)).expect(200)).body as FormSchemaVersion;
    expect(again.isCurrent).toBe(false);
    expect(again.schema).toEqual(v1.schema);
    expect((await http.get(`${base()}/current`).set(as(admin)).expect(200)).body.version).toBe(2);
  });

  it('keeps an application on the version it started with', async () => {
    const app1 = await prisma.application.create({
      data: { code: `E2EFS${run}`, customerId, serviceId, packageId, formSchemaVersion: 2 },
    });
    const v3 = (await save({ schema: form('Name of the company') }).expect(201)).body as FormSchemaVersion;
    expect(v3.version).toBe(3);

    const stored = await prisma.application.findUniqueOrThrow({ where: { id: app1.id }, select: { formSchemaVersion: true } });
    expect(stored.formSchemaVersion).toBe(2);
    const its = (await http.get(`${base()}/${stored.formSchemaVersion}`).set(as(admin)).expect(200)).body as FormSchemaVersion;
    expect(its.schema.steps[0].fields[0].label).toBe('Proposed company name');
    expect(its.applications).toBe(1);

    const list = (await http.get(base()).set(as(admin)).expect(200)).body as FormSchemaVersionList;
    expect(formSchemaVersionListSchema.safeParse(list).error).toBeUndefined();
    expect(list.latest).toBe(3);
    expect(list.current).toBe(3);
    expect(list.versions.map((v) => [v.version, v.isCurrent, v.applications])).toEqual([
      [3, true, 0],
      [2, false, 1],
      [1, false, 0],
    ]);
    expect(list.versions[0]).toMatchObject({ steps: 2, fields: 3 });
  });

  it('saves a draft version without changing the current one, then activates it and rolls back', async () => {
    const draft = (await save({ schema: form('Draft label'), activate: false }).expect(201)).body as FormSchemaVersion;
    expect(draft).toMatchObject({ version: 4, isCurrent: false });
    expect((await http.get(`${base()}/latest`).set(as(admin)).expect(200)).body.version).toBe(4);
    expect((await http.get(`${base()}/current`).set(as(admin)).expect(200)).body.version).toBe(3);

    expect((await http.post(`${base()}/4/activate`).set(as(admin)).expect(200)).body).toMatchObject({ version: 4, isCurrent: true });
    expect((await http.post(`${base()}/2/activate`).set(as(admin)).expect(200)).body).toMatchObject({ version: 2, isCurrent: true, applications: 1 });
    const current = await prisma.serviceFormSchema.findMany({ where: { serviceId, isCurrent: true }, select: { version: true } });
    expect(current).toEqual([{ version: 2 }]);
    await http.post(`${base()}/99/activate`).set(as(admin)).expect(404);
  });

  it('gives consecutive version numbers to concurrent saves and keeps one current version', async () => {
    const results = await Promise.all([1, 2, 3, 4].map((n) => save({ schema: form(`Concurrent ${n}`) })));
    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201]);
    expect(results.map((r) => r.body.version).sort()).toEqual([5, 6, 7, 8]);
    const current = await prisma.serviceFormSchema.findMany({ where: { serviceId, isCurrent: true }, select: { version: true } });
    expect(current).toEqual([{ version: 8 }]);
  });

  it('writes an audit entry for every save and activation', async () => {
    const entries = await prisma.auditLog.findMany({ where: { entityId: serviceId, action: { startsWith: 'service.form_schema.' } }, orderBy: { createdAt: 'asc' } });
    expect(entries.filter((e) => e.action === 'service.form_schema.create')).toHaveLength(8);
    expect(entries.filter((e) => e.action === 'service.form_schema.activate')).toHaveLength(2);
    const firstActivate = entries.find((e) => e.action === 'service.form_schema.activate')!;
    expect(firstActivate).toMatchObject({ before: { currentVersion: 3 }, after: { currentVersion: 4 } });
    expect(entries[0].actorId).toBeTruthy();
  });

  it('rejects invalid forms with field errors and saves nothing', async () => {
    const before = await prisma.serviceFormSchema.count({ where: { serviceId } });
    const bad = await save({ schema: { steps: [{ title: 'S', fields: [{ type: 'text', name: 'a', label: 'A', requried: true }] }] } }).expect(400);
    expect(bad.body.errors[0].field).toMatch(/^schema\.steps\.0\.fields\.0/);
    await save({ schema: form('x'), version: 1 }).expect(400);
    await http.get(`${base()}/0`).set(as(admin)).expect(400);
    await http.get(`${base()}/first`).set(as(admin)).expect(400);
    expect(await prisma.serviceFormSchema.count({ where: { serviceId } })).toBe(before);
  });

  it('is for catalogue managers only, and unknown services are 404', async () => {
    await http.get(base()).expect(401);
    await http.get(base()).set(as(ops)).expect(403);
    await save({ schema: form('x') }, ops).expect(403);
    const missing = `/api/admin/catalogue/services/${crypto.randomUUID()}/form-schemas`;
    await http.get(missing).set(as(admin)).expect(404);
    await http.post(missing).set(as(admin)).send({ schema: form('x') }).expect(404);
  });
});
