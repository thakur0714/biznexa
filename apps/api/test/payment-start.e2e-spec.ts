/**
 * Start payment (M3.16): the server charges the total it computes now; a Payment (CREATED) and a gateway
 * order are created, and the order and application move to PAYMENT_PENDING with history, audit and event.
 * Owner-only; no client amounts; incomplete forms and changed coupons stop it; repeats and concurrent
 * clicks share one payment; a gateway outage leaves the payment open for a retry.
 */
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { paymentCheckoutSchema, type DomainEvent } from '@biznexa/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { EventBus } from '../src/events/event-bus';
import { SELLER_STATE_KEY } from '../src/applications/order-summary.service';
import { PaymentGateway, PaymentGatewayError } from '../src/payments/payment-gateway';
import { MockPaymentGateway } from '../src/payments/mock-payment-gateway';

let app: NestExpressApplication;
let http: ReturnType<typeof request>;
let prisma: PrismaService;
let gateway: MockPaymentGateway;
let events: DomainEvent<'application.status_changed'>[] = [];
let alice: string;
let aliceId: string;
let bob: string;
let packageId: string;
let sellerSetting: { value: unknown } | null;

const run = Date.now().toString().slice(-7);
const base = '/api/applications';
const as = (token: string) => ({ authorization: `Bearer ${token}` });
const users = { email: { startsWith: `e2e-pay-${run}` } };
const slug = `e2e-pay-${run}`;
const codes: string[] = [];

// ₹1,000 fee + ₹4,500 government fee, 18 % GST; the business is in the seller's state (CGST + SGST).
const FEE = 100000;
const GOVT = 450000;
const TOTAL = FEE + 18000 + GOVT;

async function register(n: number) {
  const res = await http
    .post('/api/auth/register')
    .send({ name: `Pay Test ${n}`, mobile: `7${run}${String(n).padStart(2, '0')}`, email: `e2e-pay-${run}-${n}@example.com`, password: 'secret123', consent: true })
    .expect(201);
  return { token: res.body.accessToken as string, id: res.body.user.id as string };
}

/** A fresh draft for a new Punjab business, with the form completed unless `complete` is false. */
async function draft(token: string, ownerId: string, complete = true) {
  const businessEntityId = (await prisma.businessEntity.create({ data: { ownerId, legalName: `Biz ${randomUUID().slice(0, 6)}`, entityType: 'PRIVATE_LIMITED', state: 'Punjab' }, select: { id: true } })).id;
  const res = await http.post(base).set(as(token)).send({ packageId, businessEntityId }).expect(201);
  const id = res.body.id as string;
  if (complete) await http.patch(`${base}/${id}`).set(as(token)).send({ formData: { note: 'Ready' }, final: true }).expect(200);
  return { id, orderId: res.body.order.id as string };
}

async function coupon(over: Record<string, unknown> = {}) {
  const code = `E2EPAY${run}${codes.length}`;
  codes.push(code);
  await prisma.coupon.create({ data: { code, type: 'PERCENTAGE', value: 10, perUserLimit: null, ...over } });
  return code;
}

