import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { staffSession } from './staff';

describe('Admin announcements (e2e)', () => {
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;
  let prisma: PrismaService;
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const adminEmail = `announce-admin-${stamp}@example.com`;
  const opsEmail = `announce-ops-${stamp}@example.com`;
  const customerEmails = [`announce-in-${stamp}@example.com`, `announce-out-${stamp}@example.com`];
  let admin: string;
  let ops: string;
  let optedInId: string;
  let optedOutId: string;
  let categoryId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
    await app.init(); http = request(app.getHttpServer()); prisma = app.get(PrismaService);
    admin = (await staffSession(http, prisma, 'ADMIN', adminEmail)).accessToken;
    ops = (await staffSession(http, prisma, 'OPERATIONS', opsEmail)).accessToken;
    const register = async (email: string, n: number) => (await http.post('/api/auth/register').send({ name: 'Announcement Customer', email, mobile: `7${stamp.slice(-8)}${n}`, password: 'secretPassword123!', consent: true }).expect(201)).body.user.id as string;
    optedInId = await register(customerEmails[0], 1);
    optedOutId = await register(customerEmails[1], 2);
    await prisma.user.update({ where: { id: optedOutId }, data: { notificationPrefs: { marketingOptOut: true, channelPreferences: {} } } });

    // An inactive category of its own, so the segment holds only these two customers (sending to ALL_CUSTOMERS would notify every test user).
    const category = await prisma.category.create({ data: { slug: `announce-${stamp}`, name: `Announce ${stamp}`, isActive: false } });
    categoryId = category.id;
    const service = await prisma.service.create({ data: { name: `Announce ${stamp}`, slug: `announce-${stamp}`, categoryId, shortDescription: 'test' } });
    const pkg = await prisma.servicePackage.create({ data: { serviceId: service.id, name: 'Basic', professionalFee: 1000 } });
    for (const [n, customerId] of [optedInId, optedOutId].entries()) {
      await prisma.application.create({ data: { code: `ANN-${stamp}-${n}`, customerId, serviceId: service.id, packageId: pkg.id, status: 'SUBMITTED' } });
    }
  });
  afterAll(async () => {
    if (prisma) {
      await prisma.application.deleteMany({ where: { code: { startsWith: `ANN-${stamp}-` } } });
      await prisma.service.deleteMany({ where: { slug: `announce-${stamp}` } });
      await prisma.category.deleteMany({ where: { slug: `announce-${stamp}` } });
      await prisma.user.deleteMany({ where: { email: { in: [adminEmail, opsEmail, ...customerEmails] } } });
    }
    await app?.close();
  });

  it('counts and queues only opted-in customers in the segment, checks permission and audits the send', async () => {
    const segment = { type: 'ACTIVE_APPLICATION_CATEGORY', categoryId };
    const count = await http.post('/api/admin/notifications/announcements/count').set({ authorization: `Bearer ${admin}` }).send({ segment }).expect(201);
    expect(count.body.recipients).toBe(1);
    await http.post('/api/admin/notifications/announcements').set({ authorization: `Bearer ${ops}` }).send({ title: 'Test', body: 'Test announcement', channels: ['IN_APP'], segment }).expect(403);
    await http.post('/api/admin/notifications/announcements').set({ authorization: `Bearer ${admin}` }).send({ title: 'Test', body: 'Test', channels: ['SMS'], segment }).expect(400);

    const sent = await http.post('/api/admin/notifications/announcements').set({ authorization: `Bearer ${admin}` }).send({ title: 'Test announcement', body: 'Test body', channels: ['IN_APP'], segment }).expect(201);
    expect(sent.body).toMatchObject({ recipients: 1, queued: 1 });
    const rows = await prisma.notificationDelivery.findMany({ where: { sourceKey: sent.body.sourceKey } });
    expect(rows.map((r) => [r.userId, r.category, r.channel])).toEqual([[optedInId, 'MARKETING', 'IN_APP']]);

    const adminId = (await prisma.user.findUniqueOrThrow({ where: { email: adminEmail } })).id;
    const audit = await prisma.auditLog.findFirst({ where: { actorId: adminId, action: 'notification.announcement.send', entityId: sent.body.sourceKey } });
    expect(audit?.after).toMatchObject({ title: 'Test announcement', recipients: 1, queued: 1 });
  });
});
