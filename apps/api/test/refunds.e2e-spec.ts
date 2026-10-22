/**
 * Refunds (M4.13): an admin refunds a paid payment fully or partly → Refund INITIATED, payment REFUND_INITIATED,
 * gateway refund; the `refund.processed` webhook makes it PROCESSED, the payment REFUNDED / PARTIALLY_REFUNDED
 * and issues a credit note (fee + GST reversed before government fees); `refund.failed` puts the payment back. Over-refunds,
 * parallel requests, retried requests (Idempotency-Key) and redelivered webhooks never refund twice. Only staff
 * with `payments.refund` may refund; the customer and staff with `payments.view` can download the credit note.
 */
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { CREDIT_NOTE_NUMBER_PATTERN, type AnyDomainEvent, type InvoiceLine } from '@biznexa/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { EventBus } from '../src/events/event-bus';
import { StorageService } from '../src/files/storage.service';
import { PaymentGateway, PaymentGatewayError, type GatewayRefund } from '../src/payments/payment-gateway';
import { MockPaymentGateway } from '../src/payments/mock-payment-gateway';
import { staffSession } from './staff';

let app: NestExpressApplication;
let http: ReturnType<typeof request>;
let prisma: PrismaService;
let gateway: MockPaymentGateway;
let events: AnyDomainEvent[] = [];
let alice: string;
let aliceId: string;
let bob: string;
let admin: string;
let support: string;
let operations: string;
let packageId: string;

const run = Date.now().toString().slice(-7);
const hook = '/api/payments/webhook';
const as = (token: string) => ({ authorization: `Bearer ${token}` });
const users = { email: { startsWith: `e2e-refund-${run}` } };
const slug = `e2e-refund-${run}`;
const eventIds: string[] = [];

// ₹1,000 fee + 18 % GST (₹180: CGST + SGST or IGST, depending on the seller state other suites set) + ₹4,500
// government fee = ₹5,680. This suite never changes Settings, so it can run beside the suites that do.
const FEE = 100000;
const GOVT = 450000;
const TOTAL = FEE + 18000 + GOVT;

async function register(n: number) {
  const res = await http
    .post('/api/auth/register')
    .send({ name: `Refund Test ${n}`, mobile: `8${run}${String(40 + n)}`, email: `e2e-refund-${run}-${n}@example.com`, password: 'secret123', consent: true })
    .expect(201);
  return { token: res.body.accessToken as string, id: res.body.user.id as string };
}

/** A paid order: payment SUCCESS (webhook applied) and its invoice issued. */
async function paid() {
  const businessEntityId = (
    await prisma.businessEntity.create({ data: { ownerId: aliceId, legalName: `Biz ${randomUUID().slice(0, 6)}`, entityType: 'PRIVATE_LIMITED', state: 'Punjab' }, select: { id: true } })
  ).id;
  const draft = await http.post('/api/applications').set(as(alice)).send({ packageId, businessEntityId }).expect(201);
  const id = draft.body.id as string;
  await http.patch(`/api/applications/${id}`).set(as(alice)).send({ formData: { note: 'Ready' }, final: true }).expect(200);
  const pay = (await http.post(`/api/applications/${id}/payment`).set(as(alice)).expect(200)).body;
  const gp = gateway.pay(pay.gatewayOrderId).payment;
  await send(gateway.webhook('payment.captured', gp)).expect(200);
  const payment = await prisma.payment.findUniqueOrThrow({ where: { id: pay.paymentId }, select: { id: true, status: true, invoice: { select: { id: true, number: true } } } });
  expect(payment.status).toBe('SUCCESS');
  expect(payment.invoice).not.toBeNull();
  events = [];
  return { paymentId: payment.id as string, invoiceId: payment.invoice!.id, gatewayPaymentId: gp.id };
}

function send(w: { body: string; headers: Record<string, string> }) {
  eventIds.push(w.headers['x-razorpay-event-id']);
  return http.post(hook).set(w.headers).send(w.body);
}

function refund(paymentId: string, body: { amount?: number; reason?: string }, key: string | null = randomUUID(), token = admin) {
  const req = http.post(`/api/admin/payments/${paymentId}/refunds`).set(as(token));
  if (key) req.set('idempotency-key', key);
  return req.send(body);
}

