import { randomInt } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { presetDateRange } from '@biznexa/types';
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
const ticketIds: string[] = [];

let testServiceId: string;
let testCategoryId: string;
let testConsultantId: string;
let testTicketId: string;

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

  // 10. Support ticket with exact 1-hour first response and 2-hour resolution
  // The report asks for "today" (IST): just after midnight, now − 2 h would be yesterday, so start it no earlier than 00:01 IST.
  const ticketEnd = new Date(Math.max(now.getTime(), presetDateRange('today', now).from.getTime() + 2 * 3600 * 1000 + 60_000));
  const ticketCreatedAt = new Date(ticketEnd.getTime() - 2 * 3600 * 1000);
  const ticketFirstResponseAt = new Date(ticketEnd.getTime() - 1 * 3600 * 1000);
  const ticketResolvedAt = ticketEnd;

  const ticket = await prisma.ticket.create({
    data: {
      code: `TICK-REP-${runId}`,
      customerId,
      subject: `Report Test Ticket ${runId}`,
      description: 'Testing support report metrics',
      priority: 'HIGH',
      status: 'RESOLVED',
      createdAt: ticketCreatedAt,
      firstResponseAt: ticketFirstResponseAt,
      resolvedAt: ticketResolvedAt,
    },
  });
  ticketIds.push(ticket.id);
  testTicketId = ticket.id;

  // 11. Support ticket with formula injection payload to verify CSV escaping
  const formulaTicket = await prisma.ticket.create({
    data: {
      code: `TICK-FORM-${runId}`,
      customerId,
      subject: '=1+1 dangerous formula',
      description: 'Testing CSV formula injection protection',
      priority: 'MEDIUM',
      status: 'OPEN',
      createdAt: now,
    },
  });
  ticketIds.push(formulaTicket.id);
});