const pay = (token: string, id: string, body?: object) => {
  const req = http.post(`${base}/${id}/payment`).set(as(token));
  return body ? req.send(body) : req;
};
const state = async (id: string, orderId: string) => {
  const [a, o, payments, history] = await Promise.all([
    prisma.application.findUniqueOrThrow({ where: { id }, select: { status: true } }),
    prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true, total: true, couponId: true } }),
    prisma.payment.findMany({ where: { orderId }, select: { id: true, amount: true, status: true, gateway: true, gatewayOrderId: true } }),
    prisma.applicationStageHistory.findMany({ where: { applicationId: id, status: 'PAYMENT_PENDING' }, select: { changedById: true, note: true } }),
  ]);
  return { application: a.status, order: o.status, total: o.total, couponId: o.couponId, payments, history };
};

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
  await app.init();
  http = request(app.getHttpServer()) as unknown as ReturnType<typeof request>;
  prisma = app.get(PrismaService);
  gateway = app.get(PaymentGateway) as MockPaymentGateway;
  app.get(EventBus).on('application.status_changed', (e) => void events.push(e));
  ({ token: alice, id: aliceId } = await register(1));
  ({ token: bob } = await register(2));

  sellerSetting = await prisma.setting.findUnique({ where: { key: SELLER_STATE_KEY }, select: { value: true } });
  await prisma.setting.upsert({ where: { key: SELLER_STATE_KEY }, update: { value: 'Punjab' }, create: { key: SELLER_STATE_KEY, value: 'Punjab' } });

  const cat = await prisma.category.findUniqueOrThrow({ where: { slug: 'licenses' } });
  const svc = await prisma.service.create({
    data: {
      slug,
      categoryId: cat.id,
      name: 'Payment start (test)',
      shortDescription: 'A service used to test starting a payment.',
      sacCode: '998399',
      packages: { create: [{ name: 'Basic', professionalFee: FEE, governmentFee: GOVT, gstRate: 18 }] },
      formSchemas: { create: [{ version: 1, schema: { steps: [{ title: 'About', fields: [{ type: 'text', name: 'note', label: 'Note', required: true }] }] }, isCurrent: true }] },
    },
    select: { packages: { select: { id: true } } },
  });
  packageId = svc.packages[0].id;
});

beforeEach(() => {
  events = [];
  gateway.failNextCall = null;
});

afterAll(async () => {
  if (sellerSetting) await prisma.setting.update({ where: { key: SELLER_STATE_KEY }, data: { value: sellerSetting.value as object } });
  else await prisma.setting.deleteMany({ where: { key: SELLER_STATE_KEY } });
  await prisma.auditLog.deleteMany({ where: { actor: users } });
  await prisma.payment.deleteMany({ where: { order: { customer: users } } });
  await prisma.application.deleteMany({ where: { order: { customer: users } } });
  await prisma.order.deleteMany({ where: { customer: users } });
  await prisma.coupon.deleteMany({ where: { code: { in: codes } } });
  await prisma.businessEntity.deleteMany({ where: { owner: users } });
  await prisma.service.deleteMany({ where: { slug } });
  await prisma.user.deleteMany({ where: users });
  await app.close();
});

