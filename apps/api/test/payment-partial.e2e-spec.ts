/**
 * Part payments (M3.19): a package that allows it offers an advance (the whole government fee + its % of
 * the fee and GST); paying it makes the order PARTIALLY_PAID and submits the application; "pay balance"
 * is a new payment for `total − amountPaid` that makes the order PAID. Amounts always come from the
 * server, the advance % is frozen with the prices, and money beyond the total is kept apart for a refund.
 */
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { AnyDomainEvent } from '@biznexa/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { EventBus } from '../src/events/event-bus';
import { SELLER_STATE_KEY } from '../src/applications/order-summary.service';
import { PaymentGateway, type GatewayPayment } from '../src/payments/payment-gateway';
import { MockPaymentGateway } from '../src/payments/mock-payment-gateway';

let app: NestExpressApplication;
let http: ReturnType<typeof request>;
let prisma: PrismaService;
let gateway: MockPaymentGateway;
let events: AnyDomainEvent[] = [];
let alice: string;
let aliceId: string;
let packageId: string;
let fullOnlyPackageId: string;
let sellerSetting: { value: unknown } | null;

const run = Date.now().toString().slice(-7);
const base = '/api/applications';
const hook = '/api/payments/webhook';
const as = (token: string) => ({ authorization: `Bearer ${token}` });
const users = { email: { startsWith: `e2e-part-${run}` } };
const slugs = [`e2e-part-${run}`, `e2e-part-full-${run}`];
const codes: string[] = [];
const eventIds: string[] = [];

// ₹1,000 fee + ₹4,500 government fee, 18 % GST, intra-state; 30 % advance on the fee + GST.
const FEE = 100000;
const GOVT = 450000;
const TOTAL = FEE + 18000 + GOVT;
// The whole government fee + 30 % of ₹1,180 (₹354) now; ₹826 later.
const ADVANCE = GOVT + 35400;
const BALANCE = TOTAL - ADVANCE;

async function register(n: number) {
  const res = await http
    .post('/api/auth/register')
    .send({ name: `Part Pay Test ${n}`, mobile: `9${run}${String(50 + n)}`, email: `e2e-part-${run}-${n}@example.com`, password: 'secret123', consent: true })
    .expect(201);
  return { token: res.body.accessToken as string, id: res.body.user.id as string };
}

async function coupon() {
  const code = `E2EPART${run}${codes.length}`;
  codes.push(code);
  await prisma.coupon.create({ data: { code, type: 'PERCENTAGE', value: 10, perUserLimit: null } });
  return code;
}

/** A completed draft (optionally with a coupon), ready to pay. */
async function ready(pkg = packageId, couponCode?: string) {
  const businessEntityId = (
    await prisma.businessEntity.create({ data: { ownerId: aliceId, legalName: `Biz ${randomUUID().slice(0, 6)}`, entityType: 'PRIVATE_LIMITED', state: 'Punjab' }, select: { id: true } })
  ).id;
  const draft = await http.post(base).set(as(alice)).send({ packageId: pkg, businessEntityId }).expect(201);
  const id = draft.body.id as string;
  await http.patch(`${base}/${id}`).set(as(alice)).send({ formData: { note: 'Ready' }, final: true }).expect(200);
  if (couponCode) await http.put(`${base}/${id}/coupon`).set(as(alice)).send({ code: couponCode }).expect(200);
  events = [];
  return { id, orderId: draft.body.order.id as string };
}

/** Sends a webhook exactly as built (body bytes + headers). */
function send(w: { body: string; headers: Record<string, string> }) {
  eventIds.push(w.headers['x-razorpay-event-id']);
  return http.post(hook).set(w.headers).send(w.body);
}
const captured = (payment: GatewayPayment, eventId?: string) => gateway.webhook('payment.captured', payment, eventId);
const startPay = (id: string, body: object = {}) => http.post(`${base}/${id}/payment`).set(as(alice)).send(body);
const statusOf = async (id: string) => (await http.get(`${base}/${id}/payment`).set(as(alice)).expect(200)).body;
const summaryOf = async (id: string) => (await http.get(`${base}/${id}/summary`).set(as(alice)).expect(200)).body;
/** The customer completes checkout for this gateway order and the gateway confirms it. */
const payAndConfirm = (gatewayOrderId: string) => send(captured(gateway.pay(gatewayOrderId).payment));

