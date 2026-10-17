/**
 * Invoice PDF + download (M3.23): a payment confirmed through the mock gateway's signed webhook gets its
 * invoice PDF within a minute (`invoice.issued` → `pdf` queue → stored, `Invoice.pdfKey` set). The customer
 * it was issued to — or staff with `payments.view` — get a 5-minute signed link that streams the PDF; anyone
 * else gets 404, and a tampered, expired or re-targeted link is refused. Uses the configured renderer
 * (headless Chromium unless PDF_RENDERER=stub). Invoices are dated in a far-future year of this run's own.
 */
import { randomInt, randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { financialYear, type SellerSettings } from '@biznexa/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { StorageService } from '../src/files/storage.service';
import { signedPath } from '../src/files/files.service';
import { InvoicesService } from '../src/invoices/invoices.service';
import { PaymentGateway } from '../src/payments/payment-gateway';
import { MockPaymentGateway } from '../src/payments/mock-payment-gateway';
import { SettingsService } from '../src/settings/settings.service';
import { staffSession } from './staff';

let app: NestExpressApplication;
let http: ReturnType<typeof request>;
let prisma: PrismaService;
let storage: StorageService;
let gateway: MockPaymentGateway;
let alice: string;
let bob: string;
let support: string;
let operations: string;
let packageId: string;

const run = randomUUID();
const invoicePrefix = `P${run.slice(0, 3).toUpperCase()}`;
const mobileRun = String(randomInt(1_000_000, 10_000_000));
const base = '/api/applications';
const as = (token: string) => ({ authorization: `Bearer ${token}` });
const users = { email: { startsWith: `e2e-ipdf-${run}` } };
const slug = `e2e-ipdf-${run}`;
const eventIds: string[] = [];

const AT = new Date(`${2900 + Math.floor(Math.random() * 100)}-07-01T06:30:00Z`);
const FY = financialYear(AT);

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
    .send({ name: `Invoice PDF ${n}`, mobile: `7${mobileRun}${String(70 + n)}`, email: `e2e-ipdf-${run}-${n}@example.com`, password: 'secret123', consent: true })
    .expect(201);
  return res.body.accessToken as string;
}

/** A completed draft, paid through the mock gateway's signed webhook. Returns the application and payment. */
async function paidApplication() {
  const draft = await http.post(base).set(as(alice)).send({ packageId }).expect(201);
  const id = draft.body.id as string;
  await http.patch(`${base}/${id}`).set(as(alice)).send({ formData: { note: 'Ready' }, final: true }).expect(200);
  const start = (await http.post(`${base}/${id}/payment`).set(as(alice)).send({}).expect(200)).body as { paymentId: string; gatewayOrderId: string };
  const w = gateway.webhook('payment.captured', gateway.pay(start.gatewayOrderId).payment);
  eventIds.push(w.headers['x-razorpay-event-id']);
  await http.post('/api/payments/webhook').set(w.headers).send(w.body).expect(200);
  return { applicationId: id, paymentId: start.paymentId };
}

/** Polls until the invoice of `paymentId` has its PDF; returns the invoice and how long it took. */
async function pdfOf(paymentId: string, since: number, ms = 60_000) {
  while (Date.now() - since < ms) {
    const inv = await prisma.invoice.findUnique({ where: { paymentId }, select: { id: true, number: true, pdfKey: true } });
    if (inv?.pdfKey) return { ...inv, pdfKey: inv.pdfKey, took: Date.now() - since };
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`No invoice PDF for payment ${paymentId} within ${ms} ms`);
}

async function stored(key: string) {
  const { stream } = await storage.read(key);
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

/** supertest keeps binary bodies as text unless told otherwise. */
const binary = (res: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true }));
  await app.init();
  http = request(app.getHttpServer()) as unknown as ReturnType<typeof request>;
  prisma = app.get(PrismaService);
  storage = app.get(StorageService);
  gateway = app.get(PaymentGateway) as MockPaymentGateway;
  const invoices = app.get(InvoicesService);
  const issue = invoices.issue.bind(invoices);
  jest.spyOn(invoices, 'issue').mockImplementation((paymentId) => issue(paymentId, AT));
  jest.spyOn(app.get(SettingsService), 'seller').mockResolvedValue(SELLER);

  alice = await register(1);
  bob = await register(2);
  support = (await staffSession(http, prisma, 'SUPPORT', `e2e-ipdf-${run}-support@example.com`)).accessToken;
  operations = (await staffSession(http, prisma, 'OPERATIONS', `e2e-ipdf-${run}-ops@example.com`)).accessToken;


  const cat = await prisma.category.findUniqueOrThrow({ where: { slug: 'licenses' } });
  const service = await prisma.service.create({
    data: {
      slug,
      categoryId: cat.id,
      name: 'Invoice PDF test',
      shortDescription: 'A service used to test invoice PDFs.',
      sacCode: '998231',
      packages: { create: [{ name: 'Basic', professionalFee: 100000, governmentFee: 0, gstRate: 18 }] },
      formSchemas: { create: [{ version: 1, schema: { steps: [{ title: 'About', fields: [{ type: 'text', name: 'note', label: 'Note', required: true }] }] }, isCurrent: true }] },
    },
    select: { packages: { select: { id: true } } },
  });
  packageId = service.packages[0].id;
});

