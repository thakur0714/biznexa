/**
 * Invoice record (M3.21): every payment the webhook applies gets one invoice — CGST + SGST or IGST by place
 * of supply, the SAC code, the government fee as a line of its own without GST, the total in words, and the
 * seller and buyer copied as they were. An advance and its balance each get one, adding up to the order.
 * Invoices are dated in a far-future year of this run's own, so the real counters are never touched.
 */
import { randomInt, randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { financialYear, INVOICE_NUMBER_PATTERN, type AnyDomainEvent, type SellerSettings } from '@biznexa/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { EventBus } from '../src/events/event-bus';
import { InvoicesService } from '../src/invoices/invoices.service';
import { PaymentGateway } from '../src/payments/payment-gateway';
import { MockPaymentGateway } from '../src/payments/mock-payment-gateway';
import { Prisma } from '../src/generated/prisma/client';
import { SettingsService } from '../src/settings/settings.service';

let app: NestExpressApplication;
let http: ReturnType<typeof request>;
let prisma: PrismaService;
let gateway: MockPaymentGateway;
let invoices: InvoicesService;
let events: AnyDomainEvent[] = [];
let alice: string;
let aliceId: string;
let fullPackageId: string;
let partPackageId: string;

const run = randomUUID();
const invoicePrefix = `T${run.slice(0, 3).toUpperCase()}`;
const mobileRun = String(randomInt(1_000_000, 10_000_000));
const base = '/api/applications';
const as = (token: string) => ({ authorization: `Bearer ${token}` });
const users = { email: { startsWith: `e2e-inv-${run}` } };
const slugs = [`e2e-inv-${run}`, `e2e-inv-part-${run}`];
const codes: string[] = [];
const eventIds: string[] = [];

// Invoice date: 1 July of a year between 3500 and 3999, inside one financial year — this spec's own range
// (invoice-pdf uses 3000–3499, invoice-numbers 2200–2829), so the counter it deletes at the end is its alone.
const AT = new Date(`${3500 + Math.floor(Math.random() * 500)}-07-01T06:30:00Z`);
const FY = financialYear(AT);

// ₹1,000 fee + 18 % GST, and (part package) ₹4,500 government fee with a 30 % advance.
const FEE = 100000;
const GOVT = 450000;
const SAC = '998231';

const SELLER: SellerSettings = {
  name: 'BizNexa',
  legalName: 'BizNexa Services Private Limited',
  gstin: '03AAACB1234C1ZV',
  email: 'billing@example.com',
  phone: null,
  address: { line1: '12 Mall Road', city: 'Ludhiana', state: 'Punjab', pincode: '141001' },
  state: 'Punjab',
  invoicePrefix,
  updatedAt: null,
};

async function register(n: number) {
  const res = await http
    .post('/api/auth/register')
    .send({ name: `Invoice Test ${n}`, mobile: `8${mobileRun}${String(60 + n)}`, email: `e2e-inv-${run}-${n}@example.com`, password: 'secret123', consent: true })
    .expect(201);
  return { token: res.body.accessToken as string, id: res.body.user.id as string };
}

async function coupon() {
  const code = `E2EINV${run.slice(0, 8)}${codes.length}`.toUpperCase();
  codes.push(code);
  await prisma.coupon.create({ data: { code, type: 'PERCENTAGE', value: 10, perUserLimit: null } });
  return code;
}

/** A completed draft for a business in `state` (with a GSTIN when given), optionally with a coupon. */
async function ready(opts: { pkg?: string; state: string; gstin?: string; coupon?: string }) {
  const business = await prisma.businessEntity.create({
    data: {
      ownerId: aliceId,
      legalName: `Buyer ${randomUUID().slice(0, 6)} Pvt Ltd`,
      entityType: 'PRIVATE_LIMITED',
      gstin: opts.gstin ?? null,
      address: { line1: '4 Ring Road', city: 'City', state: opts.state, pincode: '110001' },
      state: opts.state,
    },
    select: { id: true, legalName: true },
  });
  const draft = await http.post(base).set(as(alice)).send({ packageId: opts.pkg ?? fullPackageId, businessEntityId: business.id }).expect(201);
  const id = draft.body.id as string;
  await http.patch(`${base}/${id}`).set(as(alice)).send({ formData: { note: 'Ready' }, final: true }).expect(200);
  if (opts.coupon) {
    await http.put(`${base}/${id}/coupon`).set(as(alice)).send({ code: opts.coupon }).expect(200);
  }
  return { id, orderId: draft.body.order.id as string, buyerName: business.legalName };
}

/** Start a payment (plan as given) and have the gateway confirm it through a signed webhook. */
async function pay(id: string, body: object = {}) {
  const start = (await http.post(`${base}/${id}/payment`).set(as(alice)).send(body).expect(200)).body;
  events = [];
  await hook('payment.captured', gateway.pay(start.gatewayOrderId).payment);
  return start as { paymentId: string; amount: number; gatewayOrderId: string };
}

/** Sends a signed webhook. */
async function hook(event: string, payment: Parameters<MockPaymentGateway['webhook']>[1]) {
  const w = gateway.webhook(event, payment);
  eventIds.push(w.headers['x-razorpay-event-id']);
  await http.post('/api/payments/webhook').set(w.headers).send(w.body).expect(200);
}

/**
 * Runs the sweep over this run's payments only: the local database may hold other paid payments without an
 * invoice (from before this step, or other suites), which must not be invoiced in this run's year.
 */
async function sweep() {
  const ours = new Set((await prisma.payment.findMany({ where: { order: { customer: users } }, select: { id: true } })).map((p) => p.id));
  const spy = jest.spyOn(invoices, 'issue').mockImplementation((paymentId) => (ours.has(paymentId) ? issueAt(paymentId) : Promise.resolve(null)));
  try {
    return await invoices.issueMissing();
  } finally {
    spy.mockImplementation(issueAt);
  }
}
let issueAt: (paymentId: string) => ReturnType<InvoicesService['issue']>;

const invoiceOf = (paymentId: string) => prisma.invoice.findUniqueOrThrow({ where: { paymentId } });
const issuedEvents = () => events.filter((e) => e.name === 'invoice.issued');

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true }));
  await app.init();
  http = request(app.getHttpServer()) as unknown as ReturnType<typeof request>;
  prisma = app.get(PrismaService);
  gateway = app.get(PaymentGateway) as MockPaymentGateway;
  invoices = app.get(InvoicesService);
  // Invoice PDFs (M3.23) are generated in the background and can land during a later test: not counted here.
  app.get(EventBus).onAny((e) => void (e.name !== 'pdf.generated' && events.push(e)));
  // Every invoice of this run (listener and sweep both go through `issue`) is dated in this run's year. Anything
  // else this process issues (the 10-minute sweep can pick up another suite's payment) keeps today's date, so it
  // never takes a number from the counter deleted in afterAll.
  const issue = invoices.issue.bind(invoices);
  issueAt = async (paymentId) => {
    const ours = (await prisma.payment.count({ where: { id: paymentId, order: { customer: users } } })) > 0;
    return ours ? issue(paymentId, AT) : issue(paymentId);
  };
  jest.spyOn(invoices, 'issue').mockImplementation(issueAt);
  ({ token: alice, id: aliceId } = await register(1));

  jest.spyOn(app.get(SettingsService), 'seller').mockResolvedValue(SELLER);

  const cat = await prisma.category.findUniqueOrThrow({ where: { slug: 'licenses' } });
  const form = { create: [{ version: 1, schema: { steps: [{ title: 'About', fields: [{ type: 'text', name: 'note', label: 'Note', required: true }] }] }, isCurrent: true }] };
  const service = (slug: string, name: string, pkg: Prisma.ServicePackageCreateWithoutServiceInput) =>
    prisma.service.create({
      data: { slug, categoryId: cat.id, name, shortDescription: 'A service used to test invoices.', sacCode: SAC, packages: { create: [pkg] }, formSchemas: form },
      select: { packages: { select: { id: true } } },
    });
  fullPackageId = (await service(slugs[0], 'Invoice test', { name: 'Basic', professionalFee: FEE, governmentFee: 0, gstRate: 18 })).packages[0].id;
  partPackageId = (
    await service(slugs[1], 'Invoice part test', { name: 'Standard', professionalFee: FEE, governmentFee: GOVT, gstRate: 18, allowPartial: true, advancePercent: 30 })
  ).packages[0].id;
});

