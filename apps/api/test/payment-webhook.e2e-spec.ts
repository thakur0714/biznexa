/**
 * Payment webhook (M3.17): only a correctly signed event changes anything; `payment.captured` marks the
 * payment SUCCESS, the order PAID and the application SUBMITTED (DOCUMENTS_PENDING when mandatory documents
 * are missing), records the coupon redemption, history, audit and events in one transaction; replays and
 * concurrent deliveries change state once; `payment.failed` marks the payment FAILED.
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
let docsPackageId: string;
let sellerSetting: { value: unknown } | null;

const run = Date.now().toString().slice(-7);
const base = '/api/applications';
const hook = '/api/payments/webhook';
const as = (token: string) => ({ authorization: `Bearer ${token}` });
const users = { email: { startsWith: `e2e-hook-${run}` } };
const slugs = [`e2e-hook-${run}`, `e2e-hook-docs-${run}`];
const codes: string[] = [];
const eventIds: string[] = [];

// ₹1,000 fee + ₹4,500 government fee, 18 % GST, intra-state.
const FEE = 100000;
const GOVT = 450000;
const TOTAL = FEE + 18000 + GOVT;

async function register(n: number) {
  const res = await http
    .post('/api/auth/register')
    .send({ name: `Hook Test ${n}`, mobile: `6${run}${String(n).padStart(2, '0')}`, email: `e2e-hook-${run}-${n}@example.com`, password: 'secret123', consent: true })
    .expect(201);
  return { token: res.body.accessToken as string, id: res.body.user.id as string };
}

async function coupon() {
  const code = `E2EHOOK${run}${codes.length}`;
  codes.push(code);
  await prisma.coupon.create({ data: { code, type: 'PERCENTAGE', value: 10, perUserLimit: null } });
  return code;
}

/** A completed draft with payment started: the order and application are PAYMENT_PENDING. */
async function started(pkg = packageId, couponCode?: string) {
  const businessEntityId = (
    await prisma.businessEntity.create({ data: { ownerId: aliceId, legalName: `Biz ${randomUUID().slice(0, 6)}`, entityType: 'PRIVATE_LIMITED', state: 'Punjab' }, select: { id: true } })
  ).id;
  const draft = await http.post(base).set(as(alice)).send({ packageId: pkg, businessEntityId }).expect(201);
  const id = draft.body.id as string;
  await http.patch(`${base}/${id}`).set(as(alice)).send({ formData: { note: 'Ready' }, final: true }).expect(200);
  if (couponCode) await http.put(`${base}/${id}/coupon`).set(as(alice)).send({ code: couponCode }).expect(200);
  const pay = (await http.post(`${base}/${id}/payment`).set(as(alice)).expect(200)).body;
  events = [];
  return { id, orderId: draft.body.order.id as string, paymentId: pay.paymentId as string, gatewayOrderId: pay.gatewayOrderId as string, amount: pay.amount as number };
}

/** Sends a webhook exactly as built (body bytes + headers). */
function send(w: { body: string; headers: Record<string, string> }) {
  eventIds.push(w.headers['x-razorpay-event-id']);
  return http.post(hook).set(w.headers).send(w.body);
}
const eventsFor = (s: { id: string; paymentId: string }) =>
  events.filter((event) => event.payload.paymentId === s.paymentId || event.payload.applicationId === s.id);
const captured = (payment: GatewayPayment, eventId?: string) => gateway.webhook('payment.captured', payment, eventId);

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
  const service = (slug: string, name: string, documents = false) =>
    prisma.service.create({
      data: {
        slug,
        categoryId: cat.id,
        name,
        shortDescription: 'A service used to test payment webhooks.',
        sacCode: '998399',
        packages: { create: [{ name: 'Basic', professionalFee: FEE, governmentFee: GOVT, gstRate: 18 }] },
        formSchemas: form,
        ...(documents ? { documents: { create: [{ name: 'PAN card', isMandatory: true }, { name: 'Photo', isMandatory: false }] } } : {}),
      },
      select: { packages: { select: { id: true } } },
    });
  packageId = (await service(slugs[0], 'Webhook (test)')).packages[0].id;
  docsPackageId = (await service(slugs[1], 'Webhook with documents (test)', true)).packages[0].id;
});

