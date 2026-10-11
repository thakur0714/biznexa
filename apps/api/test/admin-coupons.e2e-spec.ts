/**
 * Admin coupon CRUD with usage stats (M3.12, D39): codes stored upper-case and unique, the cross-field
 * rules on create and on the merged coupon after an update, usage counted from `CouponRedemption`,
 * used coupons kept (no code change, no delete), an audit entry for every write, and `coupons.manage`.
 */
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { adminCouponListSchema, adminCouponRowSchema, couponServiceOptionsSchema, type AdminCouponRow } from '@biznexa/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { staffSession } from './staff';

let app: NestExpressApplication;
let http: ReturnType<typeof request>;
let prisma: PrismaService;
let admin: string;
let ops: string;
let adminId: string;
let customers: string[];
let gst: string;
let removed: string;

const run = `${Date.now().toString().slice(-7)}${Math.floor(Math.random() * 100)}`;
const prefix = `E2EAC${run}`;
const email = (n: number) => `e2e-ac-${run}-${n}@example.com`;
const as = (token: string) => ({ authorization: `Bearer ${token}` });

let n = 0;
const code = () => `${prefix}-${++n}`;
const create = (body: Record<string, unknown>, token = admin) => http.post('/api/admin/coupons').set(as(token)).send({ type: 'PERCENTAGE', value: 10, ...body });
const patch = (id: string, body: Record<string, unknown>) => http.patch(`/api/admin/coupons/${id}`).set(as(admin)).send(body);
const fields = (body: { errors?: { field: string }[] }) => body.errors?.map((e) => e.field);
const auditFor = (entityId: string) => prisma.auditLog.findMany({ where: { entityType: 'Coupon', entityId }, orderBy: { createdAt: 'asc' } });
const redeem = (couponId: string, userId: string, amount: number, createdAt = new Date()) =>
  prisma.couponRedemption.create({ data: { couponId, userId, orderId: randomUUID(), amount, createdAt } });

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
  await app.init();
  http = request(app.getHttpServer()) as unknown as ReturnType<typeof request>;
  prisma = app.get(PrismaService);
  admin = (await staffSession(http, prisma, 'ADMIN', email(1))).accessToken;
  ops = (await staffSession(http, prisma, 'OPERATIONS', email(2))).accessToken;
  adminId = (await prisma.user.findUniqueOrThrow({ where: { email: email(1) } })).id;
  customers = await Promise.all(
    [3, 4].map((i) => prisma.user.create({ data: { name: 'Coupon Customer', email: email(i) }, select: { id: true } }).then((u) => u.id)),
  );
  const cat = await prisma.category.findUniqueOrThrow({ where: { slug: 'licenses' } });
  const service = (slug: string, deletedAt: Date | null = null) =>
    prisma.service.create({
      data: { slug: `e2e-ac-${run}-${slug}`, categoryId: cat.id, name: `Coupon ${slug} (test)`, shortDescription: 'Coupon admin test service.', deletedAt },
      select: { id: true },
    });
  gst = (await service('gst')).id;
  removed = (await service('removed', new Date())).id;
});

afterAll(async () => {
  const mine = { code: { startsWith: prefix } };
  await prisma.couponRedemption.deleteMany({ where: { coupon: mine } });
  await prisma.order.deleteMany({ where: { coupon: mine } });
  await prisma.coupon.deleteMany({ where: mine });
  await prisma.service.deleteMany({ where: { slug: { startsWith: `e2e-ac-${run}` } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: `e2e-ac-${run}` } } });
  await app.close();
});