async function state(id: string, orderId: string) {
  const [a, o, payments, history, redemptions, hooks] = await Promise.all([
    prisma.application.findUniqueOrThrow({ where: { id }, select: { status: true, submittedAt: true } }),
    prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true, amountPaid: true, coupon: { select: { usedCount: true } } } }),
    prisma.payment.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' }, select: { id: true, status: true, gatewayPaymentId: true, method: true, failureReason: true, paidAt: true } }),
    prisma.applicationStageHistory.findMany({ where: { applicationId: id, status: { notIn: ['DRAFT', 'PAYMENT_PENDING'] } }, orderBy: { changedAt: 'asc' }, select: { status: true, note: true, changedById: true } }),
    prisma.couponRedemption.findMany({ where: { orderId }, select: { userId: true, amount: true } }),
    prisma.paymentWebhookEvent.findMany({ where: { payment: { orderId } }, orderBy: { receivedAt: 'asc' }, select: { event: true, outcome: true } }),
  ]);
  return { application: a.status, submittedAt: a.submittedAt, order: o.status, amountPaid: o.amountPaid, usedCount: o.coupon?.usedCount, payments, history, redemptions, hooks };
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true }));
  await app.init();
  http = request(app.getHttpServer()) as unknown as ReturnType<typeof request>;
  prisma = app.get(PrismaService);
  gateway = app.get(PaymentGateway) as MockPaymentGateway;
  // Invoice PDFs (M3.23) are generated in the background and can land during a later test: not counted here.
  app.get(EventBus).onAny((e) => void (e.name !== 'pdf.generated' && events.push(e)));
  ({ token: alice, id: aliceId } = await register(1));

  sellerSetting = await prisma.setting.findUnique({ where: { key: SELLER_STATE_KEY }, select: { value: true } });
  await prisma.setting.upsert({ where: { key: SELLER_STATE_KEY }, update: { value: 'Punjab' }, create: { key: SELLER_STATE_KEY, value: 'Punjab' } });

  const cat = await prisma.category.findUniqueOrThrow({ where: { slug: 'licenses' } });
  const form = { create: [{ version: 1, schema: { steps: [{ title: 'About', fields: [{ type: 'text', name: 'note', label: 'Note', required: true }] }] }, isCurrent: true }] };
  const service = (slug: string, name: string, partial: boolean) =>
    prisma.service.create({
      data: {
        slug,
        categoryId: cat.id,
        name,
        shortDescription: 'A service used to test part payments.',
        sacCode: '998399',
        packages: { create: [{ name: 'Basic', professionalFee: FEE, governmentFee: GOVT, gstRate: 18, allowPartial: partial, advancePercent: partial ? 30 : null }] },
        formSchemas: form,
      },
      select: { packages: { select: { id: true } } },
    });
  packageId = (await service(slugs[0], 'Part payment (test)', true)).packages[0].id;
  fullOnlyPackageId = (await service(slugs[1], 'Full payment only (test)', false)).packages[0].id;
});

beforeEach(() => {
  events = [];
});

afterAll(async () => {
  if (sellerSetting) await prisma.setting.update({ where: { key: SELLER_STATE_KEY }, data: { value: sellerSetting.value as object } });
  else await prisma.setting.deleteMany({ where: { key: SELLER_STATE_KEY } });
  const orders = { customer: users };
  await prisma.auditLog.deleteMany({ where: { OR: [{ actor: users }, { entityType: 'Application', entityId: { in: (await prisma.application.findMany({ where: { order: orders }, select: { id: true } })).map((a) => a.id) } }] } });
  await prisma.paymentWebhookEvent.deleteMany({ where: { OR: [{ payment: { order: orders } }, { eventId: { in: eventIds } }] } });
  await prisma.couponRedemption.deleteMany({ where: { userId: aliceId } });
  // Invoices issued on payment.succeeded (M3.21); the counter keeps the numbers they took.
  await prisma.invoice.deleteMany({ where: { order: orders } });
  await prisma.payment.deleteMany({ where: { order: orders } });
  await prisma.application.deleteMany({ where: { order: orders } });
  await prisma.order.deleteMany({ where: orders });
  await prisma.coupon.deleteMany({ where: { code: { in: codes } } });
  await prisma.businessEntity.deleteMany({ where: { owner: users } });
  await prisma.service.deleteMany({ where: { slug: { in: slugs } } });
  await prisma.user.deleteMany({ where: users });
  await app.close();
});

