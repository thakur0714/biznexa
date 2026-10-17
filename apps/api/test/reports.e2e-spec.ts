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
const consultantIds: string[] = [];
const bookingIds: string[] = [];

let testServiceId: string;
let testCategoryId: string;
let testConsultantId: string;

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

  // 7. Active application with SLA breach
  const appRow = await prisma.application.create({
    data: {
      code: `BN-REP-${runId}`,
      orderId: order.id,
      customerId,
      serviceId: svc.id,
      packageId: pkg.id,
      status: 'IN_PROGRESS',
      slaDueAt: new Date(Date.now() - 3600 * 1000), // overdue by 1 hour -> breach
    },
  });
  applicationIds.push(appRow.id);

  // 8. Completed application with exact 2-day turnaround
  const now = new Date();
  const twoDaysAgo = new Date(now.getTime() - 2 * 86400 * 1000);
  const completedApp = await prisma.application.create({
    data: {
      code: `BN-COMP-${runId}`,
      customerId,
      serviceId: svc.id,
      packageId: pkg.id,
      status: 'COMPLETED',
      submittedAt: twoDaysAgo,
      completedAt: now,
    },
  });
  applicationIds.push(completedApp.id);

  // 9. Consultant user, consultant profile, booking, and payment
  const consultantUser = await prisma.user.create({
    data: {
      name: `Consultant Rep ${runId}`,
      email: `consultant-rep-${runId}@example.com`,
      mobile: `8${randomInt(100000000, 999999999)}`,
      passwordHash: 'dummy-hash',
    },
  });
  userIds.push(consultantUser.id);

  const consultant = await prisma.consultant.create({
    data: {
      userId: consultantUser.id,
      slug: `report-consultant-${runId}`,
      category: 'CA',
      qualification: 'Chartered Accountant',
      experienceYears: 10,
      expertise: ['GST', 'Income Tax'],
      languages: ['English', 'Hindi'],
      city: 'Delhi',
      state: 'Delhi',
      feePerSession: 50000,
      consultationTypes: ['VIDEO'],
      verificationStatus: 'APPROVED',
      rating: 4.8,
      reviewCount: 1,
    },
  });
  consultantIds.push(consultant.id);
  testConsultantId = consultant.id;

  const booking = await prisma.booking.create({
    data: {
      code: `BK-REP-${runId}`,
      customerId,
      consultantId: consultant.id,
      type: 'VIDEO',
      startAt: new Date(),
      endAt: new Date(Date.now() + 1800 * 1000),
      fee: 50000,
      status: 'CONFIRMED',
    },
  });
  bookingIds.push(booking.id);

  const bookingPayment = await prisma.payment.create({
    data: {
      bookingId: booking.id,
      amount: 50000,
      status: 'SUCCESS',
      paidAt: new Date(),
      gateway: 'MOCK',
      gatewayOrderId: `gw_b_ord_${runId}`,
      gatewayPaymentId: `gw_b_pay_${runId}`,
    },
  });
  paymentIds.push(bookingPayment.id);
});

afterAll(async () => {
  // Safe cleanup: delete strictly rows created by this test, in dependency order
  if (refundIds.length) await prisma.refund.deleteMany({ where: { id: { in: refundIds } } });
  if (paymentIds.length) await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
  if (bookingIds.length) await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
  if (consultantIds.length) await prisma.consultant.deleteMany({ where: { id: { in: consultantIds } } });
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

    it('GET /api/admin/reports/services returns 403 for Operations and 200 for Admin', async () => {
      await http.get('/api/admin/reports/services').set(as(opsToken)).expect(403);
      await http.get('/api/admin/reports/services').set(as(adminToken)).expect(200);
    });

    it('GET /api/admin/reports/consultants returns 403 for Operations and 200 for Admin', async () => {
      await http.get('/api/admin/reports/consultants').set(as(opsToken)).expect(403);
      await http.get('/api/admin/reports/consultants').set(as(adminToken)).expect(200);
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

    it('Services Report scoped to testServiceId returns exact popular services, turnaround, and breaches', async () => {
      const res = await http
        .get(`/api/admin/reports/services?serviceId=${testServiceId}&preset=today`)
        .set(as(adminToken))
        .expect(200);

      expect(res.body.range).toBeDefined();
      expect(res.body.summary.totalOrders).toBe(1);
      expect(res.body.summary.totalRevenue).toBe(70000);
      expect(res.body.summary.avgTurnaroundDays).toBe(2);
      expect(res.body.summary.totalSlaBreaches).toBe(1);

      expect(res.body.popularServices).toHaveLength(1);
      expect(res.body.popularServices[0]).toEqual({
        serviceId: testServiceId,
        serviceName: `Report Service ${runId}`,
        categoryName: `Report Cat ${runId}`,
        orders: 1,
        revenue: 70000,
        avgTurnaroundDays: 2,
        slaBreaches: 1,
      });

      const inProg = res.body.applicationsByStatus.find((s: any) => s.status === 'IN_PROGRESS');
      expect(inProg).toBeDefined();
      expect(inProg.count).toBe(1);

      const comp = res.body.applicationsByStatus.find((s: any) => s.status === 'COMPLETED');
      expect(comp).toBeDefined();
      expect(comp.count).toBe(1);

      expect(res.body.slaBreaches).toEqual([
        {
          serviceId: testServiceId,
          serviceName: `Report Service ${runId}`,
          categoryName: `Report Cat ${runId}`,
          breachCount: 1,
        },
      ]);
    });

    it('Consultants Report returns accurate consultant metrics and scoped consultant breakdown', async () => {
      const res = await http
        .get('/api/admin/reports/consultants?preset=today')
        .set(as(adminToken))
        .expect(200);

      expect(res.body.range).toBeDefined();
      expect(res.body.summary.total).toBeGreaterThanOrEqual(1);
      expect(res.body.summary.active).toBeGreaterThanOrEqual(1);
      expect(res.body.summary.bookingsCount).toBeGreaterThanOrEqual(1);
      expect(res.body.summary.bookingRevenue).toBeGreaterThanOrEqual(50000);
      expect(res.body.summary.averageRating).toBeGreaterThanOrEqual(1);

      const consultantEntry = res.body.consultants.find((c: any) => c.consultantId === testConsultantId);
      expect(consultantEntry).toBeDefined();
      expect(consultantEntry.name).toBe(`Consultant Rep ${runId}`);
      expect(consultantEntry.slug).toBe(`report-consultant-${runId}`);
      expect(consultantEntry.category).toBe('CA');
      expect(consultantEntry.verificationStatus).toBe('APPROVED');
      expect(consultantEntry.rating).toBe(4.8);
      expect(consultantEntry.reviewCount).toBe(1);
      expect(consultantEntry.bookingsCount).toBe(1);
      expect(consultantEntry.bookingRevenue).toBe(50000);
    });
  });
});