beforeEach(() => {
  events = [];
});

afterAll(async () => {
  jest.restoreAllMocks();
  const orders = { customer: users };
  await prisma.auditLog.deleteMany({ where: { OR: [{ actor: users }, { entityType: 'Application', entityId: { in: (await prisma.application.findMany({ where: { order: orders }, select: { id: true } })).map((a) => a.id) } }] } });
  await prisma.invoice.deleteMany({ where: { order: orders } });
  await prisma.invoiceSequence.deleteMany({ where: { financialYear: FY } });
  await prisma.paymentWebhookEvent.deleteMany({ where: { OR: [{ payment: { order: orders } }, { eventId: { in: eventIds } }] } });
  await prisma.couponRedemption.deleteMany({ where: { userId: aliceId } });
  await prisma.payment.deleteMany({ where: { order: orders } });
  await prisma.application.deleteMany({ where: { order: orders } });
  await prisma.order.deleteMany({ where: orders });
  await prisma.coupon.deleteMany({ where: { code: { in: codes } } });
  await prisma.businessEntity.deleteMany({ where: { owner: users } });
  await prisma.service.deleteMany({ where: { slug: { in: slugs } } });
  await prisma.user.deleteMany({ where: users });
  await app.close();
});

describe('invoice record (M3.21)', () => {
  it('intra-state: CGST + SGST with the SAC code, seller and buyer copied, total in words', async () => {
    const s = await ready({ state: 'Punjab', gstin: '03AAACT2727Q1ZW' });
    const p = await pay(s.id);
    expect(p.amount).toBe(118000);

    const inv = await invoiceOf(p.paymentId);
    expect(inv.number).toMatch(INVOICE_NUMBER_PATTERN);
    expect(inv.number.startsWith(`${invoicePrefix}/`)).toBe(true);
    expect(inv).toMatchObject({
      financialYear: FY,
      issuedAt: AT,
      orderId: s.orderId,
      customerId: aliceId,
      sellerGstin: '03AAACB1234C1ZV',
      buyerName: s.buyerName,
      buyerGstin: '03AAACT2727Q1ZW',
      placeOfSupply: 'Punjab',
      taxType: 'CGST_SGST',
      taxableValue: 100000,
      cgst: 9000,
      sgst: 9000,
      igst: 0,
      govtFees: 0,
      discount: 0,
      total: 118000,
      amountInWords: 'Rupees One Thousand One Hundred Eighty Only',
    });
    expect(inv.lines).toEqual([
      {
        kind: 'SERVICE',
        orderItemId: expect.any(String),
        description: 'Invoice test — Basic',
        sacCode: SAC,
        gstRate: 18,
        professionalFee: 100000,
        discount: 0,
        taxableValue: 100000,
        cgst: 9000,
        sgst: 9000,
        igst: 0,
        total: 118000,
      },
    ]);
    expect(inv.seller).toEqual({
      name: 'BizNexa',
      legalName: 'BizNexa Services Private Limited',
      gstin: '03AAACB1234C1ZV',
      email: 'billing@example.com',
      phone: null,
      address: { line1: '12 Mall Road', city: 'Ludhiana', state: 'Punjab', pincode: '141001' },
      state: 'Punjab',
    });
    expect(inv.buyer).toEqual({
      name: s.buyerName,
      gstin: '03AAACT2727Q1ZW',
      email: `e2e-inv-${run}-1@example.com`,
      mobile: expect.stringMatching(/^(\+91)?8/),
      address: { line1: '4 Ring Road', city: 'City', state: 'Punjab', pincode: '110001' },
      state: 'Punjab',
    });
    expect(issuedEvents().map((e) => e.payload)).toEqual([
      { invoiceId: inv.id, number: inv.number, paymentId: p.paymentId, orderId: s.orderId, customerId: aliceId, total: 118000 },
    ]);
  });

  it('inter-state: IGST only', async () => {
    const s = await ready({ state: 'Delhi' });
    const p = await pay(s.id);
    const inv = await invoiceOf(p.paymentId);
    expect(inv).toMatchObject({ placeOfSupply: 'Delhi', taxType: 'IGST', buyerGstin: null, taxableValue: 100000, cgst: 0, sgst: 0, igst: 18000, total: 118000 });
    expect(inv.lines).toEqual([expect.objectContaining({ kind: 'SERVICE', sacCode: SAC, igst: 18000, cgst: 0, sgst: 0 })]);
  });

  it('with a coupon: GST on the fee after discount, discount shown', async () => {
    const s = await ready({ state: 'Punjab', coupon: await coupon() });
    const p = await pay(s.id);
    // 10 % off ₹1,000 → ₹900 + ₹81 CGST + ₹81 SGST.
    expect(p.amount).toBe(106200);
    const inv = await invoiceOf(p.paymentId);
    expect(inv).toMatchObject({ discount: 10000, taxableValue: 90000, cgst: 8100, sgst: 8100, total: 106200, amountInWords: 'Rupees One Thousand Sixty-Two Only' });
    expect(inv.lines).toEqual([expect.objectContaining({ professionalFee: 100000, discount: 10000, taxableValue: 90000, total: 106200 })]);
  });

  it('with a government fee: its own line with no GST; an advance and its balance are each invoiced and add up to the order', async () => {
    const s = await ready({ pkg: partPackageId, state: 'Delhi' });
    const total = FEE + 18000 + GOVT;

    const adv = await pay(s.id, { plan: 'ADVANCE' });
    // The whole government fee + 30 % of ₹1,180 = ₹354, of which ₹300 is the fee and ₹54 IGST.
    expect(adv.amount).toBe(GOVT + 35400);
    const first = await invoiceOf(adv.paymentId);
    expect(first).toMatchObject({ taxType: 'IGST', govtFees: GOVT, taxableValue: 30000, igst: 5400, cgst: 0, sgst: 0, total: adv.amount });
    expect(first.amountInWords).toBe('Rupees Four Thousand Eight Hundred Fifty-Four Only');
    expect(first.lines).toEqual([
      expect.objectContaining({ kind: 'SERVICE', sacCode: SAC, taxableValue: 30000, igst: 5400, total: 35400 }),
      { kind: 'GOVERNMENT_FEE', orderItemId: expect.any(String), description: 'Government fee — Invoice part test — Standard', total: GOVT },
    ]);

    const bal = await pay(s.id);
    expect(bal.amount).toBe(total - adv.amount);
    const second = await invoiceOf(bal.paymentId);
    expect(second).toMatchObject({ taxType: 'IGST', govtFees: 0, taxableValue: 70000, igst: 12600, total: bal.amount });
    expect(second.lines).toEqual([expect.objectContaining({ kind: 'SERVICE', taxableValue: 70000, igst: 12600 })]);
    expect(second.sequence).toBeGreaterThan(first.sequence);
    expect(first.taxableValue + second.taxableValue).toBe(FEE);
    expect(first.total + second.total).toBe(total);
  });

  it('issues once: a repeated or concurrent issue returns the same invoice, and nothing for money not owed', async () => {
    const s = await ready({ state: 'Punjab' });
    const p = await pay(s.id);
    const inv = await invoiceOf(p.paymentId);
    events = [];
    const again = await Promise.all([1, 2, 3].map(() => invoices.issue(p.paymentId)));
    expect(again).toEqual([1, 2, 3].map(() => ({ id: inv.id, number: inv.number })));
    expect(await prisma.invoice.count({ where: { orderId: s.orderId } })).toBe(1);
    expect(issuedEvents()).toEqual([]);
    expect(await sweep()).toBe(0);
  });

  it('money not owed (a second window paid after the order was paid) gets no invoice', async () => {
    const s = await ready({ state: 'Punjab' });
    // The first attempt fails, the retry pays the order, then the first window is paid as well.
    const first = (await http.post(`${base}/${s.id}/payment`).set(as(alice)).send({}).expect(200)).body;
    await hook('payment.failed', gateway.fail(first.gatewayOrderId));
    const retry = await pay(s.id);
    expect(retry.paymentId).not.toBe(first.paymentId);
    await hook('payment.captured', gateway.pay(first.gatewayOrderId).payment);

    expect(await prisma.payment.findUniqueOrThrow({ where: { id: first.paymentId }, select: { status: true } })).toEqual({ status: 'SUCCESS' });
    expect(await invoices.issue(first.paymentId)).toBeNull();
    expect(await sweep()).toBe(0);
    expect(await prisma.invoice.findMany({ where: { orderId: s.orderId }, select: { paymentId: true } })).toEqual([{ paymentId: retry.paymentId }]);
  });

  it('a payment whose invoice failed (or whose event was lost) is invoiced by the sweep', async () => {
    const s = await ready({ state: 'Punjab' });
    const spy = jest.spyOn(invoices, 'issue');
    spy.mockRejectedValueOnce(new Error('Database went away'));
    const p = await pay(s.id);
    // The payment itself is unaffected by the listener failing.
    expect(await prisma.order.findUniqueOrThrow({ where: { id: s.orderId }, select: { status: true } })).toEqual({ status: 'PAID' });
    expect(await prisma.invoice.findUnique({ where: { paymentId: p.paymentId } })).toBeNull();

    expect(await sweep()).toBe(1);
    expect(await invoiceOf(p.paymentId)).toMatchObject({ financialYear: FY, total: 118000, taxType: 'CGST_SGST' });
    expect(issuedEvents().map((e) => e.payload)).toContainEqual(expect.objectContaining({ paymentId: p.paymentId }));
  });
});
