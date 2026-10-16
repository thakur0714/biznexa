import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { staffSession, createStaff } from './staff';

let app: NestExpressApplication;
let http: ReturnType<typeof request>;
let prisma: PrismaService;
let admin: string;
let support: string;
let ops: string;
let customerToken: string;

let customerId: string;
let customer2Id: string;
let staffUserId: string;

const run = `${Date.now().toString().slice(-4)}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`; // exactly 7 length
const email = (n: string) => `e2e-cust-${run}-${n}@example.com`;
const as = (token: string) => ({ authorization: `Bearer ${token}` });

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
  await app.init();
  http = request(app.getHttpServer()) as unknown as ReturnType<typeof request>;
  prisma = app.get(PrismaService);

  admin = (await staffSession(http, prisma, 'ADMIN', email('admin'))).accessToken;
  ops = (await staffSession(http, prisma, 'OPERATIONS', email('ops'))).accessToken;
  support = (await staffSession(http, prisma, 'SUPPORT', email('support'))).accessToken;

  // Create a customer via standard auth register
  const registerRes = await http.post('/api/auth/register').send({ name: `Test Cust 1 ${run}`, email: email('c1'), mobile: `98${run}1`, password: 'Password@123', consent: true }).expect(201);
  customerToken = registerRes.body.accessToken;
  const loginRes = await http.post('/api/auth/login').send({ email: email('c1'), password: 'Password@123', consent: true }).expect(200);
  customerId = loginRes.body.user.id;

  // Create a second customer for listing and isolation tests
  const register2Res = await http.post('/api/auth/register').send({ name: `Another Cust ${run}`, email: email('c2'), mobile: `98${run}2`, password: 'Password@123', consent: true }).expect(201);
  customer2Id = await prisma.user.findUniqueOrThrow({ where: { email: email('c2') } }).then((u) => u.id);

  // Set up specific status for listing test
  await prisma.user.update({ where: { id: customer2Id }, data: { status: 'DEACTIVATED' } });

  // Add a dummy application and order to customer 1 to verify relation isolation
  const service = await prisma.service.findFirstOrThrow();
  const pkg = await prisma.servicePackage.findFirstOrThrow({ where: { serviceId: service.id } });

  const order = await prisma.order.create({
    data: {
      code: `ORD-${run}-C1`,
      customerId,
      subtotal: 1000,
      total: 1000,
      status: 'PAID',
    },
  });

  await prisma.payment.create({
    data: {
      orderId: order.id,
      amount: 1000,
      gateway: 'MOCK',
      status: 'SUCCESS',
    },
  });

  await prisma.application.create({
    data: {
      code: `APP-${run}-C1`,
      customerId,
      serviceId: service.id,
      packageId: pkg.id,
      orderId: order.id,
    },
  });

  // A draft has no order yet.
  await prisma.application.create({
    data: { code: `APP-${run}-D1`, customerId: customer2Id, serviceId: service.id, packageId: pkg.id },
  });

  staffUserId = await createStaff(prisma, 'OPERATIONS', email('staff-target'));
});

afterAll(async () => {
  await prisma.payment.deleteMany({ where: { order: { code: { contains: run } } } });
  await prisma.application.deleteMany({ where: { code: { contains: run } } });
  await prisma.order.deleteMany({ where: { code: { contains: run } } });
  await prisma.user.deleteMany({ where: { email: { contains: run } } });
  await app.close();
});

describe('GET /api/admin/customers', () => {
  it('rejects unauthenticated', () => {
    return http.get('/api/admin/customers').expect(401);
  });

  it('rejects customers (403)', () => {
    return http.get('/api/admin/customers').set(as(customerToken)).expect(403);
  });

  it('allows SUPPORT and OPERATIONS', async () => {
    await http.get('/api/admin/customers').set(as(support)).expect(200);
    await http.get('/api/admin/customers').set(as(ops)).expect(200);
  });

  it('never returns passwordHash', async () => {
    const res = await http.get('/api/admin/customers').set(as(admin)).expect(200);
    expect(res.text).not.toContain('passwordHash');
  });

  it('searches by name', async () => {
    const res = await http.get(`/api/admin/customers?q=Test Cust 1 ${run}`).set(as(admin)).expect(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].id).toBe(customerId);
  });

  it('searches by email', async () => {
    const res = await http.get(`/api/admin/customers?q=${email('c2')}`).set(as(admin)).expect(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].id).toBe(customer2Id);
  });

  it('searches by mobile', async () => {
    const res = await http.get(`/api/admin/customers?q=98${run}1`).set(as(admin)).expect(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].id).toBe(customerId);
  });

  it('searches by exact application code', async () => {
    const res = await http.get(`/api/admin/customers?q=APP-${run}-C1`).set(as(admin)).expect(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].id).toBe(customerId);
  });

  it('finds the customer of a draft application (no order yet) by its code', async () => {
    const res = await http.get(`/api/admin/customers?q=APP-${run}-D1`).set(as(admin)).expect(200);
    expect(res.body.items.map((i: any) => i.id)).toEqual([customer2Id]);
  });

  it('filters by status', async () => {
    const res = await http.get(`/api/admin/customers?status=DEACTIVATED`).set(as(admin)).expect(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(1);
    expect(res.body.items.some((i: any) => i.id === customer2Id)).toBe(true);
    expect(res.body.items.some((i: any) => i.id === customerId)).toBe(false);
  });

  it('paginates', async () => {
    const res = await http.get('/api/admin/customers?limit=1&page=1').set(as(admin)).expect(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.limit).toBe(1);
    expect(res.body.page).toBe(1);
    expect(res.body.total).toBeGreaterThan(1);
  });
});

