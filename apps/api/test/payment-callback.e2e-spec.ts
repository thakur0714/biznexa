/**
 * Payment page (M3.18): `GET /api/applications/:id/payment` reports where the payment stands and turns PAID
 * only after the signed webhook; Checkout's callback (`POST …/payment/callback`) only moves a correctly
 * signed payment to PENDING ("confirming") and can never pay the order. Closing the browser before the
 * callback still ends with the application SUBMITTED via the webhook.
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
const users = { email: { startsWith: `e2e-paycb-${run}` } };
const slugs = [`e2e-paycb-${run}`, `e2e-paycb-docs-${run}`];
const codes: string[] = [];
const eventIds: string[] = [];

// ₹1,000 fee + ₹4,500 government fee, 18 % GST, intra-state.
const FEE = 100000;
const GOVT = 450000;
const TOTAL = FEE + 18000 + GOVT;

async function register(n: number) {
  const res = await http
    .post('/api/auth/register')
    .send({ name: `Callback Test ${n}`, mobile: `9${run}${String(n).padStart(2, '0')}`, email: `e2e-paycb-${run}-${n}@example.com`, password: 'secret123', consent: true })
    .expect(201);
  return { token: res.body.accessToken as string, id: res.body.user.id as string };
}

async function coupon() {
  const code = `E2EPAYCB${run}${codes.length}`;
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
        shortDescription: 'A service used to test the payment page.',
        sacCode: '998399',
        packages: { create: [{ name: 'Basic', professionalFee: FEE, governmentFee: GOVT, gstRate: 18 }] },
        formSchemas: form,
        ...(documents ? { documents: { create: [{ name: 'PAN card', isMandatory: true }, { name: 'Photo', isMandatory: false }] } } : {}),
      },
      select: { packages: { select: { id: true } } },
    });
  packageId = (await service(slugs[0], 'Payment callback (test)')).packages[0].id;
  docsPackageId = (await service(slugs[1], 'Payment callback with documents (test)', true)).packages[0].id;
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

const statusOf = async (id: string, token = alice) => (await http.get(`${base}/${id}/payment`).set(as(token)).expect(200)).body;
const callback = (id: string, body: object, token = alice) => http.post(`${base}/${id}/payment/callback`).set(as(token)).send(body);
/** What Checkout's handler receives for a successful payment, in the callback's shape. */
function checkoutResult(s: Awaited<ReturnType<typeof started>>) {
  const r = gateway.pay(s.gatewayOrderId);
  return { body: { paymentId: s.paymentId, gatewayOrderId: r.orderId, gatewayPaymentId: r.paymentId, signature: r.signature }, payment: r.payment };
}

