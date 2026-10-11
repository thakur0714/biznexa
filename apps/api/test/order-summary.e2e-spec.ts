/**
 * Order summary & totals (M3.13): totals are recomputed on the server from package prices, coupon and
 * place of supply; client-sent amounts never get in; owner-only; frozen once payment has started.
 */
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { orderSummarySchema, type OrderSummary } from '@biznexa/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { SELLER_STATE_KEY } from '../src/applications/order-summary.service';

let app: NestExpressApplication;
let http: ReturnType<typeof request>;
let prisma: PrismaService;
let alice: string;
let aliceId: string;
let bob: string;
let serviceId: string;
let packageId: string;
let sellerSetting: { value: unknown } | null;

const run = Date.now().toString().slice(-7);
const base = '/api/applications';
const as = (token: string) => ({ authorization: `Bearer ${token}` });
const users = { email: { startsWith: `e2e-sum-${run}` } };
const slug = `e2e-sum-${run}`;
const codes: string[] = [];

// ₹1,000 fee + ₹4,500 government fee, 18 % GST.
const FEE = 100000;
const GOVT = 450000;

async function register(n: number) {
  const res = await http
    .post('/api/auth/register')
    .send({ name: 'Summary Test', mobile: `6${run}${String(n).padStart(2, '0')}`, email: `e2e-sum-${run}-${n}@example.com`, password: 'secret123', consent: true })
    .expect(201);
  return { token: res.body.accessToken as string, id: res.body.user.id as string };
}

/** A business for the customer in `state`, and a fresh draft application for it (null = as an individual). */
async function draft(token: string, ownerId: string, state: string | null | 'none') {
  let businessEntityId: string | null = null;
  if (state !== 'none') {
    businessEntityId = (await prisma.businessEntity.create({ data: { ownerId, legalName: `Biz ${randomUUID().slice(0, 6)}`, entityType: 'PRIVATE_LIMITED', state }, select: { id: true } })).id;
  }
  const res = await http.post(base).set(as(token)).send({ packageId, businessEntityId }).expect(201);
  return { id: res.body.id as string, orderId: res.body.order.id as string };
}

async function coupon(over: Record<string, unknown> = {}) {
  const code = `E2ESUM${run}${codes.length}`;
  codes.push(code);
  await prisma.coupon.create({ data: { code, type: 'PERCENTAGE', value: 10, perUserLimit: null, ...over } });
  return code;
}

const summary = async (token: string, id: string, status = 200) => (await http.get(`${base}/${id}/summary`).set(as(token)).expect(status)).body;
const apply = (token: string, id: string, body: unknown) => http.put(`${base}/${id}/coupon`).set(as(token)).send(body as object);
const storedOrder = (orderId: string) =>
  prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    select: { subtotal: true, discount: true, taxTotal: true, govtFees: true, total: true, couponId: true, buyerState: true, items: { select: { professionalFee: true, governmentFee: true, gstRate: true, discount: true } } },
  });

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
  await app.init();
  http = request(app.getHttpServer()) as unknown as ReturnType<typeof request>;
  prisma = app.get(PrismaService);
  ({ token: alice, id: aliceId } = await register(1));
  ({ token: bob } = await register(2));

  sellerSetting = await prisma.setting.findUnique({ where: { key: SELLER_STATE_KEY }, select: { value: true } });
  // Written as a two-letter code on purpose: businesses store state names (D40).
  await prisma.setting.upsert({ where: { key: SELLER_STATE_KEY }, update: { value: 'PB' }, create: { key: SELLER_STATE_KEY, value: 'PB' } });

  const cat = await prisma.category.findUniqueOrThrow({ where: { slug: 'licenses' } });
  const svc = await prisma.service.create({
    data: {
      slug,
      categoryId: cat.id,
      name: 'Order summary (test)',
      shortDescription: 'A service used to test the order summary.',
      sacCode: '998399',
      packages: { create: [{ name: 'Basic', professionalFee: FEE, governmentFee: GOVT, gstRate: 18 }] },
      formSchemas: { create: [{ version: 1, schema: { steps: [{ title: 'About', fields: [{ type: 'text', name: 'note', label: 'Note', required: false }] }] }, isCurrent: true }] },
    },
    select: { id: true, packages: { select: { id: true } } },
  });
  serviceId = svc.id;
  packageId = svc.packages[0].id;
});

