import { randomInt } from 'node:crypto';
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

let adminToken: string;
let opsToken: string;
let customerToken: string;

const runId = `${Date.now().toString().slice(-6)}${randomInt(100, 999)}`;
const as = (token: string) => ({ authorization: `Bearer ${token}` });

// Track IDs for safe cleanup
const userIds: string[] = [];
const catIds: string[] = [];
const svcIds: string[] = [];
const pkgIds: string[] = [];
const orderIds: string[] = [];
const itemIds: string[] = [];
const couponIds: string[] = [];
const redemptionIds: string[] = [];
const paymentIds: string[] = [];
const refundIds: string[] = [];
const applicationIds: string[] = [];

let testServiceId: string;
let testCategoryId: string;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
  await app.init();
  http = request(app.getHttpServer()) as unknown as ReturnType<typeof request>;
  prisma = app.get(PrismaService);

  // 1. Staff users
  adminToken = (await staffSession(http, prisma, 'ADMIN', `admin-rep-${runId}@example.com`)).accessToken;
  opsToken = (await staffSession(http, prisma, 'OPERATIONS', `ops-rep-${runId}@example.com`)).accessToken;

  // 2. Customer user
  const customerRes = await http.post('/api/auth/register').send({
    name: `Customer Rep ${runId}`,
    mobile: `9${runId.slice(0, 9).padEnd(9, '1')}`,
    email: `cust-rep-${runId}@example.com`,
    password: 'Password123!',
    consent: true,
  }).expect(201);
  customerToken = customerRes.body.accessToken;
  const customerId = customerRes.body.user.id;
  userIds.push(customerId);

  // 3. Isolated catalogue fixture
  const cat = await prisma.category.create({
    data: {
      name: `Report Cat ${runId}`,
      slug: `report-cat-${runId}`,
    },
  });
  catIds.push(cat.id);
  testCategoryId = cat.id;

  const svc = await prisma.service.create({
    data: {
      name: `Report Service ${runId}`,
      slug: `report-svc-${runId}`,
      categoryId: cat.id,
      shortDescription: 'Report testing service',
    },
  });
  svcIds.push(svc.id);
  testServiceId = svc.id;

  const pkg = await prisma.servicePackage.create({
    data: {
      name: 'Standard Package',
      serviceId: svc.id,
      professionalFee: 100000,
      governmentFee: 0,
      gstRate: 18,
    },
  });
  pkgIds.push(pkg.id);

  // 4. Coupon
  const coupon = await prisma.coupon.create({
    data: {
      code: `REP${runId}`,
      type: 'FIXED',
      value: 10000,
    },
  });
  couponIds.push(coupon.id);

  // 5. Order with coupon & item
  const order = await prisma.order.create({
    data: {
      code: `ORD-REP-${runId}`,
      customerId,
      subtotal: 100000,
      discount: 10000,
      total: 90000,
      amountPaid: 90000,
      status: 'PAID',
      couponId: coupon.id,
    },
  });
  orderIds.push(order.id);

  const item = await prisma.orderItem.create({
    data: {
      orderId: order.id,
      packageId: pkg.id,
      description: 'Standard',
      professionalFee: 100000,
      governmentFee: 0,
      discount: 10000,
      gstRate: 18,
    },
  });
  itemIds.push(item.id);

  const redemption = await prisma.couponRedemption.create({
    data: {
      couponId: coupon.id,
      orderId: order.id,
      userId: customerId,
      amount: 10000,
    },
  });
  redemptionIds.push(redemption.id);

  // 6. Successful payment with a refund
  const payment = await prisma.payment.create({
    data: {
      orderId: order.id,
      amount: 90000,
      status: 'SUCCESS',
      paidAt: new Date(),
      gateway: 'MOCK',
      gatewayOrderId: `gw_ord_${runId}`,
      gatewayPaymentId: `gw_pay_${runId}`,
    },
  });
  paymentIds.push(payment.id);

  const refund = await prisma.refund.create({
    data: {
      paymentId: payment.id,
      amount: 20000,
      reason: 'Customer requested discount refund',
      status: 'PROCESSED',
      initiatedById: customerId,
    },
  });
  refundIds.push(refund.id);

  // 7. Active application
  const appRow = await prisma.application.create({
    data: {
      code: `BN-REP-${runId}`,
      orderId: order.id,
      customerId,
      serviceId: svc.id,
      packageId: pkg.id,
      status: 'IN_PROGRESS',
    },
  });
  applicationIds.push(appRow.id);
});

