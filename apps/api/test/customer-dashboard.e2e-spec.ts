import { randomBytes } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { dashboardSummarySchema, formatApplicationCode, formatOrderCode } from '@biznexa/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Customer dashboard API (M5.2)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const runId = randomBytes(4).toString('hex');
  const suffix = String((parseInt(runId, 16) % 800000000) + 100000000);
  const userIds: string[] = [];
  const orderIds: string[] = [];
  const applicationIds: string[] = [];
  const certificateIds: string[] = [];
  const serviceIds: string[] = [];
  let aliceToken: string;
  let bobToken: string;
  let newCustomerToken: string;
  let aliceApplicationId: string;
  let aliceCode: string;

  async function register(name: string, tag: string, mobilePrefix: string) {
    const response = await request(app.getHttpServer()).post('/api/auth/register').send({
      name: `${name} ${runId}`,
      mobile: `${mobilePrefix}${suffix.slice(1, 9)}`,
      email: `${tag}-${runId}@example.com`,
      password: 'Password123!',
      consent: true,
    }).expect(201);
    userIds.push(response.body.user.id as string);
    return { id: response.body.user.id as string, token: response.body.accessToken as string };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
    await app.init();
    prisma = app.get(PrismaService);

    const alice = await register('Alice', 'alice-dashboard', '61');
    const bob = await register('Bob', 'bob-dashboard', '62');
    const newCustomer = await register('New', 'new-dashboard', '63');
    aliceToken = alice.token;
    bobToken = bob.token;
    newCustomerToken = newCustomer.token;

    const category = await prisma.category.findUniqueOrThrow({ where: { slug: 'licenses' } });
    const service = await prisma.service.create({
      data: {
        slug: `e2e-dashboard-${runId}`,
        categoryId: category.id,
        name: `Dashboard Service ${runId}`,
        shortDescription: 'Dashboard integration test service.',
        packages: { create: [{ name: 'Standard', professionalFee: 100000 }] },
        documents: { create: [{ name: 'PAN Card', isMandatory: true, sortOrder: 1 }] },
        stages: { create: [{ name: 'Review', sortOrder: 1 }] },
        formSchemas: { create: [{ version: 1, schema: { steps: [] }, isCurrent: true }] },
      },
      select: { id: true, documents: { select: { id: true } } },
    });
    serviceIds.push(service.id);

    const body = await prisma.certificationBody.create({ data: { name: `Dashboard Body ${runId}` } });
    const baseSeq = (parseInt(runId, 16) % 800000) + 100000;

    async function makeApp(customerId: string, offset: number, total: number, amountPaid: number) {
      const order = await prisma.order.create({ data: {
        code: formatOrderCode(baseSeq + offset), customerId, subtotal: total, total, amountPaid,
        status: amountPaid >= total ? 'PAID' : amountPaid > 0 ? 'PARTIALLY_PAID' : 'CREATED',
      } });
      orderIds.push(order.id);
      const application = await prisma.application.create({ data: {
        code: formatApplicationCode(baseSeq + offset), orderId: order.id, customerId,
        serviceId: service.id,
        packageId: (await prisma.servicePackage.findFirstOrThrow({ where: { serviceId: service.id }, select: { id: true } })).id,
        formSchemaVersion: 1, status: 'SUBMITTED',
      } });
      applicationIds.push(application.id);
      return application;
    }

    const aliceApplication = await makeApp(alice.id, 1, 118000, 59000);
    aliceApplicationId = aliceApplication.id;
    aliceCode = aliceApplication.code;
    await prisma.applicationStageHistory.createMany({ data: [
      { applicationId: aliceApplication.id, status: 'SUBMITTED', note: 'Visible update', visibleToCustomer: true },
      { applicationId: aliceApplication.id, status: 'IN_PROGRESS', note: 'Hidden update', visibleToCustomer: false },
    ] });
    const bobApplication = await makeApp(bob.id, 2, 55000, 0);
    await prisma.applicationStageHistory.create({
      data: { applicationId: bobApplication.id, status: 'SUBMITTED', note: 'Bob update', visibleToCustomer: true },
    });
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await prisma.certificate.create({ data: {
      certificateNumber: `CERT-${runId}`,
      verificationId: `verify-${runId}`,
      type: 'ISO 9001', organizationName: 'Alice Company', issueDate: new Date(), validFrom: new Date(),
      validUntil: future, certificationBodyId: body.id, applicationId: aliceApplication.id,
    }, select: { id: true } }).then((certificate) => certificateIds.push(certificate.id));

  });

  afterAll(async () => {
    try {
      if (prisma) {
        await prisma.applicationStageHistory.deleteMany({ where: { applicationId: { in: applicationIds } } });
        await prisma.certificate.deleteMany({ where: { id: { in: certificateIds } } });
        await prisma.applicationDocument.deleteMany({ where: { applicationId: { in: applicationIds } } });
        await prisma.application.deleteMany({ where: { id: { in: applicationIds } } });
        await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
        await prisma.service.deleteMany({ where: { id: { in: serviceIds } } });
        await prisma.certificationBody.deleteMany({ where: { name: `Dashboard Body ${runId}` } });
        await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      }
    } finally {
      if (app) await app.close();
    }
  });

  it('requires a signed-in customer', async () => {
    await request(app.getHttpServer()).get('/api/dashboard/summary').expect(401);
  });

  it('returns the customer summary and excludes other customers and hidden history', async () => {
    const response = await request(app.getHttpServer()).get('/api/dashboard/summary')
      .set('Authorization', `Bearer ${aliceToken}`).expect(200);
    const summary = dashboardSummarySchema.parse(response.body);
    expect(summary.activeApplications).toBe(1);
    expect(summary.pendingActions).toBe(2); // missing mandatory document + one unpaid order
    expect(summary.unpaidBalance).toBe(59000);
    expect(summary.upcomingDueDates).toHaveLength(1);
    expect(summary.upcomingDueDates[0].number).toBe(`CERT-${runId}`);
    expect(summary.recentActivity).toHaveLength(1);
    expect(summary.recentActivity[0]).toMatchObject({ applicationId: aliceApplicationId, applicationCode: aliceCode });
    expect(JSON.stringify(summary)).not.toContain('Bob');
    expect(JSON.stringify(summary)).not.toContain('Hidden update');
  });

  it('returns zero counts and empty lists for a new customer', async () => {
    const summary = dashboardSummarySchema.parse(await request(app.getHttpServer()).get('/api/dashboard/summary')
      .set('Authorization', `Bearer ${newCustomerToken}`).expect(200).then((res) => res.body));
    expect(summary).toEqual({ activeApplications: 0, pendingActions: 0, unpaidBalance: 0, upcomingDueDates: [], recentActivity: [] });
  });
});