afterAll(async () => {
  if (sellerSetting) await prisma.setting.update({ where: { key: SELLER_STATE_KEY }, data: { value: sellerSetting.value as object } });
  else await prisma.setting.deleteMany({ where: { key: SELLER_STATE_KEY } });
  await prisma.application.deleteMany({ where: { order: { customer: users } } });
  await prisma.order.deleteMany({ where: { customer: users } });
  await prisma.coupon.deleteMany({ where: { code: { in: codes } } });
  await prisma.businessEntity.deleteMany({ where: { owner: users } });
  await prisma.service.deleteMany({ where: { slug } });
  await prisma.user.deleteMany({ where: users });
  await app.close();
});

describe('order summary (M3.13)', () => {
  it('needs a login and only shows the customer their own order', async () => {
    const { id } = await draft(alice, aliceId, 'Punjab');
    await http.get(`${base}/${id}/summary`).expect(401);
    await http.put(`${base}/${id}/coupon`).send({ code: 'X' }).expect(401);
    const missing = await summary(alice, randomUUID(), 404);
    expect(await summary(bob, id, 404)).toEqual(missing);
    await apply(bob, id, { code: await coupon() }).expect(404);
    await http.delete(`${base}/${id}/coupon`).set(as(bob)).expect(404);
  });

  it('same state as the seller: CGST + SGST on the fee only; government fee untaxed', async () => {
    const { id, orderId } = await draft(alice, aliceId, 'Punjab');
    const s: OrderSummary = orderSummarySchema.parse(await summary(alice, id));
    expect(s).toMatchObject({
      editable: true,
      placeOfSupply: { state: 'Punjab', source: 'BUSINESS' },
      taxType: 'CGST_SGST',
      professionalFee: FEE,
      discount: 0,
      taxableValue: FEE,
      cgst: 9000,
      sgst: 9000,
      igst: 0,
      taxTotal: 18000,
      governmentFee: GOVT,
      total: FEE + 18000 + GOVT,
      coupon: null,
    });
    expect(s.lines).toEqual([expect.objectContaining({ description: 'Order summary (test) — Basic', sacCode: '998399', gstRate: 18, total: FEE + 18000 + GOVT })]);
    expect(await storedOrder(orderId)).toMatchObject({ subtotal: FEE, taxTotal: 18000, govtFees: GOVT, total: FEE + 18000 + GOVT, buyerState: 'Punjab' });
  });

  it('another state: IGST', async () => {
    const { id } = await draft(alice, aliceId, 'Karnataka');
    expect(await summary(alice, id)).toMatchObject({ placeOfSupply: { state: 'Karnataka', source: 'BUSINESS' }, taxType: 'IGST', cgst: 0, sgst: 0, igst: 18000, total: FEE + 18000 + GOVT });
  });

  it('individuals: profile state when on record, else the seller’s state', async () => {
    const { id, orderId } = await draft(alice, aliceId, 'none');
    expect(await summary(alice, id)).toMatchObject({ placeOfSupply: { state: 'Punjab', source: 'SELLER' }, taxType: 'CGST_SGST' });
    expect((await storedOrder(orderId)).buyerState).toBeNull();

    await prisma.customerProfile.upsert({ where: { userId: aliceId }, update: { state: 'DL' }, create: { userId: aliceId, state: 'DL' } });
    try {
      expect(await summary(alice, id)).toMatchObject({ placeOfSupply: { state: 'Delhi', source: 'PROFILE' }, taxType: 'IGST', igst: 18000 });
      expect((await storedOrder(orderId)).buyerState).toBe('Delhi');
    } finally {
      await prisma.customerProfile.update({ where: { userId: aliceId }, data: { state: null } });
    }
  });

  it('applies a coupon to the fee before GST, stores it on the order and its line, and removes it', async () => {
    const { id, orderId } = await draft(alice, aliceId, 'Punjab');
    const code = await coupon({ value: 20 });
    const s = (await apply(alice, id, { code: ` ${code.toLowerCase()} ` }).expect(200)).body;
    expect(s).toMatchObject({ coupon: { code, discount: 20000 }, discount: 20000, taxableValue: 80000, cgst: 7200, sgst: 7200, governmentFee: GOVT, total: 80000 + 14400 + GOVT });
    const stored = await storedOrder(orderId);
    expect(stored).toMatchObject({ discount: 20000, taxTotal: 14400, total: 80000 + 14400 + GOVT });
    expect(stored.couponId).not.toBeNull();
    expect(stored.items).toEqual([expect.objectContaining({ discount: 20000 })]);

    const removed = (await http.delete(`${base}/${id}/coupon`).set(as(alice)).expect(200)).body;
    expect(removed).toMatchObject({ coupon: null, discount: 0, total: FEE + 18000 + GOVT });
    expect(await storedOrder(orderId)).toMatchObject({ couponId: null, discount: 0, items: [expect.objectContaining({ discount: 0 })] });
  });

  it('refuses a coupon that does not apply with the reason on `code`, keeping the one already applied', async () => {
    const { id, orderId } = await draft(alice, aliceId, 'Punjab');
    const good = await coupon({ type: 'FIXED', value: 10000 });
    await apply(alice, id, { code: good }).expect(200);

    const unknown = await apply(alice, id, { code: 'NOPE-NOT-REAL' }).expect(400);
    expect(unknown.body.errors).toEqual([{ field: 'code', message: 'This coupon code is not valid.' }]);
    const expired = await apply(alice, id, { code: await coupon({ expiresAt: new Date(Date.now() - 60_000) }) }).expect(400);
    expect(expired.body.errors[0]).toEqual({ field: 'code', message: 'This coupon has expired.' });
    const otherService = await apply(alice, id, { code: await coupon({ serviceIds: [randomUUID()] }) }).expect(400);
    expect(otherService.body.errors[0].field).toBe('code');
    const minOrder = await apply(alice, id, { code: await coupon({ minOrderValue: FEE + 1 }) }).expect(400);
    expect(minOrder.body.errors[0].message).toMatch(/minimum/);

    expect(await storedOrder(orderId)).toMatchObject({ discount: 10000 });
    expect(await summary(alice, id)).toMatchObject({ coupon: { code: good, discount: 10000 } });
  });

  it('drops a coupon that stopped applying since it was added, and says so', async () => {
    const { id, orderId } = await draft(alice, aliceId, 'Punjab');
    const code = await coupon();
    await apply(alice, id, { code }).expect(200);
    await prisma.coupon.update({ where: { code }, data: { isActive: false } });
    const s = await summary(alice, id);
    expect(s).toMatchObject({ coupon: null, discount: 0, total: FEE + 18000 + GOVT });
    expect(s.couponNotice).toContain(code);
    expect(await storedOrder(orderId)).toMatchObject({ couponId: null, discount: 0 });
  });

  describe('tampering', () => {
    it('refuses amounts sent with the coupon and stores nothing', async () => {
      const { id, orderId } = await draft(alice, aliceId, 'Punjab');
      await summary(alice, id);
      const before = await storedOrder(orderId);
      const code = await coupon();
      for (const extra of [{ total: 1 }, { discount: 99999999 }, { amount: 100 }, { professionalFee: 0, gstRate: 0 }, { couponId: randomUUID() }]) {
        await apply(alice, id, { code, ...extra }).expect(400);
      }
      await apply(alice, id, { code: { discount: 50000 } }).expect(400);
      expect(await storedOrder(orderId)).toEqual(before);
    });

    it('ignores amounts in the query string', async () => {
      const { id } = await draft(alice, aliceId, 'Punjab');
      const res = await http.get(`${base}/${id}/summary?total=100&discount=999999&gstRate=0`).set(as(alice)).expect(200);
      expect(res.body).toMatchObject({ discount: 0, taxTotal: 18000, total: FEE + 18000 + GOVT });
    });

    it('recomputes stored totals that were altered, from the package prices', async () => {
      const { id, orderId } = await draft(alice, aliceId, 'Punjab');
      await prisma.order.update({ where: { id: orderId }, data: { subtotal: 1, discount: 99999, taxTotal: 0, govtFees: 0, total: 1 } });
      await prisma.orderItem.updateMany({ where: { orderId }, data: { professionalFee: 1, governmentFee: 0, gstRate: 0, discount: 99999 } });
      expect(await summary(alice, id)).toMatchObject({ professionalFee: FEE, discount: 0, taxTotal: 18000, governmentFee: GOVT, total: FEE + 18000 + GOVT });
      expect(await storedOrder(orderId)).toMatchObject({
        subtotal: FEE,
        discount: 0,
        taxTotal: 18000,
        govtFees: GOVT,
        total: FEE + 18000 + GOVT,
        items: [{ professionalFee: FEE, governmentFee: GOVT, gstRate: 18, discount: 0 }],
      });
    });
  });

  it('uses the current package price, and refuses a package no longer offered', async () => {
    const { id } = await draft(alice, aliceId, 'Karnataka');
    await prisma.servicePackage.update({ where: { id: packageId }, data: { professionalFee: 200000 } });
    try {
      expect(await summary(alice, id)).toMatchObject({ professionalFee: 200000, igst: 36000, total: 200000 + 36000 + GOVT });
      await prisma.servicePackage.update({ where: { id: packageId }, data: { isActive: false } });
      const res = await summary(alice, id, 409);
      expect(res.message).toMatch(/no longer offered/);
    } finally {
      await prisma.servicePackage.update({ where: { id: packageId }, data: { professionalFee: FEE, isActive: true } });
    }
  });

  it('freezes totals once payment has started', async () => {
    const { id, orderId } = await draft(alice, aliceId, 'Punjab');
    const code = await coupon();
    await apply(alice, id, { code }).expect(200);
    await prisma.order.update({ where: { id: orderId }, data: { status: 'PAYMENT_PENDING' } });
    await prisma.application.update({ where: { id }, data: { status: 'PAYMENT_PENDING' } });
    // A price change after payment started must not change what is shown.
    await prisma.servicePackage.update({ where: { id: packageId }, data: { professionalFee: 300000 } });
    try {
      const s = await summary(alice, id);
      expect(s).toMatchObject({ editable: false, orderStatus: 'PAYMENT_PENDING', coupon: { code, discount: 10000 }, discount: 10000, cgst: 8100, sgst: 8100, total: 90000 + 16200 + GOVT });
      expect(s.placeOfSupply).toEqual({ state: 'Punjab', source: 'BUSINESS' });
      await apply(alice, id, { code }).expect(409);
      await http.delete(`${base}/${id}/coupon`).set(as(alice)).expect(409);
    } finally {
      await prisma.servicePackage.update({ where: { id: packageId }, data: { professionalFee: FEE } });
    }
  });

  it('applies a coupon limited to this service', async () => {
    const { id } = await draft(alice, aliceId, 'Punjab');
    const code = await coupon({ serviceIds: [serviceId], type: 'FIXED', value: 5000 });
    expect((await apply(alice, id, { code }).expect(200)).body).toMatchObject({ coupon: { code, discount: 5000 }, lines: [expect.objectContaining({ discount: 5000 })] });
  });
});