describe('part payments (M3.19)', () => {
  it('the summary offers the advance only for packages that allow it, and the plan must fit', async () => {
    const s = await ready();
    expect(await summaryOf(s.id)).toMatchObject({ total: TOTAL, amountPaid: 0, balance: TOTAL, advance: { amount: ADVANCE, balance: BALANCE, percent: 30, governmentFee: GOVT } });
    await startPay(s.id, { plan: 'BALANCE' }).expect(409);

    const f = await ready(fullOnlyPackageId);
    expect((await summaryOf(f.id)).advance).toBeNull();
    await startPay(f.id, { plan: 'ADVANCE' }).expect(409);
    await startPay(f.id, { plan: 'ADVANCE', amount: 100 }).expect(400);
    await startPay(f.id, { plan: 'HALF' }).expect(400);
    expect(await state(f.id, f.orderId)).toMatchObject({ application: 'DRAFT', order: 'CREATED', payments: [] });

    // Paying in full stays the default, and pays the order outright.
    const full = (await startPay(s.id).expect(200)).body;
    expect(full).toMatchObject({ plan: 'FULL', amount: TOTAL });
    await payAndConfirm(full.gatewayOrderId).expect(200);
    expect(await state(s.id, s.orderId)).toMatchObject({ application: 'SUBMITTED', order: 'PAID', amountPaid: TOTAL });
  });

  it('advance, then balance: PARTIALLY_PAID and submitted, then PAID with nothing else changed', async () => {
    const code = await coupon();
    const s = await ready(packageId, code);
    // 10 % off the fee: ₹900 + ₹162 GST, so 30 % of ₹1,062 = ₹318.60 → ₹319.
    const total = 90000 + 16200 + GOVT;
    const advance = GOVT + 31900;
    expect((await summaryOf(s.id)).advance).toMatchObject({ amount: advance, balance: total - advance });

    const adv = (await startPay(s.id, { plan: 'ADVANCE' }).expect(200)).body;
    expect(adv).toMatchObject({ plan: 'ADVANCE', amount: advance });
    expect(adv.description).toMatch(/^Advance · /);
    expect(gateway.orders.get(adv.gatewayOrderId)).toMatchObject({ amount: advance, notes: { plan: 'ADVANCE' } });
    expect(await statusOf(s.id)).toMatchObject({ outcome: 'AWAITING', payment: { plan: 'ADVANCE', amount: advance } });

    await payAndConfirm(adv.gatewayOrderId).expect(200);
    const afterAdvance = await state(s.id, s.orderId);
    expect(afterAdvance).toMatchObject({ application: 'SUBMITTED', order: 'PARTIALLY_PAID', amountPaid: advance, usedCount: 1 });
    expect(afterAdvance.history).toEqual([{ status: 'SUBMITTED', note: 'Advance received', changedById: null }]);
    expect(afterAdvance.redemptions).toEqual([{ userId: aliceId, amount: 10000 }]);
    expect(events.find((e) => e.name === 'payment.succeeded')?.payload).toMatchObject({ amount: advance, applicationIds: [s.id] });
    expect(await statusOf(s.id)).toMatchObject({ outcome: 'PAID', orderStatus: 'PARTIALLY_PAID', amountPaid: advance, balance: total - advance, payment: { status: 'SUCCESS', plan: null } });
    expect(await summaryOf(s.id)).toMatchObject({ editable: false, total, amountPaid: advance, balance: total - advance, advance: null });

    // Only the balance is left to pay.
    await startPay(s.id, { plan: 'FULL' }).expect(409);
    await startPay(s.id, { plan: 'ADVANCE' }).expect(409);
    const bal = (await startPay(s.id).expect(200)).body;
    expect(bal).toMatchObject({ plan: 'BALANCE', amount: total - advance });
    expect(bal.paymentId).not.toBe(adv.paymentId);
    expect((await startPay(s.id, { plan: 'BALANCE' }).expect(200)).body.paymentId).toBe(bal.paymentId);
    expect(await statusOf(s.id)).toMatchObject({ outcome: 'AWAITING', payment: { id: bal.paymentId, plan: 'BALANCE' } });

    // A failed balance attempt, then a new one that goes through.
    await send(gateway.webhook('payment.failed', gateway.fail(bal.gatewayOrderId, 'Card declined'))).expect(200);
    expect(await statusOf(s.id)).toMatchObject({ outcome: 'FAILED', orderStatus: 'PARTIALLY_PAID', payment: { id: bal.paymentId, plan: 'BALANCE', failureReason: 'Card declined' } });
    const retry = (await startPay(s.id).expect(200)).body;
    expect(retry.paymentId).not.toBe(bal.paymentId);
    events = [];
    const w = captured(gateway.pay(retry.gatewayOrderId).payment);
    await send(w).expect(200);
    await send(w).expect(200); // redelivery: applied once

    const paid = await state(s.id, s.orderId);
    expect(paid).toMatchObject({ application: 'SUBMITTED', order: 'PAID', amountPaid: total, usedCount: 1 });
    expect(paid.history).toEqual(afterAdvance.history);
    expect(paid.redemptions).toHaveLength(1);
    expect(events.map((e) => e.name)).toEqual(['payment.succeeded', 'invoice.issued']);
    expect(events[0].payload).toMatchObject({ paymentId: retry.paymentId, amount: total - advance, applicationIds: [] });
    const audit = await prisma.auditLog.findMany({ where: { entityType: 'Order', entityId: s.orderId }, select: { action: true, actorId: true, before: true, after: true } });
    expect(audit).toEqual([
      {
        action: 'order.balance_received',
        actorId: null,
        before: { status: 'PARTIALLY_PAID', amountPaid: advance },
        after: expect.objectContaining({ status: 'PAID', amountPaid: total, paymentId: retry.paymentId, amount: total - advance }),
      },
    ]);
    expect(await statusOf(s.id)).toMatchObject({ outcome: 'PAID', orderStatus: 'PAID', balance: 0 });
    await startPay(s.id).expect(409);
  });

  it('the advance is frozen with the prices; switching plan before paying makes a payment per amount', async () => {
    const s = await ready();
    const adv = (await startPay(s.id, { plan: 'ADVANCE' }).expect(200)).body;
    await prisma.servicePackage.update({ where: { id: packageId }, data: { advancePercent: 60 } });
    try {
      expect((await startPay(s.id, { plan: 'ADVANCE' }).expect(200)).body).toMatchObject({ paymentId: adv.paymentId, amount: ADVANCE });
      const full = (await startPay(s.id, { plan: 'FULL' }).expect(200)).body;
      expect(full).toMatchObject({ plan: 'FULL', amount: TOTAL });
      expect(full.paymentId).not.toBe(adv.paymentId);
      // Back to the advance: the open advance payment is reused.
      expect((await startPay(s.id, { plan: 'ADVANCE' }).expect(200)).body.paymentId).toBe(adv.paymentId);
      expect((await summaryOf(s.id)).advance).toMatchObject({ amount: ADVANCE, percent: 30 });
    } finally {
      await prisma.servicePackage.update({ where: { id: packageId }, data: { advancePercent: 30 } });
    }
  });

  it('the full amount paid in an old window after the advance is kept apart for a refund', async () => {
    const s = await ready();
    const adv = (await startPay(s.id, { plan: 'ADVANCE' }).expect(200)).body;
    const full = (await startPay(s.id, { plan: 'FULL' }).expect(200)).body;
    await payAndConfirm(adv.gatewayOrderId).expect(200);
    events = [];

    await payAndConfirm(full.gatewayOrderId).expect(200);
    const after = await state(s.id, s.orderId);
    expect(after).toMatchObject({ order: 'PARTIALLY_PAID', amountPaid: ADVANCE });
    expect(after.payments.map((p) => p.status)).toEqual(['SUCCESS', 'SUCCESS']);
    expect(after.hooks.map((h) => h.outcome)).toEqual(['applied', 'overpaid']);
    expect(events).toEqual([]);
    // The balance can still be paid as normal.
    expect((await startPay(s.id).expect(200)).body).toMatchObject({ plan: 'BALANCE', amount: BALANCE });
  });
});