describe('payment status and checkout callback (M3.18)', () => {
  it('closing the browser before the callback: the webhook alone submits the application', async () => {
    const s = await started();
    expect(await statusOf(s.id)).toMatchObject({ outcome: 'AWAITING', applicationStatus: 'PAYMENT_PENDING', orderStatus: 'PAYMENT_PENDING', total: TOTAL, amountPaid: 0, payment: { id: s.paymentId, status: 'CREATED', paidAt: null } });

    // The customer pays and closes the tab: Checkout's handler never runs, no callback reaches us.
    const { payment } = checkoutResult(s);
    await send(captured(payment)).expect(200);

    const after = await statusOf(s.id);
    expect(after).toMatchObject({ outcome: 'PAID', applicationStatus: 'SUBMITTED', orderStatus: 'PAID', amountPaid: TOTAL, payment: { id: s.paymentId, status: 'SUCCESS', method: 'upi', failureReason: null } });
    expect(new Date(after.payment.paidAt).getTime()).not.toBeNaN();
    expect((await state(s.id, s.orderId)).history.map((h) => h.status)).toEqual(['SUBMITTED']);
  });

  it('a signed callback only shows "confirming": nothing is paid until the webhook', async () => {
    const s = await started();
    const r = checkoutResult(s);

    const res = (await callback(s.id, r.body).expect(200)).body;
    expect(res).toMatchObject({ outcome: 'CONFIRMING', applicationStatus: 'PAYMENT_PENDING', orderStatus: 'PAYMENT_PENDING', amountPaid: 0, payment: { status: 'PENDING', paidAt: null } });
    const before = await state(s.id, s.orderId);
    expect(before).toMatchObject({ application: 'PAYMENT_PENDING', submittedAt: null, order: 'PAYMENT_PENDING', history: [] });
    expect(before.payments).toEqual([expect.objectContaining({ status: 'PENDING', gatewayPaymentId: null, paidAt: null })]);
    expect(events).toEqual([]);

    // Called again (double handler, reload): still only PENDING.
    await callback(s.id, r.body).expect(200);
    expect(await state(s.id, s.orderId)).toEqual(before);

    await send(captured(r.payment)).expect(200);
    expect(await statusOf(s.id)).toMatchObject({ outcome: 'PAID', applicationStatus: 'SUBMITTED', payment: { status: 'SUCCESS' } });
  });

  it('a callback after the webhook changes nothing', async () => {
    const s = await started();
    const r = checkoutResult(s);
    await send(captured(r.payment)).expect(200);
    const paid = await state(s.id, s.orderId);

    expect((await callback(s.id, r.body).expect(200)).body).toMatchObject({ outcome: 'PAID', payment: { status: 'SUCCESS' } });
    expect(await state(s.id, s.orderId)).toEqual(paid);
  });

  it('refuses a bad signature, ids of another payment, or extra fields with 400 and changes nothing', async () => {
    const s = await started();
    const other = await started();
    const r = checkoutResult(s);
    const before = await state(s.id, s.orderId);

    await callback(s.id, { ...r.body, signature: 'f'.repeat(64) }).expect(400);
    // A real signature for another gateway payment id.
    const o = checkoutResult(other);
    await callback(s.id, { ...r.body, gatewayPaymentId: o.body.gatewayPaymentId }).expect(400);
    // Another of the customer's own payments, sent to this application.
    await callback(s.id, o.body).expect(400);
    await callback(s.id, { ...r.body, gatewayOrderId: o.body.gatewayOrderId, signature: o.body.signature }).expect(400);
    // The client can't claim a status or an amount.
    await callback(s.id, { ...r.body, status: 'SUCCESS' }).expect(400);
    await callback(s.id, { ...r.body, amount: 100 }).expect(400);
    await callback(s.id, {}).expect(400);

    expect(await state(s.id, s.orderId)).toEqual(before);
    expect((await state(other.id, other.orderId)).payments[0].status).toBe('CREATED');
  });

  it('another customer gets the same 404 as a missing application, and nothing changes', async () => {
    const s = await started();
    const r = checkoutResult(s);
    const { token: bob } = await register(2);

    await http.get(`${base}/${s.id}/payment`).set(as(bob)).expect(404);
    await callback(s.id, r.body, bob).expect(404);
    await http.get(`${base}/${randomUUID()}/payment`).set(as(alice)).expect(404);
    await callback(randomUUID(), r.body).expect(404);
    await http.get(`${base}/${s.id}/payment`).expect(401);
    expect((await state(s.id, s.orderId)).payments[0].status).toBe('CREATED');
  });

  it('a draft is UNPAID; a failed attempt is FAILED with its reason, and trying again pays', async () => {
    const draft = await http.post(base).set(as(alice)).send({ packageId }).expect(201);
    expect(await statusOf(draft.body.id)).toMatchObject({ outcome: 'UNPAID', applicationStatus: 'DRAFT', orderStatus: 'CREATED', payment: null });

    const s = await started();
    await send(gateway.webhook('payment.failed', gateway.fail(s.gatewayOrderId, 'Card declined by the bank'))).expect(200);
    expect(await statusOf(s.id)).toMatchObject({ outcome: 'FAILED', applicationStatus: 'PAYMENT_PENDING', payment: { id: s.paymentId, status: 'FAILED', failureReason: 'Card declined by the bank' } });

    // "Try again" on the failure page: the same endpoint as "Pay" opens a new payment.
    const retry = (await http.post(`${base}/${s.id}/payment`).set(as(alice)).expect(200)).body;
    expect(retry.paymentId).not.toBe(s.paymentId);
    expect(retry.amount).toBe(s.amount);
    expect(await statusOf(s.id)).toMatchObject({ outcome: 'AWAITING', payment: { id: retry.paymentId, status: 'CREATED' } });

    const r = checkoutResult({ ...s, paymentId: retry.paymentId, gatewayOrderId: retry.gatewayOrderId });
    expect((await callback(s.id, r.body).expect(200)).body).toMatchObject({ outcome: 'CONFIRMING' });
    await send(captured(r.payment)).expect(200);
    expect(await statusOf(s.id)).toMatchObject({ outcome: 'PAID', applicationStatus: 'SUBMITTED', amountPaid: s.amount, payment: { id: retry.paymentId, status: 'SUCCESS' } });
  });

  it('missing mandatory documents: paid, and the page sees DOCUMENTS_PENDING', async () => {
    const s = await started(docsPackageId);
    await send(captured(checkoutResult(s).payment)).expect(200);
    expect(await statusOf(s.id)).toMatchObject({ outcome: 'PAID', applicationStatus: 'DOCUMENTS_PENDING' });
  });
});