afterAll(async () => {
  jest.restoreAllMocks();
  const orders = { customer: users };
  const invoices = await prisma.invoice.findMany({ where: { order: orders }, select: { pdfKey: true } });
  for (const { pdfKey } of invoices) if (pdfKey) await storage.remove(pdfKey);
  await prisma.auditLog.deleteMany({ where: { OR: [{ actor: users }, { entityType: 'Application', entityId: { in: (await prisma.application.findMany({ where: { order: orders }, select: { id: true } })).map((a) => a.id) } }] } });
  await prisma.invoice.deleteMany({ where: { order: orders } });
  await prisma.invoiceSequence.deleteMany({ where: { financialYear: FY } });
  await prisma.paymentWebhookEvent.deleteMany({ where: { OR: [{ payment: { order: orders } }, { eventId: { in: eventIds } }] } });
  await prisma.payment.deleteMany({ where: { order: orders } });
  await prisma.application.deleteMany({ where: { order: orders } });
  await prisma.order.deleteMany({ where: orders });
  await prisma.service.deleteMany({ where: { slug } });
  await prisma.user.deleteMany({ where: users });
  await app.close();
});

describe('invoice PDF + download (M3.23)', () => {
  let applicationId: string;
  let invoice: { id: string; number: string; pdfKey: string };

  it('a payment through the mock gateway gets its invoice PDF within a minute', async () => {
    const since = Date.now();
    const paid = await paidApplication();
    applicationId = paid.applicationId;
    const done = await pdfOf(paid.paymentId, since);
    expect(done.took).toBeLessThan(60_000);
    invoice = done;
    expect((await stored(done.pdfKey)).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('lists the customer’s own invoices, by application', async () => {
    const list = (await http.get('/api/invoices').query({ applicationId }).set(as(alice)).expect(200)).body;
    expect(list).toEqual([{ id: invoice.id, number: invoice.number, issuedAt: AT.toISOString(), orderCode: expect.stringMatching(/^ORD-/), total: 118000, pdfReady: true }]);
    expect((await http.get('/api/invoices').set(as(bob)).expect(200)).body).toEqual([]);
    expect((await http.get('/api/invoices').query({ applicationId }).set(as(bob)).expect(200)).body).toEqual([]);
    await http.get('/api/invoices').expect(401);
  });

  it('the owner gets a signed link that streams the stored PDF', async () => {
    const link = (await http.post(`/api/invoices/${invoice.id}/link`).set(as(alice)).expect(200)).body;
    expect(link.url).toMatch(new RegExp(`^/api/invoices/${invoice.id}/download\\?`));
    expect(new Date(link.expiresAt).getTime()).toBeGreaterThan(Date.now() + 4 * 60_000);

    const res = await http.get(link.url).buffer(true).parse(binary).expect(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain(`attachment; filename="Invoice ${invoice.number.replace(/\//g, '-')}.pdf"`);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(Buffer.compare(res.body as Buffer, await stored(invoice.pdfKey))).toBe(0);

    const inline = (await http.post(`/api/invoices/${invoice.id}/link`).query({ disposition: 'inline' }).set(as(alice)).expect(200)).body;
    expect((await http.get(inline.url).expect(200)).headers['content-disposition']).toMatch(/^inline;/);
  });

  it('another customer, and staff without payments.view, get 404; support staff get a link', async () => {
    await http.post(`/api/invoices/${invoice.id}/link`).set(as(bob)).expect(404);
    await http.post(`/api/invoices/${invoice.id}/link`).set(as(operations)).expect(404);
    await http.post(`/api/invoices/00000000-0000-4000-8000-000000000000/link`).set(as(alice)).expect(404);
    await http.post(`/api/invoices/${invoice.id}/link`).expect(401);
    const link = (await http.post(`/api/invoices/${invoice.id}/link`).set(as(support)).expect(200)).body;
    await http.get(link.url).expect(200);
  });

  it('refuses tampered, expired and re-targeted links', async () => {
    const { url } = (await http.post(`/api/invoices/${invoice.id}/link`).set(as(alice)).expect(200)).body as { url: string };
    await http.get(url.replace(/s=[^&]+/, 's=AAAA')).expect(403);
    await http.get(url.replace('d=attachment', 'd=inline')).expect(403);
    await http.get(url.replace(/e=\d+/, (m) => `e=${Number(m.slice(2)) + 60}`)).expect(403);
    await http.get(signedPath(invoice.id, Math.floor(Date.now() / 1000) - 1, 'attachment', 'invoices')).expect(403);
    // A stored-file link for the same id is signed for /api/files and does not open the invoice.
    await http.get(signedPath(invoice.id, Math.floor(Date.now() / 1000) + 60, 'attachment', 'files').replace('/api/files/', '/api/invoices/')).expect(403);
    // The invoice link does not open a stored file either.
    await http.get(url.replace('/api/invoices/', '/api/files/')).expect(403);
  });

  it('409 while the PDF is being made; asking again queues it, and it arrives', async () => {
    await storage.remove(invoice.pdfKey);
    await prisma.invoice.update({ where: { id: invoice.id }, data: { pdfKey: null } });
    const since = Date.now();
    const res = await http.post(`/api/invoices/${invoice.id}/link`).set(as(alice)).expect(409);
    expect(res.body.message).toBe('Your invoice is still being prepared. Please try again in a minute.');
    expect((await http.get('/api/invoices').set(as(alice)).expect(200)).body[0].pdfReady).toBe(false);
    const again = await pdfOf((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).paymentId, since);
    expect(again.pdfKey).not.toBe(invoice.pdfKey);
    invoice = again;
    await http.post(`/api/invoices/${invoice.id}/link`).set(as(alice)).expect(200);
  });
});
