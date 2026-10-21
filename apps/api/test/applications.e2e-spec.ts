/**
 * Starting an application (M3.8, D35): draft order + DRAFT application, codes from DB sequences.
 */
import { Test } from '@nestjs/testing';
import { randomInt, randomUUID } from 'node:crypto';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { APPLICATION_CODE_PATTERN, draftApplicationSchema, GENERIC_SERVICE_FORM, istYear, ORDER_CODE_PATTERN, type DraftApplication } from '@biznexa/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { ApplicationsService } from '../src/applications/applications.service';

let app: NestExpressApplication;
let http: ReturnType<typeof request>;
let prisma: PrismaService;
let customers: string[] = [];
let serviceId: string;
let packageIds: string[];
let noFormPackageId: string;

const run = randomUUID();
const mobileRun = String(randomInt(1_000_000, 10_000_000));
const base = '/api/applications';
const as = (token: string) => ({ authorization: `Bearer ${token}` });
const users = { email: { startsWith: `e2e-app-${run}` } };
/** Application has no `customer` relation, so its rows are found through the order's customer. */
const myApps = { order: { customer: users } };
const CUSTOMERS = 8;

async function register(n: number) {
  const res = await http
    .post('/api/auth/register')
    .send({ name: 'Application Test', mobile: `6${mobileRun}${String(n).padStart(2, '0')}`, email: `e2e-app-${run}-${n}@example.com`, password: 'secret123', consent: true })
    .expect(201);
  return res.body.accessToken as string;
}

async function createService(slug: string, withForm: boolean) {
  const cat = await prisma.category.findUniqueOrThrow({ where: { slug: 'licenses' } });
  return prisma.service.create({
    data: {
      slug,
      categoryId: cat.id,
      name: 'Draft applications (test)',
      shortDescription: 'A service used to test starting applications.',
      sacCode: '998231',
      packages: {
        create: [
          { name: 'Basic', professionalFee: 100000, governmentFee: 50000, gstRate: 18, sortOrder: 0 },
          { name: 'Standard', professionalFee: 200000, sortOrder: 1 },
          { name: 'Premium', professionalFee: 300000, sortOrder: 2 },
          { name: 'Retired', professionalFee: 1000, sortOrder: 3, isActive: false },
        ],
      },
      ...(withForm && {
        formSchemas: {
          create: [
            { version: 1, schema: GENERIC_SERVICE_FORM as object, isCurrent: false },
            { version: 2, schema: GENERIC_SERVICE_FORM as object, isCurrent: true },
            { version: 3, schema: GENERIC_SERVICE_FORM as object, isCurrent: false },
          ],
        },
      }),
    },
    select: { id: true, packages: { orderBy: { sortOrder: 'asc' }, select: { id: true } } },
  });
}

const start = (token: string, body: unknown) => http.post(base).set(as(token)).send(body as object);

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
  await app.init();
  http = request(app.getHttpServer()) as unknown as ReturnType<typeof request>;
  prisma = app.get(PrismaService);
  customers = await Promise.all(Array.from({ length: CUSTOMERS }, (_, i) => register(i + 1)));

  const svc = await createService(`e2e-app-${run}`, true);
  serviceId = svc.id;
  packageIds = svc.packages.map((p) => p.id);
  noFormPackageId = (await createService(`e2e-app-${run}-noform`, false)).packages[0].id;
});

afterAll(async () => {
  await prisma.application.deleteMany({ where: myApps });
  await prisma.order.deleteMany({ where: { customer: users } });
  await prisma.businessEntity.deleteMany({ where: { owner: users } });
  await prisma.service.deleteMany({ where: { slug: { startsWith: `e2e-app-${run}` } } });
  await prisma.user.deleteMany({ where: users });
  await app.close();
});