beforeEach(() => {
  events = [];
});

afterAll(async () => {
  if (sellerSetting) await prisma.setting.upsert({ where: { key: SELLER_STATE_KEY }, update: { value: sellerSetting.value as object }, create: { key: SELLER_STATE_KEY, value: sellerSetting.value as object } });
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

describe('payment webhook (M3.17)', () => {
  it('refuses a missing or wrong signature with 400 and changes nothing', async () => {
    const s = await started();
    const w = captured(gateway.pay(s.gatewayOrderId).payment);
    const before = await state(s.id, s.orderId);

    await http.post(hook).set({ 'content-type': 'application/json' }).send(w.body).expect(400);
    await http.post(hook).set({ ...w.headers, 'x-razorpay-signature': gateway.signWebhook('other') }).send(w.body).expect(400);
    // Signed bytes, then altered: the signature no longer matches.
    await http.post(hook).set(w.headers).send(w.body.replace(`"amount":${s.amount}`, '"amount":100')).expect(400);
    // Same JSON, re-serialised: different bytes, so it fails too.
    await http.post(hook).set(w.headers).send(JSON.stringify(JSON.parse(w.body), null, 2)).expect(400);

    expect(await state(s.id, s.orderId)).toEqual(before);
    expect(await prisma.paymentWebhookEvent.count({ where: { eventId: w.headers['x-razorpay-event-id'] } })).toBe(0);
    expect(events).toEqual([]);
  });

  it('payment.captured: payment SUCCESS, order PAID, application SUBMITTED, coupon redeemed, history, audit and events', async () => {
    const code = await coupon();
    const s = await started(packageId, code);
    const discounted = 90000 + 16200 + GOVT;
    expect(s.amount).toBe(discounted);
    const paid = gateway.pay(s.gatewayOrderId, 'upi').payment;
    const w = captured(paid);

    expect((await send(w).expect(200)).body).toEqual({ received: true });

    const after = await state(s.id, s.orderId);
    expect(after).toMatchObject({
      application: 'SUBMITTED',
      submittedAt: expect.any(Date),
      order: 'PAID',
      amountPaid: discounted,
      usedCount: 1,
      payments: [{ id: s.paymentId, status: 'SUCCESS', gatewayPaymentId: paid.id, method: 'upi', failureReason: null, paidAt: expect.any(Date) }],
      history: [{ status: 'SUBMITTED', note: 'Payment received', changedById: null }],
      redemptions: [{ userId: aliceId, amount: 10000 }],
      hooks: [{ event: 'payment.captured', outcome: 'applied' }],
    });
    const stored = await prisma.payment.findUniqueOrThrow({ where: { id: s.paymentId }, select: { rawWebhook: true } });
    expect(stored.rawWebhook).toEqual(JSON.parse(w.body));
    const hookRow = await prisma.paymentWebhookEvent.findFirstOrThrow({ where: { eventId: w.headers['x-razorpay-event-id'] }, select: { payload: true, gateway: true, gatewayPaymentId: true } });
    expect(hookRow).toEqual({ payload: JSON.parse(w.body), gateway: 'MOCK', gatewayPaymentId: paid.id });

    const audit = await prisma.auditLog.findMany({ where: { entityId: s.id, action: 'application.payment_received' }, select: { actorId: true, before: true, after: true } });
    expect(audit).toEqual([
      {
        actorId: null,
        before: { status: 'PAYMENT_PENDING', orderStatus: 'PAYMENT_PENDING' },
        after: { status: 'SUBMITTED', orderStatus: 'PAID', paymentId: s.paymentId, amount: discounted, gatewayPaymentId: paid.id },
      },
    ]);
    expect(eventsFor(s).map((e) => [e.name, e.payload])).toEqual([
      ['application.status_changed', { applicationId: s.id, from: 'PAYMENT_PENDING', to: 'SUBMITTED', actorId: null }],
      ['payment.succeeded', { paymentId: s.paymentId, orderId: s.orderId, customerId: aliceId, applicationIds: [s.id], amount: discounted, gateway: 'MOCK', gatewayPaymentId: paid.id }],
      // Issued by the invoice listener (M3.21).
      ['invoice.issued', expect.objectContaining({ paymentId: s.paymentId, orderId: s.orderId, total: discounted })],
    ]);

    // Paid: starting a payment again is refused.
    await http.post(`${base}/${s.id}/payment`).set(as(alice)).expect(409);
  });

  it('replaying the same webhook 3× (one after another, then all at once) changes state once', async () => {
    const code = await coupon();
    const s = await started(packageId, code);
    const w = captured(gateway.pay(s.gatewayOrderId).payment);

    for (let i = 0; i < 3; i++) await send(w).expect(200);
    const once = await state(s.id, s.orderId);
    expect(once).toMatchObject({ application: 'SUBMITTED', order: 'PAID', amountPaid: s.amount, usedCount: 1, hooks: [{ event: 'payment.captured', outcome: 'applied' }] });
    expect(once.history).toHaveLength(1);
    expect(once.redemptions).toHaveLength(1);
    expect(eventsFor(s).filter((e) => e.name === 'payment.succeeded')).toHaveLength(1);
    expect(eventsFor(s).filter((e) => e.name === 'application.status_changed')).toHaveLength(1);

    await Promise.all([send(w), send(w), send(w)].map((r) => r.expect(200)));
    expect(await state(s.id, s.orderId)).toEqual(once);
    expect(eventsFor(s).filter((e) => e.name === 'payment.succeeded')).toHaveLength(1);
  });

  it('three concurrent first deliveries, and the same payment under a new event id, still apply once', async () => {
    const code = await coupon();
    const s = await started(packageId, code);
    const paid = gateway.pay(s.gatewayOrderId).payment;
    const w = captured(paid);

    await Promise.all([send(w), send(w), send(w)].map((r) => r.expect(200)));
    await send(captured(paid)).expect(200);

    const after = await state(s.id, s.orderId);
    expect(after).toMatchObject({ application: 'SUBMITTED', order: 'PAID', amountPaid: s.amount, usedCount: 1 });
    expect(after.history).toHaveLength(1);
    expect(after.redemptions).toHaveLength(1);
    expect(after.hooks.map((h) => h.outcome)).toEqual(['applied', 'duplicate']);
    expect(eventsFor(s).filter((e) => e.name === 'payment.succeeded')).toHaveLength(1);
  });

  it('goes on to DOCUMENTS_PENDING when a mandatory document is missing', async () => {
    const s = await started(docsPackageId);
    await send(captured(gateway.pay(s.gatewayOrderId).payment)).expect(200);

    const after = await state(s.id, s.orderId);
    expect(after).toMatchObject({
      application: 'DOCUMENTS_PENDING',
      order: 'PAID',
      history: [
        { status: 'SUBMITTED', note: 'Payment received', changedById: null },
        { status: 'DOCUMENTS_PENDING', note: 'Waiting for 1 required document', changedById: null },
      ],
    });
    expect(eventsFor(s).filter((e) => e.name === 'application.status_changed').map((e) => e.payload)).toEqual([
      { applicationId: s.id, from: 'PAYMENT_PENDING', to: 'SUBMITTED', actorId: null },
      { applicationId: s.id, from: 'SUBMITTED', to: 'DOCUMENTS_PENDING', actorId: null },
    ]);
  });

  it('payment.failed: payment FAILED with the reason, order stays payable; a later capture of that order still pays it', async () => {
    const s = await started();
    const failure = gateway.fail(s.gatewayOrderId, 'Card declined by the bank');
    const w = gateway.webhook('payment.failed', failure);
    await send(w).expect(200);
    await send(w).expect(200);

    let after = await state(s.id, s.orderId);
    expect(after).toMatchObject({
      application: 'PAYMENT_PENDING',
      order: 'PAYMENT_PENDING',
      payments: [{ id: s.paymentId, status: 'FAILED', gatewayPaymentId: failure.id, method: 'card', failureReason: 'Card declined by the bank', paidAt: null }],
      history: [],
      hooks: [{ event: 'payment.failed', outcome: 'applied' }],
    });
    expect(eventsFor(s).map((e) => [e.name, e.payload])).toEqual([
      ['payment.failed', { paymentId: s.paymentId, orderId: s.orderId, customerId: aliceId, amount: s.amount, reason: 'Card declined by the bank' }],
    ]);

    // The customer retries in the same checkout window: same gateway order, a new gateway payment.
    const paid = gateway.pay(s.gatewayOrderId).payment;
    await send(captured(paid)).expect(200);
    // The failed attempt's event arriving late changes nothing.
    await send(gateway.webhook('payment.failed', failure)).expect(200);

    after = await state(s.id, s.orderId);
    expect(after).toMatchObject({ application: 'SUBMITTED', order: 'PAID', payments: [{ status: 'SUCCESS', gatewayPaymentId: paid.id, failureReason: null }] });
    expect(after.hooks.map((h) => h.outcome)).toEqual(['applied', 'applied', 'stale']);
  });

  it('a capture for an order another payment already paid is recorded for a refund, the order is left alone', async () => {
    const s = await started();
    await send(gateway.webhook('payment.failed', gateway.fail(s.gatewayOrderId))).expect(200);
    // Paying again makes a new payment + gateway order (M3.16), which succeeds…
    const retry = (await http.post(`${base}/${s.id}/payment`).set(as(alice)).expect(200)).body;
    expect(retry.paymentId).not.toBe(s.paymentId);
    await send(captured(gateway.pay(retry.gatewayOrderId).payment)).expect(200);
    events = [];
    // …and then the first window is paid too.
    const late = gateway.pay(s.gatewayOrderId).payment;
    await send(captured(late)).expect(200);

    const after = await state(s.id, s.orderId);
    expect(after).toMatchObject({ application: 'SUBMITTED', order: 'PAID', amountPaid: s.amount });
    expect(after.payments.map((p) => [p.id, p.status])).toEqual([
      [s.paymentId, 'SUCCESS'],
      [retry.paymentId, 'SUCCESS'],
    ]);
    expect(after.history).toHaveLength(1);
    expect(after.hooks.at(-1)).toEqual({ event: 'payment.captured', outcome: 'order_not_pending' });
    expect(events).toEqual([]);
  });

  it('an amount or currency that differs from ours is not marked paid', async () => {
    const s = await started();
    const paid = gateway.pay(s.gatewayOrderId).payment;
    await send(captured({ ...paid, amount: s.amount - 100 })).expect(200);
    await send(captured({ ...paid, currency: 'USD' })).expect(200);

    const after = await state(s.id, s.orderId);
    expect(after).toMatchObject({ application: 'PAYMENT_PENDING', order: 'PAYMENT_PENDING', payments: [{ status: 'CREATED', gatewayPaymentId: null }] });
    expect(after.hooks.map((h) => h.outcome)).toEqual(['amount_mismatch', 'amount_mismatch']);
    expect(events).toEqual([]);
  });

  it('stores and acknowledges events it does not act on', async () => {
    const stranger: GatewayPayment = { id: `pay_x${run}`, orderId: `order_x${run}`, amount: 10000, amountRefunded: 0, currency: 'INR', status: 'captured', method: 'upi', failureReason: null, createdAt: new Date() };
    const unknown = captured(stranger);
    const other = gateway.webhook('payment.authorized', { ...stranger, status: 'authorized' });
    await send(unknown).expect(200);
    await send(other).expect(200);

    const rows = await prisma.paymentWebhookEvent.findMany({
      where: { eventId: { in: [unknown.headers['x-razorpay-event-id'], other.headers['x-razorpay-event-id']] } },
      orderBy: { receivedAt: 'asc' },
      select: { event: true, outcome: true, paymentId: true },
    });
    expect(rows).toEqual([
      { event: 'payment.captured', outcome: 'unknown_order', paymentId: null },
      { event: 'payment.authorized', outcome: 'ignored', paymentId: null },
    ]);
    expect(events).toEqual([]);
  });
});