describe('admin coupons (M3.12)', () => {
  it('creates a coupon with its code upper-cased and logs it', async () => {
    const c = code();
    const res = await create({ code: ` ${c.toLowerCase()} `, maxDiscount: 50000, serviceIds: [gst], expiresAt: '2027-01-01T00:00:00+05:30' }).expect(201);
    const row = res.body as AdminCouponRow;
    expect(adminCouponRowSchema.strict().safeParse(row).error).toBeUndefined();
    expect(row).toMatchObject({
      code: c,
      type: 'PERCENTAGE',
      value: 10,
      maxDiscount: 50000,
      perUserLimit: 1,
      usageLimit: null,
      serviceIds: [gst],
      services: [{ id: gst, name: 'Coupon gst (test)', removed: false }],
      expiresAt: '2026-12-31T18:30:00.000Z',
      status: 'ACTIVE',
      usage: { redemptions: 0, customers: 0, discountGiven: 0, lastUsedAt: null },
      inUse: false,
    });
    const audit = await auditFor(row.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: 'coupon.create', actorId: adminId, after: expect.objectContaining({ code: c, value: 10 }) });
  });

  it('refuses a code another coupon has, whatever the case', async () => {
    const c = code();
    await create({ code: c }).expect(201);
    const dup = await create({ code: c.toLowerCase() }).expect(409);
    expect(fields(dup.body)).toEqual(['code']);
  });

  it('refuses broken rules and saves nothing', async () => {
    const c = code();
    const bad = await create({
      code: c,
      value: 150,
      startsAt: '2026-11-02T00:00:00+05:30',
      expiresAt: '2026-11-01T00:00:00+05:30',
    }).expect(400);
    expect(fields(bad.body)).toEqual(['value', 'expiresAt']);
    expect(fields((await create({ code: c, type: 'FIXED', value: 50000, maxDiscount: 10000 }).expect(400)).body)).toEqual(['maxDiscount']);
    expect(fields((await create({ code: c, serviceIds: [randomUUID()] }).expect(400)).body)).toEqual(['serviceIds']);
    expect(fields((await create({ code: c, serviceIds: [removed] }).expect(400)).body)).toEqual(['serviceIds']);
    expect(await prisma.coupon.count({ where: { code: c } })).toBe(0);
  });

  it('lists coupons with usage counted from redemptions', async () => {
    const used = (await create({ code: code(), usageLimit: 3 }).expect(201)).body as AdminCouponRow;
    const unused = (await create({ code: code() }).expect(201)).body as AdminCouponRow;
    await redeem(used.id, customers[0], 10000, new Date('2026-10-01T10:00:00Z'));
    await redeem(used.id, customers[0], 5000, new Date('2026-10-05T10:00:00Z'));
    await redeem(used.id, customers[1], 7500, new Date('2026-10-03T10:00:00Z'));

    const list = await http.get('/api/admin/coupons').set(as(admin)).expect(200);
    expect(adminCouponListSchema.safeParse(list.body).error).toBeUndefined();
    const rows = (list.body as AdminCouponRow[]).filter((r) => r.code.startsWith(prefix));
    expect(rows.find((r) => r.id === used.id)).toMatchObject({
      status: 'USED_UP',
      usage: { redemptions: 3, customers: 2, discountGiven: 22500, lastUsedAt: '2026-10-05T10:00:00.000Z' },
      inUse: true,
    });
    expect(rows.find((r) => r.id === unused.id)).toMatchObject({ status: 'ACTIVE', usage: { redemptions: 0 }, inUse: false });
    // Newest first.
    expect(rows.findIndex((r) => r.id === unused.id)).toBeLessThan(rows.findIndex((r) => r.id === used.id));
  });

  it('updates only what is sent and logs before/after', async () => {
    const c = (await create({ code: code(), maxDiscount: 20000 }).expect(201)).body as AdminCouponRow;
    const res = await patch(c.id, { value: 15, isActive: false }).expect(200);
    expect(res.body).toMatchObject({ value: 15, isActive: false, maxDiscount: 20000, status: 'INACTIVE' });
    const audit = await auditFor(c.id);
    expect(audit.map((a) => a.action)).toEqual(['coupon.create', 'coupon.update']);
    expect(audit[1]).toMatchObject({ before: expect.objectContaining({ value: 10, isActive: true }), after: expect.objectContaining({ value: 15, isActive: false }) });
  });

  it('checks the rules on the coupon as it would be after the update', async () => {
    const c = (await create({ code: code(), maxDiscount: 20000, startsAt: '2026-11-10T00:00:00+05:30' }).expect(201)).body as AdminCouponRow;
    expect(fields((await patch(c.id, { expiresAt: '2026-11-01T00:00:00+05:30' }).expect(400)).body)).toEqual(['expiresAt']);
    expect(fields((await patch(c.id, { value: 101 }).expect(400)).body)).toEqual(['value']);
    // Switching to a fixed amount drops the percentage cap.
    const fixed = await patch(c.id, { type: 'FIXED', value: 50000 }).expect(200);
    expect(fixed.body).toMatchObject({ type: 'FIXED', value: 50000, maxDiscount: null });
    expect(fields((await patch(c.id, { maxDiscount: 1000 }).expect(400)).body)).toEqual(['maxDiscount']);
  });

  it('keeps a service the coupon already had after it is removed from the catalogue', async () => {
    const svc = (await prisma.service.create({
      data: { slug: `e2e-ac-${run}-later`, categoryId: (await prisma.service.findUniqueOrThrow({ where: { id: gst } })).categoryId, name: 'Later removed', shortDescription: 'x' },
    })).id;
    const c = (await create({ code: code(), serviceIds: [svc] }).expect(201)).body as AdminCouponRow;
    await prisma.service.update({ where: { id: svc }, data: { deletedAt: new Date() } });
    const res = await patch(c.id, { serviceIds: [svc, gst], value: 12 }).expect(200);
    expect(res.body.services).toEqual([
      { id: svc, name: 'Later removed', removed: true },
      { id: gst, name: 'Coupon gst (test)', removed: false },
    ]);
  });

  it('changes the code of an unused coupon but not of one orders use', async () => {
    const fresh = (await create({ code: code() }).expect(201)).body as AdminCouponRow;
    const renamed = code();
    expect((await patch(fresh.id, { code: renamed.toLowerCase() }).expect(200)).body.code).toBe(renamed);

    const ordered = (await create({ code: code() }).expect(201)).body as AdminCouponRow;
    await prisma.order.create({ data: { code: `ORD-E2E-${run}-${n}`, customerId: customers[0], subtotal: 100000, total: 118000, couponId: ordered.id } });
    const refused = await patch(ordered.id, { code: code() }).expect(409);
    expect(fields(refused.body)).toEqual(['code']);
    // The same code, or other fields, are fine.
    await patch(ordered.id, { code: ordered.code, value: 20 }).expect(200);
  });

  it('deletes only a coupon no order has used', async () => {
    const unused = (await create({ code: code() }).expect(201)).body as AdminCouponRow;
    await http.delete(`/api/admin/coupons/${unused.id}`).set(as(admin)).expect(200);
    expect(await prisma.coupon.count({ where: { id: unused.id } })).toBe(0);
    expect((await auditFor(unused.id)).map((a) => a.action)).toEqual(['coupon.create', 'coupon.delete']);

    const used = (await create({ code: code() }).expect(201)).body as AdminCouponRow;
    await redeem(used.id, customers[1], 1000);
    const res = await http.delete(`/api/admin/coupons/${used.id}`).set(as(admin)).expect(409);
    expect(res.body.message).toMatch(/deactivate it instead/);
    expect(await prisma.coupon.count({ where: { id: used.id } })).toBe(1);
  });

  it('lists services to limit a coupon to, without removed ones', async () => {
    const res = await http.get('/api/admin/coupons/services').set(as(admin)).expect(200);
    expect(couponServiceOptionsSchema.safeParse(res.body).error).toBeUndefined();
    const ids = (res.body as { id: string }[]).map((s) => s.id);
    expect(ids).toContain(gst);
    expect(ids).not.toContain(removed);
  });

  it('needs coupons.manage', async () => {
    const c = (await create({ code: code() }).expect(201)).body as AdminCouponRow;
    await http.get('/api/admin/coupons').set(as(ops)).expect(403);
    await create({ code: code() }, ops).expect(403);
    await http.patch(`/api/admin/coupons/${c.id}`).set(as(ops)).send({ isActive: false }).expect(403);
    await http.delete(`/api/admin/coupons/${c.id}`).set(as(ops)).expect(403);
    await http.get('/api/admin/coupons').expect(401);
    await http.get(`/api/admin/coupons/${randomUUID()}`).set(as(admin)).expect(404);
    await patch(randomUUID(), { isActive: false }).expect(404);
  });
});