/** The mock gateway's refund for one of ours. */
function gatewayRefund(refundId: string): GatewayRefund {
  const r = [...gateway.refunds.values()].find((g) => g.receipt === refundId);
  if (!r) throw new Error(`No gateway refund for ${refundId}`);
  return r;
}

const paymentOf = (id: string) =>
  prisma.payment.findUniqueOrThrow({
    where: { id },
    select: { status: true, refunds: { orderBy: { createdAt: 'asc' }, select: { id: true, status: true, amount: true, gatewayRefundId: true, failureReason: true, creditNoteNo: true } } },
  });

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true }));
  await app.init();
  http = request(app.getHttpServer()) as unknown as ReturnType<typeof request>;
  prisma = app.get(PrismaService);
  gateway = app.get(PaymentGateway) as MockPaymentGateway;
  app.get(EventBus).onAny((e) => void (e.name !== 'pdf.generated' && events.push(e)));
  ({ token: alice, id: aliceId } = await register(1));
  ({ token: bob } = await register(2));
  admin = (await staffSession(http, prisma, 'ADMIN', `e2e-refund-${run}-admin@example.com`)).accessToken;
  support = (await staffSession(http, prisma, 'SUPPORT', `e2e-refund-${run}-support@example.com`)).accessToken;
  operations = (await staffSession(http, prisma, 'OPERATIONS', `e2e-refund-${run}-ops@example.com`)).accessToken;

  const cat = await prisma.category.findUniqueOrThrow({ where: { slug: 'licenses' } });
  const service = await prisma.service.create({
    data: {
      slug,
      categoryId: cat.id,
      name: 'Refund (test)',
      shortDescription: 'A service used to test refunds.',
      sacCode: '998399',
      packages: { create: [{ name: 'Basic', professionalFee: FEE, governmentFee: GOVT, gstRate: 18 }] },
      formSchemas: { create: [{ version: 1, schema: { steps: [{ title: 'About', fields: [{ type: 'text', name: 'note', label: 'Note', required: true }] }] }, isCurrent: true }] },
    },
    select: { packages: { select: { id: true } } },
  });
  packageId = service.packages[0].id;
});

beforeEach(() => {
  events = [];
});

afterAll(async () => {
  const orders = { customer: users };
  const payments = await prisma.payment.findMany({ where: { order: orders }, select: { id: true } });
  const apps = await prisma.application.findMany({ where: { order: orders }, select: { id: true } });
  await prisma.auditLog.deleteMany({
    where: { OR: [{ actor: users }, { entityType: 'Payment', entityId: { in: payments.map((p) => p.id) } }, { entityType: 'Application', entityId: { in: apps.map((a) => a.id) } }] },
  });
  const storage = app.get(StorageService);
  for (const { pdfKey } of await prisma.creditNote.findMany({ where: { customer: users }, select: { pdfKey: true } })) if (pdfKey) await storage.remove(pdfKey); // NOSONAR: test steps run in order
  for (const { pdfKey } of await prisma.invoice.findMany({ where: { order: orders }, select: { pdfKey: true } })) if (pdfKey) await storage.remove(pdfKey); // NOSONAR: test steps run in order
  await prisma.creditNote.deleteMany({ where: { customer: users } });
  await prisma.refund.deleteMany({ where: { payment: { order: orders } } });
  await prisma.paymentWebhookEvent.deleteMany({ where: { OR: [{ payment: { order: orders } }, { eventId: { in: eventIds } }] } });
  await prisma.invoice.deleteMany({ where: { order: orders } });
  await prisma.payment.deleteMany({ where: { order: orders } });
  await prisma.application.deleteMany({ where: { order: orders } });
  await prisma.order.deleteMany({ where: orders });
  await prisma.businessEntity.deleteMany({ where: { owner: users } });
  await prisma.service.deleteMany({ where: { slug } });
  await prisma.user.deleteMany({ where: users });
  await app.close();
});

