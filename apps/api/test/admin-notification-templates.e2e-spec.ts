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
let adminId: string;

const run = `${Date.now().toString().slice(-7)}${Math.floor(Math.random() * 100)}`;
const email = (n: number) => `e2e-notif-tmpl-${run}-${n}@example.com`;
const as = (token: string) => ({ authorization: `Bearer ${token}` });

describe('Admin Notification Templates (e2e)', () => {
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
    await app.init();
    http = request(app.getHttpServer()) as unknown as ReturnType<typeof request>;
    prisma = app.get(PrismaService);
    admin = (await staffSession(http, prisma, 'ADMIN', email(1))).accessToken;
    ops = (await staffSession(http, prisma, 'OPERATIONS', email(2))).accessToken;
    adminId = (await prisma.user.findUniqueOrThrow({ where: { email: email(1) } })).id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('rejects anonymous and unauthorized users with 401 and 403', async () => {
    const unauth = await http.get('/api/admin/notifications/templates');
    expect(unauth.status).toBe(401);

    const forbidden = await http.get('/api/admin/notifications/templates').set(as(ops));
    expect(forbidden.status).toBe(403);
  });

  it('lists notification templates with allowed variables and supports filtering', async () => {
    const res = await http.get('/api/admin/notifications/templates').set(as(admin));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.templates)).toBe(true);
    expect(res.body.templates.length).toBeGreaterThan(0);

    const first = res.body.templates[0];
    expect(first).toHaveProperty('id');
    expect(first).toHaveProperty('event');
    expect(first).toHaveProperty('channel');
    expect(first).toHaveProperty('body');
    expect(first).toHaveProperty('allowedVariables');
    expect(Array.isArray(first.allowedVariables)).toBe(true);

    // Filter by event and channel
    const filtered = await http
      .get('/api/admin/notifications/templates?event=payment.succeeded&channel=EMAIL')
      .set(as(admin));
    expect(filtered.status).toBe(200);
    expect(filtered.body.templates.length).toBe(1);
    expect(filtered.body.templates[0].event).toBe('payment.succeeded');
    expect(filtered.body.templates[0].channel).toBe('EMAIL');
  });

  it('returns event variables metadata', async () => {
    const res = await http.get('/api/admin/notifications/templates/events').set(as(admin));
    expect(res.status).toBe(200);
    expect(res.body['payment.succeeded']).toBeDefined();
    expect(Array.isArray(res.body['payment.succeeded'])).toBe(true);
    expect(res.body['payment.succeeded'].some((v: { name: string }) => v.name === 'amount')).toBe(true);
  });

  it('previews template with sample variables and catches unknown/missing variables', async () => {
    const previewRes = await http
      .post('/api/admin/notifications/templates/preview')
      .set(as(admin))
      .send({
        channel: 'EMAIL',
        event: 'payment.succeeded',
        subject: 'Receipt for {{orderCode}}',
        body: '<p>Hi {{customerName}}, received {{amount}} & thanks! {{unknownVar}}</p>',
      });

    expect(previewRes.status).toBe(201);
    expect(previewRes.body.renderedSubject).toContain('ORD-');
    expect(previewRes.body.renderedBody).toContain('Hi Rajesh Sharma');
    expect(previewRes.body.renderedBody).toContain('₹4,999');
    expect(previewRes.body.variablesUsed).toEqual(expect.arrayContaining(['orderCode', 'customerName', 'amount', 'unknownVar']));
    expect(previewRes.body.unknownVariables).toEqual(['unknownVar']);
  });

  it('updates a template, writes audit log, and handles validation', async () => {
    const target = await prisma.notificationTemplate.findFirstOrThrow({
      where: { event: 'payment.succeeded', channel: 'SMS' },
    });

    const originalBody = target.body;
    const originalDlt = target.dltTemplateId;
    const originalActive = target.isActive;

    try {
      // Empty body is rejected
      const bad = await http
        .put(`/api/admin/notifications/templates/${target.id}`)
        .set(as(admin))
        .send({ body: '   ' });
      expect(bad.status).toBe(400);

      // Operations staff gets 403
      const opsUpdate = await http
        .put(`/api/admin/notifications/templates/${target.id}`)
        .set(as(ops))
        .send({ body: 'Test body' });
      expect(opsUpdate.status).toBe(403);

      // Admin updates successfully
      const updateRes = await http
        .put(`/api/admin/notifications/templates/${target.id}`)
        .set(as(admin))
        .send({
          body: 'Updated SMS: Payment of {{amount}} for {{orderCode}} received.',
          dltTemplateId: 'DLT-TEST-12345',
          isActive: true,
        });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.body).toBe('Updated SMS: Payment of {{amount}} for {{orderCode}} received.');
      expect(updateRes.body.dltTemplateId).toBe('DLT-TEST-12345');

      // Check DB row updated
      const inDb = await prisma.notificationTemplate.findUniqueOrThrow({
        where: { id: target.id },
      });
      expect(inDb.body).toBe('Updated SMS: Payment of {{amount}} for {{orderCode}} received.');
      expect(inDb.dltTemplateId).toBe('DLT-TEST-12345');

      // Check audit log
      const audit = await prisma.auditLog.findFirst({
        where: {
          actorId: adminId,
          action: 'notification.template.update',
          entityId: target.id,
        },
        orderBy: { createdAt: 'desc' },
      });
      expect(audit).not.toBeNull();
      expect(audit?.before).toMatchObject({
        body: originalBody,
        dltTemplateId: originalDlt,
      });
      expect(audit?.after).toMatchObject({
        body: 'Updated SMS: Payment of {{amount}} for {{orderCode}} received.',
        dltTemplateId: 'DLT-TEST-12345',
      });
    } finally {
      // Restore original
      await prisma.notificationTemplate.update({
        where: { id: target.id },
        data: {
          body: originalBody,
          dltTemplateId: originalDlt,
          isActive: originalActive,
        },
      });
    }
  });

  it('returns 404 for unknown template ID', async () => {
    const res = await http
      .get('/api/admin/notifications/templates/00000000-0000-0000-0000-000000000000')
      .set(as(admin));
    expect(res.status).toBe(404);
  });
});
