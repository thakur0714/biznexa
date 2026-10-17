import { randomInt } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';

let app: NestExpressApplication;
let http: ReturnType<typeof request>;
let prisma: PrismaService;

let userA: { token: string; id: string };
let userB: { token: string; id: string };

// Random part: suites run in parallel and register customers, so a time-only id can repeat across files.
const run = `${Date.now().toString().slice(-4)}${randomInt(100, 1000)}`;
const prefix = `CUST-PAY-${run}`;
const as = (token: string) => ({ authorization: `Bearer ${token}` });

async function registerUser(n: number) {
  const res = await http
    .post('/api/auth/register')
    .send({
      name: `Cust Pay User ${n}`,
      mobile: `7${run}${String(10 + n).padStart(2, '0')}`,
      email: `e2e-custpay-${run}-${n}@example.com`,
      password: 'secretPassword123!',
      consent: true,
    });
  if (res.status !== 201) {
    throw new Error(`Register failed with ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return { token: res.body.accessToken as string, id: res.body.user.id as string };
}

let orderAId: string;
let paymentAId: string;
let invoiceAId: string;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
  await app.init();
  http = request(app.getHttpServer()) as unknown as ReturnType<typeof request>;
  prisma = app.get(PrismaService);

  userA = await registerUser(1);
  userB = await registerUser(2);

  const cat = await prisma.category.create({
    data: { name: `${prefix}-Cat`, slug: `${prefix.toLowerCase()}-cat` },
  });
  const svc = await prisma.service.create({
    data: {
      name: `${prefix}-Svc`,
      slug: `${prefix.toLowerCase()}-svc`,
      categoryId: cat.id,
      shortDescription: 'test desc',
    },
  });
  const pkg = await prisma.servicePackage.create({
    data: {
      serviceId: svc.id,
      name: 'Standard',
      professionalFee: 50000,
    },
  });

  const orderA = await prisma.order.create({
    data: {
      code: `ORD-${run}-A`,
      customerId: userA.id,
      subtotal: 50000,
      total: 59000,
      amountPaid: 30000,
      status: 'PARTIALLY_PAID',
    },
  });
  orderAId = orderA.id;

  const appA = await prisma.application.create({
    data: {
      code: `APP-${run}-A`,
      orderId: orderA.id,
      customerId: userA.id,
      serviceId: svc.id,
      packageId: pkg.id,
      status: 'DOCUMENTS_PENDING',
    },
  });

  const paymentA = await prisma.payment.create({
    data: {
      orderId: orderA.id,
      amount: 30000,
      status: 'SUCCESS',
      gateway: 'RAZORPAY',
      method: 'upi',
      paidAt: new Date(),
    },
  });
  paymentAId = paymentA.id;

  const invoiceA = await prisma.invoice.create({
    data: {
      number: `BN/2627/${run}`,
      financialYear: '2026-27',
      sequence: Number(run),
      issuedAt: new Date(),
      orderId: orderA.id,
      paymentId: paymentA.id,
      customerId: userA.id,
      seller: {},
      buyerName: 'Cust Pay User 1',
      buyer: {},
      taxType: 'CGST_SGST',
      lines: [],
      taxableValue: 25424,
      total: 30000,
      amountInWords: 'Thirty Thousand Rupees Only',
    },
  });
  invoiceAId = invoiceA.id;
});

afterAll(async () => {
  try {
    if (invoiceAId) await prisma.invoice.deleteMany({ where: { id: invoiceAId } });
    if (paymentAId) await prisma.payment.deleteMany({ where: { id: paymentAId } });
    if (orderAId) {
      await prisma.application.deleteMany({ where: { orderId: orderAId } });
      await prisma.order.deleteMany({ where: { id: orderAId } });
    }
    await prisma.servicePackage.deleteMany({ where: { name: 'Standard', service: { name: `${prefix}-Svc` } } });
    await prisma.service.deleteMany({ where: { name: `${prefix}-Svc` } });
    await prisma.category.deleteMany({ where: { name: `${prefix}-Cat` } });
    await prisma.user.deleteMany({ where: { email: { startsWith: `e2e-custpay-${run}` } } });
  } finally {
    await app.close();
  }
});

describe('customer payments API (M5.10)', () => {
  it('refuses unauthenticated requests with 401', async () => {
    await http.get('/api/payments').expect(401);
  });

  it('validates query parameters with 400', async () => {
    await http.get('/api/payments').set(as(userA.token)).query({ limit: 0 }).expect(400);
    await http.get('/api/payments').set(as(userA.token)).query({ limit: 105 }).expect(400);
    await http.get('/api/payments').set(as(userA.token)).query({ page: -1 }).expect(400);
  });

  it('owner sees own payments and summary', async () => {
    const res = await http.get('/api/payments').set(as(userA.token)).expect(200);

    expect(res.body.total).toBe(1);
    expect(res.body.totalPaid).toBe(30000);
    expect(res.body.totalRefunded).toBe(0);
    expect(res.body.outstandingBalance).toBe(29000); // 59000 - 30000

    expect(res.body.items).toHaveLength(1);
    const item = res.body.items[0];
    expect(item.id).toBe(paymentAId);
    expect(item.amount).toBe(30000);
    expect(item.status).toBe('SUCCESS');
    expect(item.method).toBe('upi');
    expect(item.gateway).toBe('RAZORPAY');

    expect(item.order.id).toBe(orderAId);
    expect(item.order.code).toBe(`ORD-${run}-A`);
    expect(item.order.total).toBe(59000);
    expect(item.order.amountPaid).toBe(30000);
    expect(item.order.balance).toBe(29000);
    expect(item.order.serviceSlug).toBe(`${prefix.toLowerCase()}-svc`);

    expect(item.invoice).toBeDefined();
    expect(item.invoice.id).toBe(invoiceAId);
    expect(item.invoice.number).toBe(`BN/2627/${run}`);
  });

  it('other customer gets nothing / empty list (data isolation)', async () => {
    const res = await http.get('/api/payments').set(as(userB.token)).expect(200);

    expect(res.body.total).toBe(0);
    expect(res.body.items).toHaveLength(0);
    expect(res.body.totalPaid).toBe(0);
    expect(res.body.outstandingBalance).toBe(0);
  });
});