describe('GET /api/admin/customers/:id', () => {
  it('returns details of that customer only (isolated relations)', async () => {
    const res = await http.get(`/api/admin/customers/${customerId}`).set(as(admin)).expect(200);
    expect(res.text).not.toContain('passwordHash');
    expect(res.body.profile.id).toBe(customerId);
    expect(res.body.profile.email).toBe(email('c1'));
    expect(res.body.applications).toHaveLength(1);
    expect(res.body.applications[0].code).toBe(`APP-${run}-C1`);
    expect(res.body.orders).toHaveLength(1);
    expect(res.body.orders[0].code).toBe(`ORD-${run}-C1`);
    expect(res.body.payments).toHaveLength(1);
  });

  it('404s for unknown id', () => {
    return http.get('/api/admin/customers/00000000-0000-0000-0000-000000000000').set(as(admin)).expect(404);
  });

  it('404s for a staff user id', () => {
    return http.get(`/api/admin/customers/${staffUserId}`).set(as(admin)).expect(404);
  });
});

describe('PATCH /api/admin/customers/:id/status', () => {
  let patchCustomerId: string;
  let patchCustomerEmail: string;
  let patchCustomerToken: string;
  let patchCustomerRefreshToken: string;

  beforeAll(async () => {
    patchCustomerEmail = email('patch');
    const registerRes = await http.post('/api/auth/register').send({ name: `Patch Cust ${run}`, email: patchCustomerEmail, mobile: `98${run}3`, password: 'Password@123', consent: true }).expect(201);
    patchCustomerToken = registerRes.body.accessToken;
    patchCustomerRefreshToken = registerRes.body.refreshToken;
    patchCustomerId = registerRes.body.user.id;
  });

  afterAll(async () => {
    try {
      await prisma.user.deleteMany({ where: { email: patchCustomerEmail } });
    } finally {
      // app.close() is already handled in the main afterAll block
    }
  });

  it('rejects unauthenticated', () => {
    return http.patch(`/api/admin/customers/${patchCustomerId}/status`).send({ status: 'BLOCKED', reason: 'Spam' }).expect(401);
  });

  it('rejects customers (403)', () => {
    return http.patch(`/api/admin/customers/${patchCustomerId}/status`).set(as(customerToken)).send({ status: 'BLOCKED', reason: 'Spam' }).expect(403);
  });

  it('rejects SUPPORT and OPERATIONS (no customers.manage)', async () => {
    await http.patch(`/api/admin/customers/${patchCustomerId}/status`).set(as(support)).send({ status: 'BLOCKED', reason: 'Spam' }).expect(403);
    await http.patch(`/api/admin/customers/${patchCustomerId}/status`).set(as(ops)).send({ status: 'BLOCKED', reason: 'Spam' }).expect(403);
  });

  it('404s for unknown id', () => {
    return http.patch('/api/admin/customers/00000000-0000-0000-0000-000000000000/status').set(as(admin)).send({ status: 'BLOCKED', reason: 'Spam' }).expect(404);
  });

  it('404s for a staff user id', () => {
    return http.patch(`/api/admin/customers/${staffUserId}/status`).set(as(admin)).send({ status: 'BLOCKED', reason: 'Spam' }).expect(404);
  });

  it('400s for missing/short reason', () => {
    return http.patch(`/api/admin/customers/${patchCustomerId}/status`).set(as(admin)).send({ status: 'BLOCKED', reason: 'a' }).expect(400);
  });

  it('blocks a customer, revokes their token, logs audit, and reactivates them', async () => {
    // Block the customer
    const res = await http.patch(`/api/admin/customers/${patchCustomerId}/status`).set(as(admin)).send({ status: 'BLOCKED', reason: 'Violated terms' }).expect(200);
    expect(res.body.status).toBe('BLOCKED');
    expect(res.body.id).toBe(patchCustomerId);
    expect(res.body.applicationCount).toBe(0);

    // Old access token should still work until it expires, but refresh token is revoked
    await http.post('/api/auth/refresh').send({ refreshToken: patchCustomerRefreshToken }).expect(401);

    // Login is refused
    await http.post('/api/auth/login').send({ email: patchCustomerEmail, password: 'Password@123', consent: true }).expect(403);

    // Audit log should be created
    const logsRes = await http.get(`/api/admin/audit?entityType=User&entityId=${patchCustomerId}`).set(as(admin)).expect(200);
    expect(logsRes.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'customer.status',
          entityId: patchCustomerId,
          after: expect.objectContaining({ status: 'BLOCKED', reason: 'Violated terms' }),
        }),
      ])
    );

    // Cannot change to same status
    await http.patch(`/api/admin/customers/${patchCustomerId}/status`).set(as(admin)).send({ status: 'BLOCKED', reason: 'Still blocked' }).expect(409);

    // Reactivate the customer
    const reactivateRes = await http.patch(`/api/admin/customers/${patchCustomerId}/status`).set(as(admin)).send({ status: 'ACTIVE', reason: 'Resolved issue' }).expect(200);
    expect(reactivateRes.body.status).toBe('ACTIVE');

    // Login works again
    await http.post('/api/auth/login').send({ email: patchCustomerEmail, password: 'Password@123', consent: true }).expect(200);
  });

  it('409s when trying to change status of customer PENDING_DELETION', async () => {
    await prisma.user.update({ where: { id: customer2Id }, data: { status: 'PENDING_DELETION' } });
    await http.patch(`/api/admin/customers/${customer2Id}/status`).set(as(admin)).send({ status: 'BLOCKED', reason: 'Spam' }).expect(409);
    // Revert status so we don't break subsequent tests
    await prisma.user.update({ where: { id: customer2Id }, data: { status: 'DEACTIVATED' } });
  });
});