afterAll(async () => {
  // Safe cleanup: delete strictly rows created by this test, in dependency order
  if (refundIds.length) await prisma.refund.deleteMany({ where: { id: { in: refundIds } } });
  if (paymentIds.length) await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
  if (redemptionIds.length) await prisma.couponRedemption.deleteMany({ where: { id: { in: redemptionIds } } });
  if (applicationIds.length) await prisma.application.deleteMany({ where: { id: { in: applicationIds } } });
  if (itemIds.length) await prisma.orderItem.deleteMany({ where: { id: { in: itemIds } } });
  if (orderIds.length) await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  if (couponIds.length) await prisma.coupon.deleteMany({ where: { id: { in: couponIds } } });
  if (pkgIds.length) await prisma.servicePackage.deleteMany({ where: { id: { in: pkgIds } } });
  if (svcIds.length) await prisma.service.deleteMany({ where: { id: { in: svcIds } } });
  if (catIds.length) await prisma.category.deleteMany({ where: { id: { in: catIds } } });
  if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });

  await app?.close();
});

describe('Reports API Endpoints (M10)', () => {
  describe('Authorization: reports.view permission enforced on every route', () => {
    it('GET /api/admin/reports/dashboard requires authentication (401)', () => {
      return http.get('/api/admin/reports/dashboard').expect(401);
    });

    it('GET /api/admin/reports/dashboard returns 403 for Customer (missing reports.view)', async () => {
      await http.get('/api/admin/reports/dashboard').set(as(customerToken)).expect(403);
    });

    it('GET /api/admin/reports/dashboard returns 403 for Operations staff (missing reports.view)', async () => {
      await http.get('/api/admin/reports/dashboard').set(as(opsToken)).expect(403);
    });

    it('GET /api/admin/reports/dashboard returns 200 for Admin (has reports.view)', async () => {
      await http.get('/api/admin/reports/dashboard').set(as(adminToken)).expect(200);
    });

    it('GET /api/admin/reports/sales returns 403 for Operations and 200 for Admin', async () => {
      await http.get('/api/admin/reports/sales').set(as(opsToken)).expect(403);
      await http.get('/api/admin/reports/sales').set(as(adminToken)).expect(200);
    });

    it('GET /api/admin/reports/customers returns 403 for Operations and 200 for Admin', async () => {
      await http.get('/api/admin/reports/customers').set(as(opsToken)).expect(403);
      await http.get('/api/admin/reports/customers').set(as(adminToken)).expect(200);
    });
  });

  describe('Scoped Fixture Assertions (Exact Numbers)', () => {
    it('Dashboard KPIs scoped to testServiceId return exact revenue, orders, active apps', async () => {
      const res = await http
        .get(`/api/admin/reports/dashboard?serviceId=${testServiceId}&preset=today`)
        .set(as(adminToken))
        .expect(200);

      expect(res.body.range).toBeDefined();
      // Revenue = 90000 - 20000 refund = 70000 paise
      expect(res.body.kpis.revenue).toBe(70000);
      expect(res.body.kpis.orders).toBe(1);
      expect(res.body.kpis.activeApplications).toBe(1);
      expect(Array.isArray(res.body.series)).toBe(true);
      expect(res.body.series.length).toBeGreaterThanOrEqual(1);
    });

    it('Sales Report scoped to testServiceId returns exact revenue, refund, discount, coupon impact', async () => {
      const res = await http
        .get(`/api/admin/reports/sales?serviceId=${testServiceId}&preset=today`)
        .set(as(adminToken))
        .expect(200);

      expect(res.body.total.revenue).toBe(70000);
      expect(res.body.total.orders).toBe(1);
      expect(res.body.total.refundTotal).toBe(20000);
      expect(res.body.total.discountTotal).toBe(10000);

      expect(res.body.couponImpact.discountGiven).toBe(10000);
      expect(res.body.couponImpact.ordersWithCoupon).toBe(1);
      expect(res.body.couponImpact.coupons).toEqual([
        {
          code: `REP${runId}`,
          type: 'FIXED',
          ordersCount: 1,
          discountGiven: 10000,
        },
      ]);

      const svcEntry = res.body.serviceWise.find((s: any) => s.serviceId === testServiceId);
      expect(svcEntry).toBeDefined();
      expect(svcEntry.revenue).toBe(70000);
      expect(svcEntry.orders).toBe(1);

      const catEntry = res.body.categoryWise.find((c: any) => c.categoryId === testCategoryId);
      expect(catEntry).toBeDefined();
      expect(catEntry.revenue).toBe(70000);
      expect(catEntry.orders).toBe(1);
    });

    it('Customers Report returns total customers count and new customers in range', async () => {
      const res = await http
        .get('/api/admin/reports/customers?preset=today')
        .set(as(adminToken))
        .expect(200);

      expect(res.body.total).toBeGreaterThanOrEqual(1);
      expect(res.body.newInRange).toBeGreaterThanOrEqual(1);
      expect(res.body.activeLast90Days).toBeGreaterThanOrEqual(1);
    });
  });
});
