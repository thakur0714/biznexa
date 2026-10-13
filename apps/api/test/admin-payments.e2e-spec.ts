import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { staffSession } from './staff';

let app: NestExpressApplication;
let http: ReturnType<typeof request>;
let prisma: PrismaService;
let admin: string;
let ops: string;
let customerId: string;
let orderId: string;
let paymentId: string;

const run = `${Date.now().toString().slice(-7)}${Math.floor(Math.random() * 100)}`;
const email = (n: number) => `e2e-pay-${run}-${n}@example.com`;
const as = (token: string) => ({ authorization: `Bearer ${token}` });

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
  await app.init();
  http = request(app.getHttpServer()) as unknown as ReturnType<typeof request>;
  prisma = app.get(PrismaService);

  admin = (await staffSession(http, prisma, 'ADMIN', email(1))).accessToken;
  ops = (await staffSession(http, prisma, 'OPERATIONS', email(2))).accessToken;

  // Create a customer with a formula in their name to test CSV injection escaping
  const customer = await prisma.user.create({
    data: {
      name: '=cmd|\' /C calc\'!A0',
      email: email(3),
      mobile: `9${run}00`,
    },
  });
  customerId = customer.id;

  const order = await prisma.order.create({
    data: {
      code: `ORD-PAY-${run}`,
      customerId,
      subtotal: 100000,
      total: 118000,
      status: 'PAID',
      amountPaid: 118000,
    },
  });
  orderId = order.id;

  const payment = await prisma.payment.create({
    data: {
      orderId,
      gateway: 'MOCK',
      gatewayOrderId: `order_pay_${run}`,
      gatewayPaymentId: `pay_pay_${run}`,
      amount: 118000,
      method: 'upi',
      status: 'SUCCESS',
      paidAt: new Date(),
      rawWebhook: { event: 'payment.captured', secret_data: 'sensitive' },
    },
  });
  paymentId = payment.id;
});

afterAll(async () => {
  await prisma.payment.deleteMany({ where: { orderId } });
  await prisma.order.deleteMany({ where: { id: orderId } });
  await prisma.user.deleteMany({ where: { email: { startsWith: `e2e-pay-${run}` } } });
  await app.close();
});

describe('admin payments (M4.15)', () => {
  it('lists payments with server-side pagination and filters', async () => {
    const res = await http
      .get('/api/admin/payments')
      .set(as(admin))
      .query({ q: `ORD-PAY-${run}`, status: 'success' })
      .expect(200);

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({
      id: paymentId,
      amount: 118000,
      status: 'SUCCESS',
      orderCode: `ORD-PAY-${run}`,
      customerName: '=cmd|\' /C calc\'!A0',
    });
    expect(res.body.items[0]).not.toHaveProperty('rawWebhook');
  });

  it('gets payment detail without rawWebhook', async () => {
    const res = await http.get(`/api/admin/payments/${paymentId}`).set(as(admin)).expect(200);

    expect(res.body).toMatchObject({
      id: paymentId,
      amount: 118000,
      status: 'SUCCESS',
      orderCode: `ORD-PAY-${run}`,
      customerName: '=cmd|\' /C calc\'!A0',
      refunds: [],
    });
    expect(res.body).not.toHaveProperty('rawWebhook');
  });

  it('exports CSV with formula injection escaping and amounts in rupees', async () => {
    const res = await http
      .get('/api/admin/payments/export')
      .set(as(admin))
      .query({ q: `ORD-PAY-${run}` })
      .expect(200);

    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('attachment; filename="payments-');

    const csvText = res.text;
    expect(csvText).toContain('Created,Paid,Order Code,Application Code,Customer Name');
    // Amount in rupees with 2 decimals
    expect(csvText).toContain('"1180.00"');
    // Escaped formula injection
    expect(csvText).toContain('"\'=cmd|\' /C calc\'!A0"');
  });

  it('refuses user without PAYMENTS_VIEW with 403', async () => {
    await http.get('/api/admin/payments').set(as(ops)).expect(403);
    await http.get(`/api/admin/payments/${paymentId}`).set(as(ops)).expect(403);
    await http.get('/api/admin/payments/export').set(as(ops)).expect(403);
  });
});
