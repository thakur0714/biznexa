import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import {
  messageSchema,
  messageThreadPageSchema,
  messageUnreadCountSchema,
  type DomainEvent,
} from '@biznexa/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { EventBus } from '../src/events/event-bus';
import { staffSession } from './staff';

describe('MessagesController (e2e, M4.11)', () => {
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;
  let prisma: PrismaService;
  let jwt: JwtService;
  let events: EventBus;

  const run = `${Date.now().toString().slice(-7)}${Math.floor(Math.random() * 90 + 10)}`;
  const email = (who: string) => `e2e-msg-${run}-${who}@example.com`;

  let adminToken = '';
  let assignedOpsToken = '';
  let unassignedOpsToken = '';
  let supportToken = '';
  let customer1Token = '';
  let customer2Token = '';

  let assignedOpsId = '';
  let customer1Id = '';
  let customer2Id = '';
  let categoryId = '';
  let serviceId = '';
  let packageId = '';
  let app1Id = '';
  let app2Id = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
    await app.init();
    http = request(app.getHttpServer());
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    events = app.get(EventBus);

    adminToken = (await staffSession(http, prisma, 'ADMIN', email('admin'))).accessToken;
    assignedOpsToken = (await staffSession(http, prisma, 'OPERATIONS', email('ops1'))).accessToken;
    unassignedOpsToken = (await staffSession(http, prisma, 'OPERATIONS', email('ops2'))).accessToken;
    supportToken = (await staffSession(http, prisma, 'SUPPORT', email('support'))).accessToken;

    const ops1User = await prisma.user.findUniqueOrThrow({ where: { email: email('ops1') } });
    assignedOpsId = ops1User.id;

    const c1 = await prisma.user.create({
      data: { name: `Customer One ${run}`, email: email('c1'), consentAt: new Date() },
    });
    const c2 = await prisma.user.create({
      data: { name: `Customer Two ${run}`, email: email('c2'), consentAt: new Date() },
    });
    customer1Id = c1.id;
    customer2Id = c2.id;

    customer1Token = jwt.sign({ sub: customer1Id, roles: ['CUSTOMER'], perms: [], typ: 'access', tfa: 'verified' });
    customer2Token = jwt.sign({ sub: customer2Id, roles: ['CUSTOMER'], perms: [], typ: 'access', tfa: 'verified' });

    const cat = await prisma.category.create({
      data: { name: `Msg Cat ${run}`, slug: `msg-cat-${run}` },
    });
    categoryId = cat.id;

    const svc = await prisma.service.create({
      data: {
        slug: `msg-svc-${run}`,
        categoryId,
        name: `Msg Service ${run}`,
        shortDescription: 'Messaging test service',
        sacCode: '998231',
        packages: {
          create: [{ name: 'Basic', professionalFee: 100000, governmentFee: 0, gstRate: 18, sortOrder: 0 }],
        },
        formSchemas: {
          create: [{ version: 1, schema: {}, isCurrent: true }],
        },
      },
      include: { packages: true },
    });
    serviceId = svc.id;
    packageId = svc.packages[0].id;

    const a1 = await prisma.application.create({
      data: {
        code: `BNM${run}1`,
        status: 'IN_PROGRESS',
        serviceId,
        packageId,
        formSchemaVersion: 1,
        formData: {},
        customerId: customer1Id,
        assignedToId: assignedOpsId,
      },
    });
    app1Id = a1.id;

    const a2 = await prisma.application.create({
      data: {
        code: `BNM${run}2`,
        status: 'IN_PROGRESS',
        serviceId,
        packageId,
        formSchemaVersion: 1,
        formData: {},
        customerId: customer1Id,
        assignedToId: assignedOpsId,
      },
    });
    app2Id = a2.id;
  });

  afterAll(async () => {
    try {
      await prisma.message.deleteMany({
        where: { conversation: { application: { customerId: { in: [customer1Id, customer2Id] } } } },
      });
      await prisma.conversation.deleteMany({
        where: { application: { customerId: { in: [customer1Id, customer2Id] } } },
      });
      await prisma.application.deleteMany({
        where: { customerId: { in: [customer1Id, customer2Id] } },
      });
      await prisma.servicePackage.deleteMany({ where: { serviceId } });
      await prisma.serviceFormSchema.deleteMany({ where: { serviceId } });
      await prisma.service.deleteMany({ where: { id: serviceId } });
      await prisma.category.deleteMany({ where: { id: categoryId } });
      await prisma.auditLog.deleteMany({
        where: { actor: { email: { startsWith: `e2e-msg-${run}-` } } },
      });
      await prisma.user.deleteMany({
        where: { email: { startsWith: `e2e-msg-${run}-` } },
      });
    } finally {
      await app.close();
    }
  });

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  it('creates conversation lazily, exchanges customer and staff messages, tracks unread counts and mark-read, and emits message.created', async () => {
    // Before any message or read, no conversation exists
    expect(await prisma.conversation.findUnique({ where: { applicationId: app1Id } })).toBeNull();

    // Unread counts start at 0 on both sides without creating a conversation
    const initCustUnread = await http
      .get(`/api/applications/${app1Id}/messages/unread-count`)
      .set(auth(customer1Token))
      .expect(200);
    expect(messageUnreadCountSchema.parse(initCustUnread.body)).toEqual({ count: 0 });

    const initStaffUnread = await http
      .get(`/api/admin/applications/${app1Id}/messages/unread-count`)
      .set(auth(assignedOpsToken))
      .expect(200);
    expect(messageUnreadCountSchema.parse(initStaffUnread.body)).toEqual({ count: 0 });

    const emitted: DomainEvent<'message.created'>[] = [];
    const unsubscribe = events.on('message.created', (ev) => {
      if (ev.payload.applicationId === app1Id) emitted.push(ev);
    });

    try {
      // 1. Customer posts a message (trimmed)
      const custPost = await http
        .post(`/api/applications/${app1Id}/messages`)
        .set(auth(customer1Token))
        .send({ body: '  Hello, when will my filing be completed?  ' })
        .expect(201);

      const custMsg = messageSchema.parse(custPost.body);
      expect(custMsg.body).toBe('Hello, when will my filing be completed?');
      expect(custMsg.sender).toEqual({
        id: customer1Id,
        name: `Customer One ${run}`,
        isStaff: false,
      });
      expect(custMsg.readAt).toBeNull();

      // Conversation now exists lazily
      const conv = await prisma.conversation.findUnique({ where: { applicationId: app1Id } });
      expect(conv).not.toBeNull();

      // Event emitted for customer message
      expect(emitted).toHaveLength(1);
      expect(emitted[0].payload).toEqual({
        messageId: custMsg.id,
        applicationId: app1Id,
        senderId: customer1Id,
        fromStaff: false,
      });

      // Staff unread count goes up to 1; customer unread count stays 0
      const staffUnreadAfterCust = await http
        .get(`/api/admin/applications/${app1Id}/messages/unread-count`)
        .set(auth(assignedOpsToken))
        .expect(200);
      expect(staffUnreadAfterCust.body).toEqual({ count: 1 });

      const custUnreadAfterCust = await http
        .get(`/api/applications/${app1Id}/messages/unread-count`)
        .set(auth(customer1Token))
        .expect(200);
      expect(custUnreadAfterCust.body).toEqual({ count: 0 });

      // Staff marks customer messages read -> staff unread count goes back to 0
      const staffMarkRead = await http
        .post(`/api/admin/applications/${app1Id}/messages/read`)
        .set(auth(assignedOpsToken))
        .expect(200);
      expect(staffMarkRead.body).toEqual({ count: 1 });

      const staffUnreadAfterRead = await http
        .get(`/api/admin/applications/${app1Id}/messages/unread-count`)
        .set(auth(assignedOpsToken))
        .expect(200);
      expect(staffUnreadAfterRead.body).toEqual({ count: 0 });

      // 2. Staff posts a reply
      const staffPost = await http
        .post(`/api/admin/applications/${app1Id}/messages`)
        .set(auth(assignedOpsToken))
        .send({ body: 'We are reviewing your documents today.' })
        .expect(201);

      const staffMsg = messageSchema.parse(staffPost.body);
      expect(staffMsg.body).toBe('We are reviewing your documents today.');
      expect(staffMsg.sender.id).toBe(assignedOpsId);
      expect(staffMsg.sender.isStaff).toBe(true);
      expect(staffMsg.readAt).toBeNull();

      // Event emitted for staff message
      expect(emitted).toHaveLength(2);
      expect(emitted[1].payload).toEqual({
        messageId: staffMsg.id,
        applicationId: app1Id,
        senderId: assignedOpsId,
        fromStaff: true,
      });

      // Customer unread count goes up to 1; staff unread count stays 0
      const custUnreadAfterStaff = await http
        .get(`/api/applications/${app1Id}/messages/unread-count`)
        .set(auth(customer1Token))
        .expect(200);
      expect(custUnreadAfterStaff.body).toEqual({ count: 1 });

      const staffUnreadAfterStaff = await http
        .get(`/api/admin/applications/${app1Id}/messages/unread-count`)
        .set(auth(adminToken))
        .expect(200);
      expect(staffUnreadAfterStaff.body).toEqual({ count: 0 });

      // Customer marks staff messages read -> customer unread count goes back to 0
      const custMarkRead = await http
        .post(`/api/applications/${app1Id}/messages/read`)
        .set(auth(customer1Token))
        .expect(200);
      expect(custMarkRead.body).toEqual({ count: 1 });

      const custUnreadAfterRead = await http
        .get(`/api/applications/${app1Id}/messages/unread-count`)
        .set(auth(customer1Token))
        .expect(200);
      expect(custUnreadAfterRead.body).toEqual({ count: 0 });

      // Thread list returns messages oldest -> newest with readAt populated on both
      const staffThreadRes = await http
        .get(`/api/admin/applications/${app1Id}/messages`)
        .set(auth(adminToken))
        .expect(200);
      const staffThread = messageThreadPageSchema.parse(staffThreadRes.body);
      expect(staffThread.total).toBe(2);
      expect(staffThread.items.map((m) => m.id)).toEqual([custMsg.id, staffMsg.id]);
      expect(staffThread.items[0].readAt).not.toBeNull();
      expect(staffThread.items[1].readAt).not.toBeNull();

      const custThreadRes = await http
        .get(`/api/applications/${app1Id}/messages`)
        .set(auth(customer1Token))
        .expect(200);
      const custThread = messageThreadPageSchema.parse(custThreadRes.body);
      expect(custThread.total).toBe(2);
      expect(custThread.items.map((m) => m.id)).toEqual([custMsg.id, staffMsg.id]);

      // Never returns another application's messages
      const app2ThreadRes = await http
        .get(`/api/applications/${app2Id}/messages`)
        .set(auth(customer1Token))
        .expect(200);
      const app2Thread = messageThreadPageSchema.parse(app2ThreadRes.body);
      expect(app2Thread.items).toEqual([]);
      expect(app2Thread.total).toBe(0);
    } finally {
      unsubscribe();
    }
  });

  it('returns 404 to another customer on all customer message endpoints', async () => {
    await http
      .get(`/api/applications/${app1Id}/messages`)
      .set(auth(customer2Token))
      .expect(404);
    await http
      .post(`/api/applications/${app1Id}/messages`)
      .set(auth(customer2Token))
      .send({ body: 'Should not work' })
      .expect(404);
    await http
      .post(`/api/applications/${app1Id}/messages/read`)
      .set(auth(customer2Token))
      .expect(404);
    await http
      .get(`/api/applications/${app1Id}/messages/unread-count`)
      .set(auth(customer2Token))
      .expect(404);
  });

  it('returns 404 to unassigned ops on all staff message endpoints', async () => {
    await http
      .get(`/api/admin/applications/${app1Id}/messages`)
      .set(auth(unassignedOpsToken))
      .expect(404);
    await http
      .post(`/api/admin/applications/${app1Id}/messages`)
      .set(auth(unassignedOpsToken))
      .send({ body: 'Unassigned ops message' })
      .expect(404);
    await http
      .post(`/api/admin/applications/${app1Id}/messages/read`)
      .set(auth(unassignedOpsToken))
      .expect(404);
    await http
      .get(`/api/admin/applications/${app1Id}/messages/unread-count`)
      .set(auth(unassignedOpsToken))
      .expect(404);
  });

  it('returns 403 to SUPPORT on all staff message endpoints', async () => {
    await http
      .get(`/api/admin/applications/${app1Id}/messages`)
      .set(auth(supportToken))
      .expect(403);
    await http
      .post(`/api/admin/applications/${app1Id}/messages`)
      .set(auth(supportToken))
      .send({ body: 'Support message' })
      .expect(403);
    await http
      .post(`/api/admin/applications/${app1Id}/messages/read`)
      .set(auth(supportToken))
      .expect(403);
    await http
      .get(`/api/admin/applications/${app1Id}/messages/unread-count`)
      .set(auth(supportToken))
      .expect(403);
  });

  it('page 1 is the newest messages, each page oldest → newest', async () => {
    for (const body of ['paging 1', 'paging 2', 'paging 3']) {
      await http.post(`/api/applications/${app1Id}/messages`).set(auth(customer1Token)).send({ body }).expect(201);
    }
    const page1 = await http.get(`/api/applications/${app1Id}/messages?limit=2`).set(auth(customer1Token)).expect(200);
    expect(page1.body.items.map((m: { body: string }) => m.body)).toEqual(['paging 2', 'paging 3']);
    const page2 = await http.get(`/api/applications/${app1Id}/messages?limit=2&page=2`).set(auth(customer1Token)).expect(200);
    expect(page2.body.items.at(-1).body).toBe('paging 1');
  });

  it('returns 400 for empty or too-long message body', async () => {
    await http
      .post(`/api/applications/${app1Id}/messages`)
      .set(auth(customer1Token))
      .send({ body: '   ' })
      .expect(400);

    await http
      .post(`/api/applications/${app1Id}/messages`)
      .set(auth(customer1Token))
      .send({ body: 'x'.repeat(4001) })
      .expect(400);

    await http
      .post(`/api/admin/applications/${app1Id}/messages`)
      .set(auth(assignedOpsToken))
      .send({ body: '' })
      .expect(400);

    await http
      .post(`/api/admin/applications/${app1Id}/messages`)
      .set(auth(assignedOpsToken))
      .send({ body: 'y'.repeat(4001) })
      .expect(400);
  });
});