describe('refunds (M4.13)', () => {
  it('full refund: INITIATED → gateway → processed webhook → REFUNDED with a credit note reversing the invoice', async () => {
    const p = await paid();
    const res = await refund(p.paymentId, { amount: TOTAL, reason: 'Service cancelled by customer' }).expect(201);
    expect(res.body).toMatchObject({ amount: TOTAL, reason: 'Service cancelled by customer', status: 'INITIATED', processedAt: null, creditNote: null });
    expect(res.body.gatewayRefundId).toMatch(/^rfnd_/);
    expect((await paymentOf(p.paymentId)).status).toBe('REFUND_INITIATED');
    expect(events.map((e) => e.name)).toEqual(['refund.initiated']);
    const g = gatewayRefund(res.body.id);
    expect(g).toMatchObject({ paymentId: p.gatewayPaymentId, amount: TOTAL, notes: { refund_id: res.body.id } });

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'payment.refund_initiated', entityId: p.paymentId } });
    expect(audit.before).toEqual({ status: 'SUCCESS', refundable: TOTAL });
    expect(audit.after).toMatchObject({ status: 'REFUND_INITIATED', refundable: 0, refundId: res.body.id, amount: TOTAL });

    events = [];
    await send(gateway.refundWebhook('refund.processed', g)).expect(200);
    const after = await paymentOf(p.paymentId);
    expect(after.status).toBe('REFUNDED');
    expect(after.refunds[0]).toMatchObject({ status: 'PROCESSED', gatewayRefundId: g.id, creditNoteNo: expect.stringMatching(CREDIT_NOTE_NUMBER_PATTERN) });
    expect(events.map((e) => e.name)).toEqual(expect.arrayContaining(['refund.processed', 'credit_note.issued']));
    expect(events.find((e) => e.name === 'refund.processed')?.payload).toMatchObject({ refundId: res.body.id, paymentId: p.paymentId, customerId: aliceId, amount: TOTAL, paymentStatus: 'REFUNDED' });

    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: p.invoiceId } });
    const note = await prisma.creditNote.findUniqueOrThrow({ where: { refundId: res.body.id } });
    expect(note).toMatchObject({
      invoiceId: p.invoiceId,
      customerId: aliceId,
      taxType: invoice.taxType,
      taxableValue: invoice.taxableValue,
      cgst: invoice.cgst,
      sgst: invoice.sgst,
      igst: invoice.igst,
      govtFees: invoice.govtFees,
      total: TOTAL,
      reason: 'Service cancelled by customer',
      amountInWords: 'Rupees Five Thousand Six Hundred Eighty Only',
    });
    expect(note.lines).toEqual(invoice.lines);
    expect(note.seller).toEqual(invoice.seller);
    expect(note.buyer).toEqual(invoice.buyer);
    expect(await prisma.auditLog.count({ where: { action: 'payment.refund_processed', entityId: p.paymentId } })).toBe(1);

    // Nothing left to refund.
    await refund(p.paymentId, { amount: 100, reason: 'Once more' }).expect(409);
  });

  it('partial refunds: PARTIALLY_REFUNDED, then the rest; credit notes take the fee + GST before the government fee and add up to the invoice', async () => {
    const p = await paid();
    const first = (await refund(p.paymentId, { amount: TOTAL / 2, reason: 'Half the work was not done' }).expect(201)).body;
    await send(gateway.refundWebhook('refund.processed', gatewayRefund(first.id))).expect(200);
    expect((await paymentOf(p.paymentId)).status).toBe('PARTIALLY_REFUNDED');
    const half = await prisma.creditNote.findUniqueOrThrow({ where: { refundId: first.id } });
    expect(half).toMatchObject({ taxableValue: FEE, govtFees: TOTAL / 2 - FEE - 18000, total: TOTAL / 2 });
    // All of the GST, split the way the invoice was.
    const invoiceTax = await prisma.invoice.findUniqueOrThrow({ where: { id: p.invoiceId }, select: { taxType: true } });
    expect(half.taxType).toBe(invoiceTax.taxType);
    expect({ cgst: half.cgst, sgst: half.sgst, igst: half.igst }).toEqual(
      half.taxType === 'IGST' ? { cgst: 0, sgst: 0, igst: 18000 } : { cgst: 9000, sgst: 9000, igst: 0 },
    );

    // Over-refund: more than what is left → 400, nothing recorded.
    const over = await refund(p.paymentId, { amount: TOTAL / 2 + 1, reason: 'Too much' }).expect(400);
    expect(over.body.message).toContain('₹2,840');
    expect((await paymentOf(p.paymentId)).refunds).toHaveLength(1);

    const rest = (await refund(p.paymentId, { amount: TOTAL / 2 - 345, reason: 'The rest, less a fee' }).expect(201)).body;
    await send(gateway.refundWebhook('refund.processed', gatewayRefund(rest.id))).expect(200);
    const last = (await refund(p.paymentId, { amount: 345, reason: 'And the fee' }).expect(201)).body;
    await send(gateway.refundWebhook('refund.processed', gatewayRefund(last.id))).expect(200);
    expect((await paymentOf(p.paymentId)).status).toBe('REFUNDED');

    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: p.invoiceId } });
    const notes = await prisma.creditNote.findMany({ where: { invoiceId: p.invoiceId } });
    expect(notes).toHaveLength(3);
    const sum = (k: 'taxableValue' | 'cgst' | 'sgst' | 'igst' | 'govtFees' | 'total') => notes.reduce((a, n) => a + n[k], 0);
    expect({ taxableValue: sum('taxableValue'), cgst: sum('cgst'), sgst: sum('sgst'), igst: sum('igst'), govtFees: sum('govtFees'), total: sum('total') }).toEqual({
      taxableValue: invoice.taxableValue,
      cgst: invoice.cgst,
      sgst: invoice.sgst,
      igst: invoice.igst,
      govtFees: invoice.govtFees,
      total: invoice.total,
    });
    for (const n of notes) for (const l of n.lines as unknown as InvoiceLine[]) if (l.kind === 'SERVICE') expect(Math.abs(l.cgst - l.sgst)).toBeLessThanOrEqual(1);
    expect(new Set(notes.map((n) => n.number)).size).toBe(3);
  });

  it('refuses bad input and refunds of payments that are not paid', async () => {
    const p = await paid();
    await refund(p.paymentId, { amount: 0, reason: 'Zero' }).expect(400);
    await refund(p.paymentId, { amount: 99, reason: 'Under a rupee' }).expect(400);
    await refund(p.paymentId, { amount: 1000.5, reason: 'Fraction' }).expect(400);
    await refund(p.paymentId, { amount: 1000 }).expect(400);
    await refund(p.paymentId, { amount: TOTAL + 1, reason: 'More than paid' }).expect(400);
    const noKey = await refund(p.paymentId, { amount: 1000, reason: 'No key' }, null).expect(400);
    expect(noKey.body.message).toContain('Idempotency-Key');
    await refund(randomUUID(), { amount: 1000, reason: 'No such payment' }).expect(404);

    // A payment that never succeeded.
    const failedPayment = await prisma.payment.create({ data: { amount: 5000, status: 'FAILED', gateway: 'MOCK', gatewayPaymentId: `pay_x${run}` }, select: { id: true } });
    await refund(failedPayment.id, { amount: 1000, reason: 'Not paid' }).expect(409);
    await prisma.payment.delete({ where: { id: failedPayment.id } });
    expect((await paymentOf(p.paymentId)).refunds).toHaveLength(0);
    expect([...gateway.refunds.values()].filter((g) => g.paymentId === p.gatewayPaymentId)).toHaveLength(0);
  });

  it('two refunds at once never refund more than was paid', async () => {
    const p = await paid();
    const results = await Promise.all([0, 1, 2, 3].map(() => refund(p.paymentId, { amount: TOTAL / 2 + 100, reason: 'Parallel' })));
    expect(results.map((r) => r.status).toSorted((a, b) => a - b)).toEqual([201, 409, 409, 409]);
    const after = await paymentOf(p.paymentId);
    expect(after.refunds).toHaveLength(1);
    expect([...gateway.refunds.values()].filter((g) => g.paymentId === p.gatewayPaymentId)).toHaveLength(1);
  });

  it('a retried request with the same Idempotency-Key returns the first refund and calls the gateway once', async () => {
    const p = await paid();
    const key = randomUUID();
    const body = { amount: 10000, reason: 'Duplicate charge' };
    const [a, b] = await Promise.all([refund(p.paymentId, body, key), refund(p.paymentId, body, key)]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body.id).toBe(b.body.id);
    const again = await refund(p.paymentId, body, key).expect(201);
    expect(again.body.id).toBe(a.body.id);
    await refund(p.paymentId, { ...body, amount: 20000 }, key).expect(409);
    expect((await paymentOf(p.paymentId)).refunds).toHaveLength(1);
    expect([...gateway.refunds.values()].filter((g) => g.paymentId === p.gatewayPaymentId)).toHaveLength(1);
    expect(await prisma.auditLog.count({ where: { action: 'payment.refund_initiated', entityId: p.paymentId } })).toBe(1);
  });

  it('failed webhook: Refund FAILED, payment back to its previous status; duplicates and stale events change nothing', async () => {
    const p = await paid();
    // First a processed partial refund, so "previous status" is PARTIALLY_REFUNDED.
    const ok = (await refund(p.paymentId, { amount: 10000, reason: 'Part' }).expect(201)).body;
    await send(gateway.refundWebhook('refund.processed', gatewayRefund(ok.id))).expect(200);
    const bad = (await refund(p.paymentId, { amount: 20000, reason: 'More' }).expect(201)).body;
    expect((await paymentOf(p.paymentId)).status).toBe('REFUND_INITIATED');

    events = [];
    const w = gateway.refundWebhook('refund.failed', gatewayRefund(bad.id));
    await send(w).expect(200);
    const after = await paymentOf(p.paymentId);
    expect(after.status).toBe('PARTIALLY_REFUNDED');
    expect(after.refunds[1]).toMatchObject({ id: bad.id, status: 'FAILED', failureReason: expect.any(String), creditNoteNo: null });
    expect(events.map((e) => e.name)).toEqual(['refund.failed']);
    expect(await prisma.creditNote.count({ where: { refundId: bad.id } })).toBe(0);

    // Redelivery (same event id) and a new event about the same refund change nothing.
    events = [];
    await send(w).expect(200);
    await send(gateway.refundWebhook('refund.failed', gatewayRefund(bad.id))).expect(200);
    expect(events).toEqual([]);
    const outcomes = await prisma.paymentWebhookEvent.findMany({ where: { paymentId: p.paymentId, event: 'refund.failed' }, orderBy: { receivedAt: 'asc' }, select: { outcome: true } });
    expect(outcomes.map((o) => o.outcome)).toEqual(['applied', 'duplicate']);

    // A processed refund can't be failed afterwards.
    await send(gateway.refundWebhook('refund.failed', gatewayRefund(ok.id))).expect(200);
    expect((await paymentOf(p.paymentId)).refunds[0].status).toBe('PROCESSED');

    // The failed amount is refundable again.
    const detail = (await http.get(`/api/admin/payments/${p.paymentId}`).set(as(admin)).expect(200)).body;
    expect(detail.refundable).toBe(TOTAL - 10000);
  });

  it('a processed webhook redelivered (even concurrently) applies once and issues one credit note', async () => {
    const p = await paid();
    const r = (await refund(p.paymentId, { amount: 50000, reason: 'Partial' }).expect(201)).body;
    const w = gateway.refundWebhook('refund.processed', gatewayRefund(r.id));
    events = [];
    await Promise.all([send(w), send(w), send(w)]);
    await send(gateway.refundWebhook('refund.processed', gatewayRefund(r.id))).expect(200);
    expect(events.filter((e) => e.name === 'refund.processed')).toHaveLength(1);
    expect(await prisma.creditNote.count({ where: { refundId: r.id } })).toBe(1);
    expect((await paymentOf(p.paymentId)).status).toBe('PARTIALLY_REFUNDED');
  });

  it('matches a webhook that arrives before the gateway refund id is saved, by our id in its notes', async () => {
    const p = await paid();
    const r = (await refund(p.paymentId, { amount: 10000, reason: 'Race' }).expect(201)).body;
    const g = gatewayRefund(r.id);
    await prisma.refund.update({ where: { id: r.id }, data: { gatewayRefundId: null } });
    await send(gateway.refundWebhook('refund.processed', g)).expect(200);
    expect((await paymentOf(p.paymentId)).refunds[0]).toMatchObject({ status: 'PROCESSED', gatewayRefundId: g.id });
    // An unknown gateway refund is stored and ignored.
    await send(gateway.refundWebhook('refund.processed', { ...g, id: 'rfnd_unknown1', receipt: null, notes: {} })).expect(200);
    expect((await prisma.paymentWebhookEvent.findFirstOrThrow({ where: { eventId: eventIds.at(-1) } })).outcome).toBe('unknown_refund');
  });

  it('a refund the gateway refuses is FAILED at once and the payment is unchanged (502)', async () => {
    const p = await paid();
    gateway.failNextCall = new PaymentGatewayError('The refund amount provided is greater than amount captured', false, 400, 'BAD_REQUEST_ERROR');
    const res = await refund(p.paymentId, { amount: 10000, reason: 'Refused' }).expect(502);
    expect(res.body.message).toContain('greater than amount captured');
    const after = await paymentOf(p.paymentId);
    expect(after.status).toBe('SUCCESS');
    expect(after.refunds[0]).toMatchObject({ status: 'FAILED', failureReason: expect.stringContaining('greater than') });
    expect(await prisma.auditLog.count({ where: { action: 'payment.refund_failed', entityId: p.paymentId } })).toBe(1);
  });

  it('only staff with payments.refund may refund (customer, operations and support get 403)', async () => {
    const p = await paid();
    for (const token of [alice, operations, support]) await refund(p.paymentId, { amount: 10000, reason: 'Not allowed' }, randomUUID(), token).expect(403); // NOSONAR: test steps run in order
    expect((await paymentOf(p.paymentId)).refunds).toHaveLength(0);
  });

  it('customer sees refund status and the credit note on their payments; others cannot download it', async () => {
    const p = await paid();
    const r = (await refund(p.paymentId, { amount: 20000, reason: 'Internal note' }).expect(201)).body;
    await send(gateway.refundWebhook('refund.processed', gatewayRefund(r.id))).expect(200);
    const note = await prisma.creditNote.findUniqueOrThrow({ where: { refundId: r.id } });

    const list = (await http.get('/api/payments').set(as(alice)).expect(200)).body;
    const row = list.items.find((i: { id: string }) => i.id === p.paymentId);
    expect(row.status).toBe('PARTIALLY_REFUNDED');
    // The Total Paid card shows the net: processed refunds are counted (alice's earlier tests refunded too).
    expect(list.totalRefunded).toBeGreaterThanOrEqual(20000);
    expect(row.refunds).toEqual([
      { id: r.id, amount: 20000, status: 'PROCESSED', createdAt: expect.any(String), processedAt: expect.any(String), creditNote: { id: note.id, number: note.number, issuedAt: expect.any(String), pdfReady: expect.any(Boolean) } },
    ]);
    // No internal reason or gateway ids for the customer.
    expect(JSON.stringify(row.refunds)).not.toContain('Internal note');

    const admins = (await http.get(`/api/admin/payments/${p.paymentId}`).set(as(support)).expect(200)).body;
    expect(admins.refunds[0]).toMatchObject({ id: r.id, reason: 'Internal note', status: 'PROCESSED', creditNote: { id: note.id, number: note.number } });

    // Download: owner and payments.view staff only (404 for anyone else), once the PDF is ready.
    await http.post(`/api/credit-notes/${note.id}/link`).set(as(bob)).expect(404);
    await http.post(`/api/credit-notes/${note.id}/link`).set(as(operations)).expect(404);
    const deadline = Date.now() + 60_000;
    let ready = await prisma.creditNote.findUniqueOrThrow({ where: { id: note.id }, select: { pdfKey: true } });
    while (!ready.pdfKey && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250)); // NOSONAR: test steps run in order
      ready = await prisma.creditNote.findUniqueOrThrow({ where: { id: note.id }, select: { pdfKey: true } }); // NOSONAR: test steps run in order
    }
    expect(ready.pdfKey).toBeTruthy();
    for (const token of [alice, support]) {
      const link = (await http.post(`/api/credit-notes/${note.id}/link`).set(as(token)).expect(200)).body; // NOSONAR: test steps run in order
      const pdf = await http.get(link.url).buffer(true).parse((res, cb) => { // NOSONAR: test steps run in order
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      }).expect(200);
      expect(pdf.headers['content-type']).toBe('application/pdf');
      expect(pdf.headers['content-disposition']).toContain(`Credit note ${note.number.replaceAll('/', '-')}.pdf`);
      expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    }
  }, 90_000);
});
