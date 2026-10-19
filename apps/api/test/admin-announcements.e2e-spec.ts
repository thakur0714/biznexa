import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { NotificationQueueService } from '../src/notifications/delivery/notification-queue.service';
import { staffSession } from './staff';

describe('Admin announcements (e2e)', () => {
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;
  let prisma: PrismaService;
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const adminEmail = `announce-admin-${stamp}@example.com`;
  const opsEmail = `announce-ops-${stamp}@example.com`;
  let admin: string;
  let ops: string;
  let customerId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
    await app.init(); http = request(app.getHttpServer()); prisma = app.get(PrismaService);
    admin = (await staffSession(http, prisma, 'ADMIN', adminEmail)).accessToken;
    ops = (await staffSession(http, prisma, 'OPERATIONS', opsEmail)).accessToken;
    const customer = await http.post('/api/auth/register').send({ name: 'Announcement Customer', email: `announce-customer-${stamp}@example.com`, mobile: `7${String(stamp).slice(-9)}`, password: 'secretPassword123!', consent: true }).expect(201);
    customerId = customer.body.user.id;
    await prisma.user.update({ where: { id: customerId }, data: { notificationPrefs: { marketingOptOut: true, channelPreferences: {} } } });
  });
  afterAll(async () => {
    if (customerId) await prisma.notificationDelivery.deleteMany({ where: { sourceKey: { startsWith: 'announcement-test-' } } });
    await prisma.user.deleteMany({ where: { email: { in: [adminEmail, opsEmail, `announce-customer-${stamp}@example.com`] } } });
    await app?.close();
  });

  it('counts eligible customers, queues an opted-out customer for worker suppression, checks permission and audits the send', async () => {
    const segment = { type: 'ALL_CUSTOMERS' };
    const count = await http.post('/api/admin/notifications/announcements/count').set({ authorization: `Bearer ${admin}` }).send({ segment }).expect(201);
    expect(count.body.recipients).toBeGreaterThanOrEqual(0);
    await http.post('/api/admin/notifications/announcements').set({ authorization: `Bearer ${ops}` }).send({ title: 'Test', body: 'Test announcement', channels: ['IN_APP'], segment }).expect(403);
    const sent = await http.post('/api/admin/notifications/announcements').set({ authorization: `Bearer ${admin}` }).send({ title: 'Test announcement', body: 'Test body', channels: ['IN_APP'], segment }).expect(201);
    expect(sent.body.queued).toBeGreaterThanOrEqual(1);
    const row = await prisma.notificationDelivery.findFirstOrThrow({ where: { sourceKey: sent.body.sourceKey, userId: customerId, channel: 'IN_APP' } });
    expect(row.category).toBe('MARKETING');
    const status = await app.get(NotificationQueueService).deliver({ data: { deliveryId: row.id }, attemptsMade: 0, opts: { attempts: 1 } } as never);
    expect(status).toBe('SKIPPED');
    const audit = await prisma.auditLog.findFirst({ where: { actorId: (await prisma.user.findUniqueOrThrow({ where: { email: adminEmail } })).id, action: 'notification.announcement.send', entityId: sent.body.sourceKey } });
    expect(audit).not.toBeNull();
    expect(audit?.after).toMatchObject({ title: 'Test announcement', recipients: expect.any(Number) });
  });
});