describe('start payment (M3.16)', () => {
  it('needs a login and only pays for the customer’s own application', async () => {
    const { id, orderId } = await draft(alice, aliceId);
    await http.post(`${base}/${id}/payment`).expect(401);
    const missing = (await pay(alice, randomUUID()).expect(404)).body;
    expect((await pay(bob, id).expect(404)).body).toEqual(missing);
    expect(await state(id, orderId)).toMatchObject({ application: 'DRAFT', order: 'CREATED', payments: [], history: [] });
  });

  it('creates a CREATED payment and gateway order for the server total, and moves order + application to PAYMENT_PENDING', async () => {
    const { id, orderId } = await draft(alice, aliceId);
    const code = await coupon({ value: 20 });
    await http.put(`${base}/${id}/coupon`).set(as(alice)).send({ code }).expect(200);
    const charged = 80000 + 14400 + GOVT;

    const res = paymentCheckoutSchema.parse((await pay(alice, id).expect(200)).body);
    expect(res).toMatchObject({ gateway: 'MOCK', key: gateway.checkoutKey, amount: charged, currency: 'INR', applicationId: id, description: 'Payment start (test) — Basic' });
    expect(res.prefill).toEqual({ name: 'Pay Test 1', email: `e2e-pay-${run}-1@example.com`, contact: expect.any(String) });

    const s = await state(id, orderId);
    expect(s).toMatchObject({ application: 'PAYMENT_PENDING', order: 'PAYMENT_PENDING', total: charged });
    expect(s.payments).toEqual([{ id: res.paymentId, amount: charged, status: 'CREATED', gateway: 'MOCK', gatewayOrderId: res.gatewayOrderId }]);
    expect(s.history).toEqual([{ changedById: aliceId, note: 'Payment started' }]);

    const gwOrder = gateway.orders.get(res.gatewayOrderId);
    expect(gwOrder).toMatchObject({ amount: charged, receipt: res.paymentId, notes: { paymentId: res.paymentId, applicationCode: res.applicationCode, orderCode: res.orderCode } });

    const audit = await prisma.auditLog.findMany({ where: { entityType: 'Application', entityId: id }, select: { actorId: true, action: true, before: true, after: true } });
    expect(audit).toEqual([
      {
        actorId: aliceId,
        action: 'application.payment_start',
        before: { status: 'DRAFT', orderStatus: 'CREATED' },
        after: { status: 'PAYMENT_PENDING', orderStatus: 'PAYMENT_PENDING', paymentId: res.paymentId, amount: charged },
      },
    ]);
    expect(events.map((e) => e.payload)).toEqual([{ applicationId: id, from: 'DRAFT', to: 'PAYMENT_PENDING', actorId: aliceId }]);

    // Payment has started: the form and coupon are frozen.
    await http.patch(`${base}/${id}`).set(as(alice)).send({ formData: { note: 'Changed' } }).expect(409);
    await http.delete(`${base}/${id}/coupon`).set(as(alice)).expect(409);
  });

  it('tampering: amounts in the body are refused, and totals altered in the DB are recomputed before charging', async () => {
    const { id, orderId } = await draft(alice, aliceId);
    for (const body of [{ amount: 100 }, { total: 100 }, { couponId: randomUUID() }]) {
      const res = await pay(alice, id, body).expect(400);
      expect(res.body.errors[0].field).toBe('');
    }
    expect(await state(id, orderId)).toMatchObject({ application: 'DRAFT', order: 'CREATED', payments: [] });

    await prisma.order.update({ where: { id: orderId }, data: { total: 100, taxTotal: 0 } });
    const res = (await pay(alice, id, {}).expect(200)).body;
    expect(res.amount).toBe(TOTAL);
    expect(gateway.orders.get(res.gatewayOrderId)?.amount).toBe(TOTAL);
    expect((await state(id, orderId)).total).toBe(TOTAL);
  });

  it('refuses incomplete answers with the fields listed, changing nothing', async () => {
    const { id, orderId } = await draft(alice, aliceId, false);
    await http.patch(`${base}/${id}`).set(as(alice)).send({ formData: {} }).expect(200);
    const res = await pay(alice, id).expect(400);
    expect(res.body.errors).toEqual([{ field: 'note', message: expect.any(String) }]);
    expect(await state(id, orderId)).toMatchObject({ application: 'DRAFT', order: 'CREATED', payments: [], history: [] });
    expect(events).toEqual([]);
  });

  it('stops when the coupon stopped applying, so the customer sees the new total first', async () => {
    const { id, orderId } = await draft(alice, aliceId);
    const code = await coupon();
    await http.put(`${base}/${id}/coupon`).set(as(alice)).send({ code }).expect(200);
    await prisma.coupon.update({ where: { code }, data: { isActive: false } });

    const res = await pay(alice, id).expect(409);
    expect(res.body.message).toMatch(new RegExp(`Coupon ${code} was removed.*new total`));
    const s = await state(id, orderId);
    expect(s).toMatchObject({ application: 'DRAFT', order: 'CREATED', payments: [] });
    expect(s.couponId).not.toBeNull(); // rolled back; the summary page drops it with a notice

    const summary = (await http.get(`${base}/${id}/summary`).set(as(alice)).expect(200)).body;
    expect(summary).toMatchObject({ coupon: null, total: TOTAL, couponNotice: expect.stringContaining(code) });
    expect((await pay(alice, id).expect(200)).body.amount).toBe(TOTAL);
  });

  it('a repeat call returns the same payment at the frozen total, even after a price change', async () => {
    const { id, orderId } = await draft(alice, aliceId);
    const first = (await pay(alice, id).expect(200)).body;
    await prisma.servicePackage.update({ where: { id: packageId }, data: { professionalFee: 300000 } });
    try {
      const again = (await pay(alice, id).expect(200)).body;
      expect(again).toEqual(first);
      const s = await state(id, orderId);
      expect(s.payments).toHaveLength(1);
      expect(s.history).toHaveLength(1);
      expect(events).toHaveLength(1);
    } finally {
      await prisma.servicePackage.update({ where: { id: packageId }, data: { professionalFee: FEE } });
    }
  });

  it('concurrent clicks: one payment, one gateway order shown, one status change', async () => {
    const { id, orderId } = await draft(alice, aliceId);
    const results = await Promise.all(Array.from({ length: 6 }, () => pay(alice, id)));
    expect(results.map((r) => r.status)).toEqual(Array(6).fill(200));
    expect(new Set(results.map((r) => r.body.paymentId)).size).toBe(1);
    expect(new Set(results.map((r) => r.body.gatewayOrderId)).size).toBe(1);

    const s = await state(id, orderId);
    expect(s.payments).toEqual([expect.objectContaining({ id: results[0].body.paymentId, gatewayOrderId: results[0].body.gatewayOrderId, amount: TOTAL })]);
    expect(s.history).toHaveLength(1);
    expect(events).toHaveLength(1);
  });

  it('gateway outage: 503, the payment stays open, and trying again completes it', async () => {
    const { id, orderId } = await draft(alice, aliceId);
    gateway.failNextCall = new PaymentGatewayError('Razorpay request timed out', true);
    const down = await pay(alice, id).expect(503);
    expect(down.body.message).toMatch(/try again/);
    expect(JSON.stringify(down.body)).not.toMatch(/Razorpay request timed out/);

    const s = await state(id, orderId);
    expect(s).toMatchObject({ application: 'PAYMENT_PENDING', order: 'PAYMENT_PENDING' });
    expect(s.payments).toEqual([expect.objectContaining({ status: 'CREATED', gatewayOrderId: null })]);

    gateway.failNextCall = new PaymentGatewayError('Bad request', false, 400, 'BAD_REQUEST_ERROR');
    await pay(alice, id).expect(502);

    const ok = (await pay(alice, id).expect(200)).body;
    expect(ok.paymentId).toBe(s.payments[0].id);
    expect((await state(id, orderId)).payments).toEqual([expect.objectContaining({ id: ok.paymentId, gatewayOrderId: ok.gatewayOrderId })]);
    expect(events).toHaveLength(1);
  });

  it('a failed payment gets a new one for the same frozen total', async () => {
    const { id, orderId } = await draft(alice, aliceId);
    const first = (await pay(alice, id).expect(200)).body;
    await prisma.payment.update({ where: { id: first.paymentId }, data: { status: 'FAILED' } }); // what M3.17 does on payment.failed
    const second = (await pay(alice, id).expect(200)).body;
    expect(second.paymentId).not.toBe(first.paymentId);
    expect(second.gatewayOrderId).not.toBe(first.gatewayOrderId);
    expect(second.amount).toBe(TOTAL);
    expect((await state(id, orderId)).payments).toHaveLength(2);
  });

  it('refuses a paid order or an application that has moved on', async () => {
    const { id, orderId } = await draft(alice, aliceId);
    await prisma.order.update({ where: { id: orderId }, data: { status: 'PAID' } });
    await prisma.application.update({ where: { id }, data: { status: 'SUBMITTED' } });
    expect((await pay(alice, id).expect(409)).body.message).toBe('This order is already paid.');
    expect((await state(id, orderId)).payments).toEqual([]);
  });
});