describe('start an application (M3.8)', () => {
  const [alice, bob] = [() => customers[0], () => customers[1]];
  let first: DraftApplication;

  it('needs a login', async () => {
    await http.post(base).send({ packageId: packageIds[0] }).expect(401);
  });

  it('creates a draft order and a DRAFT application with the current form version', async () => {
    const res = await start(alice(), { packageId: packageIds[0] }).expect(201);
    first = draftApplicationSchema.parse(res.body);
    expect(first).toMatchObject({ status: 'DRAFT', serviceId, packageId: packageIds[0], businessEntityId: null, formSchemaVersion: 2, resumed: false });
    expect(first.code).toMatch(APPLICATION_CODE_PATTERN);
    expect(first.order.code).toMatch(new RegExp(`^ORD-${istYear(new Date())}-\\d{6,}$`));
    expect(first.order.status).toBe('CREATED');

    const row = await prisma.application.findUniqueOrThrow({
      where: { id: first.id },
      include: { order: { include: { items: true } }, history: true },
    });
    expect(row.formData).toEqual({});
    expect(row.order).toMatchObject({ customerId: row.customerId, subtotal: 100000, govtFees: 50000, taxTotal: 18000, total: 168000, amountPaid: 0, discount: 0 });
    expect(first.order.total).toBe(168000);
    expect(row.order!.items).toEqual([
      expect.objectContaining({ packageId: packageIds[0], description: 'Draft applications (test) — Basic', sacCode: '998231', professionalFee: 100000, governmentFee: 50000, gstRate: 18 }),
    ]);
    expect(row.history).toEqual([expect.objectContaining({ status: 'DRAFT', changedById: row.customerId, visibleToCustomer: true })]);
  });

  it('returns the unpaid draft instead of starting a second one for the same package', async () => {
    const res = await start(alice(), { packageId: packageIds[0] }).expect(200);
    expect(res.body).toMatchObject({ id: first.id, code: first.code, order: { code: first.order.code }, resumed: true });
    expect(await prisma.application.count({ where: { ...myApps, packageId: packageIds[0] } })).toBe(1);
  });

  it('keeps a started draft on its form version after the admin activates another', async () => {
    await prisma.$transaction([
      prisma.serviceFormSchema.updateMany({ where: { serviceId }, data: { isCurrent: false } }),
      prisma.serviceFormSchema.update({ where: { serviceId_version: { serviceId, version: 3 } }, data: { isCurrent: true } }),
    ]);
    expect((await start(alice(), { packageId: packageIds[0] }).expect(200)).body.formSchemaVersion).toBe(2);
    expect((await start(alice(), { packageId: packageIds[1] }).expect(201)).body.formSchemaVersion).toBe(3);
  });

  it('links one of the customer’s businesses and copies its state onto the order', async () => {
    const entity = await http
      .post('/api/business-entities')
      .set(as(alice()))
      .send({ legalName: 'Acme Widgets Private Limited', entityType: 'PRIVATE_LIMITED', address: { line1: '1 Mall Road', city: 'Ludhiana', state: 'Punjab', pincode: '141001' } })
      .expect(201);
    const res = await start(alice(), { packageId: packageIds[0], businessEntityId: entity.body.id }).expect(201);
    expect(res.body).toMatchObject({ businessEntityId: entity.body.id, resumed: false });
    expect(res.body.id).not.toBe(first.id);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: res.body.order.id } })).buyerState).toBe('Punjab');

    // Customer B cannot attach customer A's business: same 404 as a missing one, nothing created.
    const before = await prisma.order.count({ where: { customer: users } });
    const res404 = await start(bob(), { packageId: packageIds[0], businessEntityId: entity.body.id }).expect(404);
    expect(res404.body.message).toBe('Business not found');
    expect(await prisma.order.count({ where: { customer: users } })).toBe(before);
  });

  it('refuses inactive or unknown packages, services without a form, and server-owned fields', async () => {
    await start(alice(), { packageId: packageIds[3] }).expect(404);
    await start(alice(), { packageId: '00000000-0000-4000-8000-000000000000' }).expect(404);
    const noForm = await start(alice(), { packageId: noFormPackageId }).expect(409);
    expect(noForm.body.message).toMatch(/cannot be applied for online yet/);
    await start(alice(), { packageId: 'basic' }).expect(400);
    await start(alice(), { packageId: packageIds[2], total: 1 }).expect(400);
    await start(alice(), { packageId: packageIds[2], customerId: 'x' }).expect(400);
  });

  it('never gives two orders or applications the same code under concurrent creation', async () => {
    // Every customer starts three packages at once: 24 new drafts in parallel, plus repeats that must resume.
    const before = await prisma.application.count({ where: myApps });
    const results = [];
    // Race several customers together while keeping the database work bounded under the full API run.
    for (let offset = 2; offset < customers.length; offset += 2) {
      const batch = customers.slice(offset, offset + 2).flatMap((token) => packageIds.slice(0, 3).flatMap((packageId) => [start(token, { packageId }), start(token, { packageId })]));
      results.push(...(await /* NOSONAR: tests run steps in order */ Promise.all(batch))); // NOSONAR: tests run steps in order
    }
    for (const r of results) expect([200, 201]).toContain(r.status);
    const created = results.filter((r) => r.status === 201).map((r) => draftApplicationSchema.parse(r.body));
    expect(created).toHaveLength((CUSTOMERS - 2) * 3);

    const rows = await prisma.application.findMany({ where: myApps, select: { code: true, order: { select: { code: true } } } });
    const appCodes = rows.map((r) => r.code);
    const orderCodes = rows.map((r) => r.order!.code);
    expect(new Set(appCodes).size).toBe(rows.length);
    expect(new Set(orderCodes).size).toBe(rows.length);
    for (const c of orderCodes) expect(c).toMatch(ORDER_CODE_PATTERN);
    // The repeated request for each customer and package resumed the draft rather than adding one.
    expect(rows).toHaveLength(before + (CUSTOMERS - 2) * 3);
  });

  it('hands out distinct codes straight from the service under heavy parallel load', async () => {
    // Forty unique customers still exercise simultaneous sequence allocation without opening 80 DB operations at once.
    const svc = app.get(ApplicationsService);
    await prisma.user.createMany({
      data: Array.from({ length: 40 }, (_, i) => ({ name: 'Load', email: `e2e-app-${run}-load-${i}@example.com`, passwordHash: 'x', consentAt: new Date() })),
    });
    const loadUsers = await prisma.user.findMany({ where: { email: { startsWith: `e2e-app-${run}-load-` } }, orderBy: { email: 'asc' }, select: { id: true } });
    const ids = [];
    for (let offset = 0; offset < loadUsers.length; offset += 8) {
      ids.push(
        ...(await /* NOSONAR: tests run steps in order */ Promise.all( // NOSONAR: tests run steps in order
          loadUsers.slice(offset, offset + 8).map((u, index) => svc.startDraft(u.id, { packageId: packageIds[(offset + index) % 3], businessEntityId: null })),
        )),
      );
    }
    expect(new Set(ids.map((d) => d.code)).size).toBe(40);
    expect(new Set(ids.map((d) => d.order.code)).size).toBe(40);
  });
});
