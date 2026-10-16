import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { EventBus } from '../src/events/event-bus';
import { staffSession } from './staff';

const as = (token: string) => ({ authorization: `Bearer ${token}` });

describe('Reminders (e2e)', () => {
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;
  let prisma: PrismaService;
  const runStr = `${Date.now().toString(36)}${Math.floor(Math.random() * 1_000_000).toString(36)}`;
  const runNum = String(Math.floor(1_000_000 + Math.random() * 9_000_000));
  const prefix = `rem-${runStr}`;

  let userA: { id: string; token: string; name: string };
  let userB: { id: string; token: string; name: string };
  let admin: string;
  let customerIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    http = request(app.getHttpServer());
    prisma = app.get(PrismaService);

    admin = (await staffSession(http, prisma, 'ADMIN', `admin-${runStr}@example.com`)).accessToken;

    const resA = await http.post('/api/auth/register').send({
      name: `Customer A ${runStr}`,
      mobile: `8${runNum}10`,
      email: `custA-${runStr}@example.com`,
      password: 'secretPassword123!',
      consent: true,
    }).expect(201);
    userA = { id: resA.body.user.id, token: resA.body.accessToken, name: resA.body.user.name };

    const resB = await http.post('/api/auth/register').send({
      name: `Customer B ${runStr}`,
      mobile: `8${runNum}11`,
      email: `custB-${runStr}@example.com`,
      password: 'secretPassword123!',
      consent: true,
    }).expect(201);
    userB = { id: resB.body.user.id, token: resB.body.accessToken, name: resB.body.user.name };
    customerIds = [userA.id, userB.id];
  });

  afterAll(async () => {
    try {
      await prisma.application.deleteMany({ where: { code: { startsWith: prefix } } });
      await prisma.businessEntity.deleteMany({ where: { legalName: { startsWith: prefix } } });
      await prisma.reminder.deleteMany({ where: { userId: { in: customerIds } } });
      await prisma.servicePackage.deleteMany({ where: { service: { slug: { startsWith: prefix } } } });
      await prisma.service.deleteMany({ where: { slug: { startsWith: prefix } } });
      // Left-over categories with no services sorted first and broke the catalogue test.
      await prisma.category.deleteMany({ where: { slug: { startsWith: prefix } } });
      await prisma.storedFile.deleteMany({ where: { ownerId: { in: customerIds } } });
      await prisma.user.deleteMany({ where: { id: { in: customerIds } } });
      await prisma.user.deleteMany({ where: { email: `admin-${runStr}@example.com` } });
    } finally {
      await app.close();
    }
  });

  it('GET /api/reminders without token returns 401', async () => {
    await http.get('/api/reminders').expect(401);
  });

  it('completing application of recurring service creates renewal reminder, duplicate event does nothing', async () => {
    const category = await prisma.category.create({ data: { slug: `${prefix}-cat`, name: 'Cat' } });
    const service = await prisma.service.create({
      data: {
        slug: `${prefix}-rec-svc`,
        categoryId: category.id,
        name: 'Recurring Service',
        shortDescription: 'Desc',
        recurrence: 'MONTHLY',
        reminderOffsets: [30, 7],
      },
    });
    const packageId = await prisma.servicePackage.create({
      data: { serviceId: service.id, name: 'Pack', professionalFee: 1000 },
    });

    const entity = await prisma.businessEntity.create({
      data: { ownerId: userA.id, legalName: `${prefix} Entity A`, entityType: 'PRIVATE_LIMITED' }
    });

    const application = await prisma.application.create({
      data: {
        code: `${prefix}-REC`,
        customerId: userA.id,
        businessEntityId: entity.id,
        serviceId: service.id,
        packageId: packageId.id,
        status: 'IN_PROGRESS',
      },
    });

    const eventBus = app.get(EventBus);
    await eventBus.emit('application.status_changed', {
      applicationId: application.id,
      from: 'IN_PROGRESS',
      to: 'COMPLETED',
      actorId: null,
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const reminders1 = await prisma.reminder.findMany({
      where: { sourceApplicationId: application.id, type: 'SERVICE_RErenewal' },
    });
    const rem = await prisma.reminder.findMany({
      where: { sourceApplicationId: application.id },
    });

    expect(rem).toHaveLength(1);
    expect(rem[0].userId).toBe(userA.id);
    expect(rem[0].title).toBe('Recurring Service due again');
    expect(rem[0].offsets).toEqual([30, 7]);

    const diffDays = (rem[0].dueDate.getTime() - new Date().getTime()) / (1000 * 3600 * 24);
    expect(diffDays).toBeGreaterThan(27);
    expect(diffDays).toBeLessThan(32);

    await eventBus.emit('application.status_changed', {
      applicationId: application.id,
      from: 'IN_PROGRESS',
      to: 'COMPLETED',
      actorId: null,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const reminders2 = await prisma.reminder.findMany({
      where: { sourceApplicationId: application.id, type: 'SERVICE_RENEWAL' },
    });
    expect(reminders2).toHaveLength(1); // Still 1
  });

  it('completing application of non-recurring service creates no reminder', async () => {
    const service = await prisma.service.create({
      data: {
        slug: `${prefix}-non-rec-svc`,
        categoryId: (await prisma.category.findFirst({}))!.id,
        name: 'Non-Recurring Service',
        shortDescription: 'Desc',
        recurrence: null,
      },
    });
    const packageId = await prisma.servicePackage.create({
      data: { serviceId: service.id, name: 'Pack', professionalFee: 1000 },
    });

    const application = await prisma.application.create({
      data: {
        code: `${prefix}-NONREC`,
        customerId: userA.id,
        serviceId: service.id,
        packageId: packageId.id,
        status: 'IN_PROGRESS',
      },
    });

    const eventBus = app.get(EventBus);
    await eventBus.emit('application.status_changed', {
      applicationId: application.id,
      from: 'IN_PROGRESS',
      to: 'COMPLETED',
      actorId: null,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const reminders = await prisma.reminder.findMany({
      where: { sourceApplicationId: application.id },
    });
    expect(reminders).toHaveLength(0);
  });

  it('issuing a certificate from an application creates one reminder with correct dueDate/offsets, duplicate event still one', async () => {
    const service = await prisma.service.create({
      data: {
        slug: `${prefix}-cert-svc`,
        categoryId: (await prisma.category.findFirst({}))!.id,
        name: 'Cert Service',
        shortDescription: 'Desc',
        reminderOffsets: [10, 5],
      },
    });
    const packageId = await prisma.servicePackage.create({
      data: { serviceId: service.id, name: 'Pack', professionalFee: 1000 },
    });

    const application = await prisma.application.create({
      data: {
        code: `${prefix}-CERT`,
        customerId: userA.id,
        serviceId: service.id,
        packageId: packageId.id,
        status: 'COMPLETED',
      },
    });

    const certBody = await prisma.certificationBody.create({
      data: { name: `${prefix} Body` },
    });

    const certificate = await prisma.certificate.create({
      data: {
        applicationId: application.id,
        certificateNumber: `${prefix}-123`,
        verificationId: `${prefix}-v-123`,
        type: 'ISO 9001',
        status: 'ACTIVE',
        organizationName: 'Org',
        certificationBodyId: certBody.id,
        issueDate: new Date(),
        validFrom: new Date(),
        validUntil: new Date(Date.now() + 365 * 24 * 3600 * 1000), // 1 year
      },
    });

    const eventBus = app.get(EventBus);
    await eventBus.emit('certificate.issued', {
      certificateId: certificate.id,
      certificateNumber: certificate.certificateNumber,
      status: 'ACTIVE',
      actorId: admin,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const reminders1 = await prisma.reminder.findMany({
      where: { sourceApplicationId: application.id, type: 'CERTIFICATE_EXPIRY' },
    });

    expect(reminders1).toHaveLength(1);
    expect(reminders1[0].userId).toBe(userA.id);
    expect(reminders1[0].title).toContain(`${prefix}-123`);
    expect(reminders1[0].offsets).toEqual([10, 5]);

    // Duplicate event
    await eventBus.emit('certificate.issued', {
      certificateId: certificate.id,
      certificateNumber: certificate.certificateNumber,
      status: 'ACTIVE',
      actorId: admin,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const reminders2 = await prisma.reminder.findMany({
      where: { sourceApplicationId: application.id, type: 'CERTIFICATE_EXPIRY' },
    });
    expect(reminders2).toHaveLength(1); // Still 1
  });

  it('GET /api/reminders shows only own scheduled reminders, soonest first, other customer sees none', async () => {
    const resA = await http.get('/api/reminders').set(as(userA.token)).expect(200);
    expect(resA.body.items.length).toBeGreaterThanOrEqual(2);

    // check ordering soonest first
    for (let i = 0; i < resA.body.items.length - 1; i++) {
      const d1 = new Date(resA.body.items[i].dueDate).getTime();
      const d2 = new Date(resA.body.items[i+1].dueDate).getTime();
      expect(d1).toBeLessThanOrEqual(d2);
    }

    const resB = await http.get('/api/reminders').set(as(userB.token)).expect(200);
    expect(resB.body.items.length).toBe(0);
  });
});