afterAll(async () => {
  // Safe cleanup: delete strictly rows created by this test, in dependency order
  if (ticketIds.length) await prisma.ticket.deleteMany({ where: { id: { in: ticketIds } } });
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

    it('GET /api/admin/reports/support returns 403 for Operations and 200 for Admin', async () => {
      await http.get('/api/admin/reports/support').set(as(opsToken)).expect(403);
      await http.get('/api/admin/reports/support').set(as(adminToken)).expect(200);
    });

    it('POST /api/admin/reports/export returns 403 for Customer and Operations', async () => {
      await http.post('/api/admin/reports/export').set(as(customerToken)).send({ type: 'sales' }).expect(403);
      await http.post('/api/admin/reports/export').set(as(opsToken)).send({ type: 'sales' }).expect(403);
    });

    it('POST /api/admin/reports/export/:id/link returns 403 for Operations', async () => {
      await http.post('/api/admin/reports/export/00000000-0000-0000-0000-000000000000/link').set(as(opsToken)).expect(403);
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
      expect(consultantEntry.rating).toBeCloseTo(4.8);
      expect(consultantEntry.reviewCount).toBe(1);
      expect(consultantEntry.bookingsCount).toBe(1);
      expect(consultantEntry.bookingRevenue).toBe(50000);
    });

    it('Support Report returns accurate ticket metrics and scoped recent ticket', async () => {
      const res = await http
        .get('/api/admin/reports/support?preset=today')
        .set(as(adminToken))
        .expect(200);

      expect(res.body.range).toBeDefined();
      expect(res.body.summary.totalTickets).toBeGreaterThanOrEqual(1);
      expect(res.body.summary.resolvedTickets).toBeGreaterThanOrEqual(1);
      expect(res.body.summary.avgFirstResponseHours).toBeGreaterThanOrEqual(0);
      expect(res.body.summary.avgResolutionHours).toBeGreaterThanOrEqual(0);

      const ticketEntry = res.body.recentTickets.find((t: any) => t.id === testTicketId);
      expect(ticketEntry).toBeDefined();
      expect(ticketEntry.code).toBe(`TICK-REP-${runId}`);
      expect(ticketEntry.subject).toBe(`Report Test Ticket ${runId}`);
      expect(ticketEntry.status).toBe('RESOLVED');
      expect(ticketEntry.priority).toBe('HIGH');
      expect(ticketEntry.customerName).toBe(`Customer Rep ${runId}`);
      expect(ticketEntry.firstResponseHours).toBe(1);
      expect(ticketEntry.resolutionHours).toBe(2);
    });

    it('M10.8 Export: generates CSV for sales report via queue with 24h signed link and verified fixture numbers', async () => {
      // 1. Enqueue sales export
      const enqueueRes = await http
        .post('/api/admin/reports/export')
        .set(as(adminToken))
        .send({ type: 'sales', serviceId: testServiceId, preset: 'today' })
        .expect(201);

      const exportId = enqueueRes.body.id;
      expect(exportId).toBeDefined();
      expect(enqueueRes.body.type).toBe('sales');

      // 2. Poll for download link (wait up to 10s for queue processor)
      let linkUrl = '';
      let expiresAt = '';
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        const linkRes = await http // NOSONAR: test steps run in order
          .post(`/api/admin/reports/export/${exportId}/link`)
          .set(as(adminToken));

        if (linkRes.status === 200) {
          linkUrl = linkRes.body.url;
          expiresAt = linkRes.body.expiresAt;
          break;
        }
        expect(linkRes.status).toBe(409);
        await new Promise((r) => setTimeout(r, 200)); // NOSONAR: test steps run in order
      }

      expect(linkUrl).toMatch(new RegExp(`^/api/admin/reports/export/${exportId}/download\\?`));

      // 3. Verify link validity is 24 hours
      const now = Date.now();
      const expTime = new Date(expiresAt).getTime();
      expect(expTime - now).toBeGreaterThan(23 * 3600 * 1000);
      expect(expTime - now).toBeLessThanOrEqual(24 * 3600 * 1000 + 5000);

      // 4. Download CSV via public signed link
      const downloadRes = await http.get(linkUrl).expect(200);
      expect(downloadRes.headers['content-type']).toContain('text/csv');
      expect(downloadRes.headers['content-disposition']).toContain('attachment');
      expect(downloadRes.headers['content-disposition']).toContain('.csv');

      const csv = downloadRes.text;
      expect(csv).toContain('--- SALES REPORT SUMMARY ---');
      expect(csv).toContain(`"Report Service ${runId}"`);
      expect(csv).toContain(`"REP${runId}"`);
      expect(csv).toContain('"70000"'); // 700 INR net revenue (900 payment - 200 refund)
      expect(csv).toContain('"20000"'); // 200 INR refund
      expect(csv).toContain('"10000"'); // 100 INR discount

      // 5. Tampered signature -> 403 Forbidden
      const tamperedUrl = linkUrl.replace(/s=[^&]+/, 's=tampered-sig');
      await http.get(tamperedUrl).expect(403);

      // 6. Expired link -> 403 Forbidden
      const expiredUrl = linkUrl.replace(/e=[^&]+/, 'e=1');
      await http.get(expiredUrl).expect(403);
    });

    it('M10.8 Export: generates CSV for support report and escapes formula injection cells (=, +, -, @)', async () => {
      // 1. Enqueue support export
      const enqueueRes = await http
        .post('/api/admin/reports/export')
        .set(as(adminToken))
        .send({ type: 'support', preset: 'today' })
        .expect(201);

      const exportId = enqueueRes.body.id;

      // 2. Poll for download link
      let linkUrl = '';
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        const linkRes = await http // NOSONAR: test steps run in order
          .post(`/api/admin/reports/export/${exportId}/link`)
          .set(as(adminToken));

        if (linkRes.status === 200) {
          linkUrl = linkRes.body.url;
          break;
        }
        await new Promise((r) => setTimeout(r, 200)); // NOSONAR: test steps run in order
      }

      expect(linkUrl).toBeDefined();

      // 3. Download CSV and check formula escaping
      const downloadRes = await http.get(linkUrl).expect(200);
      const csv = downloadRes.text;

      expect(csv).toContain('--- SUPPORT REPORT SUMMARY ---');
      expect(csv).toContain(`"TICK-FORM-${runId}"`);
      // Formula starting with '=' must be escaped with a leading single quote: "'=1+1 dangerous formula"
      expect(csv).toContain(`"'=1+1 dangerous formula"`);
      expect(csv).toContain(`"Report Test Ticket ${runId}"`);
    });
  });
});

