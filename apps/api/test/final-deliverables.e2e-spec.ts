import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { type ApplicationStatus } from '@biznexa/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { staffSession } from './staff';

describe('Final Deliverables API', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;

  const run = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  let adminId: string, adminToken: string;
  let opsId: string, opsToken: string;
  let supportToken: string;
  let customerId: string, customerToken: string;
  let otherCustomerToken: string;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    http = request(app.getHttpServer());
    prisma = app.get(PrismaService);

    const admin = await staffSession(http, prisma, 'ADMIN', `admin-${run}@biznexa.com`);
    adminToken = admin.accessToken;
    adminId = (await prisma.user.findUniqueOrThrow({ where: { email: `admin-${run}@biznexa.com` } })).id;

    const ops = await staffSession(http, prisma, 'OPERATIONS', `ops-${run}@biznexa.com`);
    opsToken = ops.accessToken;
    opsId = (await prisma.user.findUniqueOrThrow({ where: { email: `ops-${run}@biznexa.com` } })).id;

    const support = await staffSession(http, prisma, 'SUPPORT', `support-${run}@biznexa.com`);
    supportToken = support.accessToken;
    const _supportId = (await prisma.user.findUniqueOrThrow({ where: { email: `support-${run}@biznexa.com` } })).id;

    async function doRegister(name: string, email: string, mobile: string) {
      const res = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({ name, email, mobile, password: 'Password123!', consent: true });
      if (res.status !== 201) throw new Error(`Failed to register ${email}: ${JSON.stringify(res.body)}`);

      const user = await prisma.user.findFirstOrThrow({ where: { email } });
      return { token: res.body.accessToken, id: user.id };
    }

    const mobileSuffix = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
    const c1 = await doRegister('C1', `deliverables-c1-${run}@example.com`, `9911${mobileSuffix}`);
    customerToken = c1.token;
    customerId = c1.id;

    const otherMobileSuffix = String((Number(mobileSuffix) + 1) % 1_000_000).padStart(6, '0');
    const c2 = await doRegister('C2', `deliverables-c2-${run}@example.com`, `9922${otherMobileSuffix}`);
    otherCustomerToken = c2.token;
    const _otherCustomerId = c2.id;
  });

  afterAll(async () => {
    try {
      const prefix = `deliv-${run}-`;
      await prisma.finalDeliverable.deleteMany({ where: { application: { code: { startsWith: prefix } } } });
      await prisma.applicationStageHistory.deleteMany({ where: { application: { code: { startsWith: prefix } } } });
      await prisma.application.deleteMany({ where: { code: { startsWith: prefix } } });
      const users = { email: { contains: `${run}@` } };
      const ids = (await prisma.user.findMany({ where: users, select: { id: true } })).map((u) => u.id);
      await prisma.storedFile.deleteMany({ where: { ownerId: { in: ids } } });
      await prisma.user.deleteMany({ where: users });
    } finally {
      await app.close(); // always, or Jest never exits
    }
  });

  async function createTestApp(status: ApplicationStatus, assignedToId: string | null = null, codeStr: string) {
    const s = await prisma.service.findFirstOrThrow({ where: { isActive: true } });
    const p = await prisma.servicePackage.findFirstOrThrow({ where: { serviceId: s.id } });

    const a = await prisma.application.create({
      data: {
        code: `deliv-${run}-${codeStr}`,
        customerId,
        serviceId: s.id,
        packageId: p.id,
        status,
        assignedToId,
        history: { create: { status, changedById: customerId, note: 'Test' } },
      },
    });
    return a;
  }

  async function uploadFile(token: string, requirementId?: string) {
    const PDF = Buffer.concat([Buffer.from(String.raw`%PDF-1.7\n`), Buffer.alloc(100, 0x20)]);
    const query = requirementId ? `?requirementId=${requirementId}` : '';
    const res = await http.post(`/api/files${query}`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', PDF, 'deliverable.pdf')
      .expect(201);
    return res.body.id;
  }

  it('admin adds a deliverable on an IN_PROGRESS application -> 201, listed for staff and the customer', async () => {
    const a = await createTestApp('IN_PROGRESS', null, '1');
    const fileId = await uploadFile(adminToken);

    // Admin adds
    const res = await http.post(`/api/admin/applications/${a.id}/deliverables`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'Final Report', fileId })
      .expect(201);

    expect(res.body.title).toBe('Final Report');
    expect(res.body.fileId).toBe(fileId);
    expect(res.body.fileName).toBe('deliverable.pdf');

    // Listed for admin
    const listRes = await http.get(`/api/admin/applications/${a.id}/deliverables`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(listRes.body).toHaveLength(1);
    expect(listRes.body[0].id).toBe(res.body.id);

    // Listed for customer
    const cListRes = await http.get(`/api/applications/${a.id}/deliverables`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);
    expect(cListRes.body).toHaveLength(1);
    expect(cListRes.body[0].id).toBe(res.body.id);
  });

  it('DRAFT / SUBMITTED application -> 409; unassigned OPERATIONS user -> 404; SUPPORT -> 403', async () => {
    const draft = await createTestApp('DRAFT', null, 'draft');
    const submitted = await createTestApp('SUBMITTED', null, 'submitted');
    const assigned = await createTestApp('IN_PROGRESS', opsId, 'assigned');
    const other = await createTestApp('IN_PROGRESS', adminId, 'other');

    const fileId = await uploadFile(adminToken);
    const opsFileId = await uploadFile(opsToken);

    await http.post(`/api/admin/applications/${draft.id}/deliverables`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'T', fileId })
      .expect(409);

    await http.post(`/api/admin/applications/${submitted.id}/deliverables`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'T', fileId })
      .expect(409);

    await http.post(`/api/admin/applications/${other.id}/deliverables`)
      .set('Authorization', `Bearer ${opsToken}`)
      .send({ title: 'T', fileId: opsFileId })
      .expect(404);

    await http.post(`/api/admin/applications/${assigned.id}/deliverables`)
      .set('Authorization', `Bearer ${supportToken}`)
      .send({ title: 'T', fileId })
      .expect(403);
  });

  it('infected file, a file uploaded by someone else, a file used twice -> 400 (field fileId)', async () => {
    const a = await createTestApp('IN_PROGRESS', null, 'bad-files');
    const customerFileId = await uploadFile(customerToken);

    // Uploaded by someone else (customer)
    const r1 = await http.post(`/api/admin/applications/${a.id}/deliverables`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'T', fileId: customerFileId })
      .expect(400);
    expect(r1.body.errors[0].field).toBe('fileId');

    // Infected file
    const infectedFileId = await uploadFile(adminToken);
    await prisma.storedFile.update({ where: { id: infectedFileId }, data: { scanStatus: 'INFECTED' } });
    const r2 = await http.post(`/api/admin/applications/${a.id}/deliverables`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'T', fileId: infectedFileId })
      .expect(400);
    expect(r2.body.errors[0].field).toBe('fileId');

    // Used twice
    const validFileId = await uploadFile(adminToken);
    await http.post(`/api/admin/applications/${a.id}/deliverables`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'T1', fileId: validFileId })
      .expect(201);

    const r3 = await http.post(`/api/admin/applications/${a.id}/deliverables`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'T2', fileId: validFileId })
      .expect(400);
    expect(r3.body.errors[0].field).toBe('fileId');
  });

  it('the customer gets a link, another customer gets 404, audit log row exists', async () => {
    const a = await createTestApp('IN_PROGRESS', null, 'links');
    const fileId = await uploadFile(adminToken);

    // Add deliverable
    await http.post(`/api/admin/applications/${a.id}/deliverables`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'Final Report', fileId })
      .expect(201);

    // Set scanStatus to CLEAN
    await prisma.storedFile.update({ where: { id: fileId }, data: { scanStatus: 'CLEAN' } });

    // Customer gets link
    await http.post(`/api/files/${fileId}/link`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ disposition: 'attachment' })
      .expect(200);

    // Another customer gets 404
    await http.post(`/api/files/${fileId}/link`)
      .set('Authorization', `Bearer ${otherCustomerToken}`)
      .send({ disposition: 'attachment' })
      .expect(404);

    // Audit log row exists
    const logs = await prisma.auditLog.findMany({
      where: {
        entityId: a.id,
        action: 'deliverable.add',
      },
    });
    expect(logs).toHaveLength(1);
    expect((logs[0].after as any).fileId).toBe(fileId);
  });

  it('refuses DELIVERED without a final deliverable and accepts it once one exists', async () => {
    const without = await createTestApp('COMPLETED', null, 'delivered-without');
    await http.post(`/api/admin/applications/${without.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ to: 'DELIVERED' })
      .expect(409);
    expect((await prisma.application.findUniqueOrThrow({ where: { id: without.id } })).status).toBe('COMPLETED');

    const withDeliverable = await createTestApp('COMPLETED', null, 'delivered-with');
    const fileId = await uploadFile(adminToken);
    await http.post(`/api/admin/applications/${withDeliverable.id}/deliverables`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'Final report', fileId })
      .expect(201);
    await http.post(`/api/admin/applications/${withDeliverable.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ to: 'DELIVERED' })
      .expect(201);
    expect((await prisma.application.findUniqueOrThrow({ where: { id: withDeliverable.id } })).status).toBe('DELIVERED');
  });
});
