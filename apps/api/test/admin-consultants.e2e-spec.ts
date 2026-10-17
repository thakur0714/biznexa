import { randomInt, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { staffSession } from './staff';

const registeredSchema = z.object({ accessToken: z.string() });
const as = (token: string) => ({ authorization: `Bearer ${token}` });

describe('Admin consultant review (M8.2)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let customerToken: string;
  let adminId: string;
  let customerId: string;
  let consultantId: string;
  const runId = randomUUID();
  const emailPrefix = `consultant-review-${runId}`;
  const fileIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
    await app.init();
    prisma = app.get(PrismaService);
    const http = request(app.getHttpServer());
    const staff = await staffSession(http, prisma, 'ADMIN', `${emailPrefix}-admin@example.com`);
    adminToken = staff.accessToken;
    adminId = (await prisma.user.findUniqueOrThrow({ where: { email: `${emailPrefix}-admin@example.com` }, select: { id: true } })).id;
    const mobile = `8${String(randomInt(100_000_000, 1_000_000_000))}`;
    const customer = await http.post('/api/auth/register').send({
      name: `Review customer ${runId.slice(0, 8)}`,
      email: `${emailPrefix}-customer@example.com`,
      mobile,
      password: 'Customer@12345',
      consent: true,
    }).expect(201);
    customerToken = registeredSchema.parse(customer.body).accessToken;
    customerId = (await prisma.user.findUniqueOrThrow({ where: { email: `${emailPrefix}-customer@example.com` }, select: { id: true } })).id;
    const files = await Promise.all(['qualification', 'membership', 'identity'].map((kind) => prisma.storedFile.create({
      data: {
        ownerId: customerId,
        fileKey: `consultant-review/${runId}/${kind}`,
        originalName: `${kind}.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: 12,
        sha256: `${kind.padEnd(64, 'a').slice(0, 64)}`,
        scanStatus: 'CLEAN',
      },
      select: { id: true },
    })));
    fileIds.push(...files.map(({ id }) => id));
    const created = await prisma.consultant.create({
      data: {
        userId: customerId,
        slug: `review-${runId}`,
        category: 'CA',
        qualification: 'Chartered Accountant',
        membershipNo: 'ICAI-TEST',
        experienceYears: 8,
        expertise: ['GST'],
        languages: ['English'],
        city: 'Pune',
        state: 'Maharashtra',
        area: 'Central',
        feePerSession: 120_000,
        consultationTypes: ['AUDIO'],
        documents: { create: files.map((file, index) => ({ kind: (['QUALIFICATION_PROOF', 'MEMBERSHIP_PROOF', 'ID_PROOF'] as const)[index]!, fileId: file.id })) },
      },
      select: { id: true },
    });
    consultantId = created.id;
  });

  afterAll(async () => {
    try {
      if (consultantId) {
        await prisma.auditLog.deleteMany({ where: { entityType: 'Consultant', entityId: consultantId } });
        await prisma.consultant.deleteMany({ where: { id: consultantId } });
      }
      if (fileIds.length) await prisma.storedFile.deleteMany({ where: { id: { in: fileIds } } });
      const createdUsers = [adminId, customerId].filter(Boolean);
      if (createdUsers.length) {
        await prisma.auditLog.deleteMany({ where: { actorId: { in: createdUsers } } });
        await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
      }
    } finally {
      await app.close();
    }
  });

  it('protects review routes and reviews profile, documents and role access with audited writes', async () => {
    const http = request(app.getHttpServer());
    await http.get('/api/admin/consultants').expect(401);
    await http.get('/api/admin/consultants').set(as(customerToken)).expect(403);
    const list = await http.get('/api/admin/consultants?status=PENDING&page=1&limit=10').set(as(adminToken)).expect(200);
    expect(list.body.items).toContainEqual(expect.objectContaining({ id: consultantId, email: `${emailPrefix}-customer@example.com`, verificationStatus: 'PENDING' }));
    const detail = await http.get(`/api/admin/consultants/${consultantId}`).set(as(adminToken)).expect(200);
    expect(detail.body.documents).toHaveLength(3);

    await http.patch(`/api/admin/consultants/${consultantId}/profile`).set(as(adminToken)).send({
      category: 'CA', qualification: 'Updated qualification', membershipNo: 'ICAI-UPDATED', experienceYears: 9,
      expertise: ['GST', 'Audits'], languages: ['English', 'Hindi'], city: 'Pune', state: 'Maharashtra',
      area: 'Central', bio: 'Updated biography', feePerSession: 130_000, consultationTypes: ['AUDIO', 'VIDEO'],
    }).expect(200);
    const profileAudit = await prisma.auditLog.findFirst({ where: { entityType: 'Consultant', entityId: consultantId, action: 'consultant.profile.update' } });
    expect(profileAudit?.before).toMatchObject({ qualification: 'Chartered Accountant' });
    expect(profileAudit?.after).toMatchObject({ qualification: 'Updated qualification' });

    await http.post(`/api/admin/consultants/${consultantId}/suspend`).set(as(adminToken)).expect(409);
    const concurrentRejects = await Promise.all([
      http.post(`/api/admin/consultants/${consultantId}/reject`).set(as(adminToken)).send({ reason: 'Please clarify the membership proof.' }),
      http.post(`/api/admin/consultants/${consultantId}/reject`).set(as(adminToken)).send({ reason: 'Please clarify the membership proof.' }),
    ]);
    expect(concurrentRejects.map(({ status }) => status).sort()).toEqual([201, 409]);
    expect(await prisma.consultant.findUniqueOrThrow({ where: { id: consultantId }, select: { verificationStatus: true, rejectionReason: true } })).toMatchObject({ verificationStatus: 'REJECTED', rejectionReason: 'Please clarify the membership proof.' });
    await http.post(`/api/admin/consultants/${consultantId}/reject`).set(as(adminToken)).send({ reason: 'Again' }).expect(409);
    await http.post(`/api/admin/consultants/${consultantId}/approve`).set(as(adminToken)).expect(201);
    await http.post(`/api/admin/consultants/${consultantId}/approve`).set(as(adminToken)).expect(409);
    await http.post(`/api/admin/consultants/${consultantId}/reject`).set(as(adminToken)).send({ reason: 'Not allowed after approval' }).expect(409);
    const consultantRole = await prisma.userRole.findFirst({ where: { userId: customerId, role: { key: 'CONSULTANT' } } });
    expect(consultantRole).not.toBeNull();
    await http.post(`/api/files/${fileIds[0]}/link?disposition=inline`).set(as(adminToken)).expect(200);
    await http.post(`/api/admin/consultants/${consultantId}/suspend`).set(as(adminToken)).expect(201);
    expect(await prisma.userRole.findFirst({ where: { userId: customerId, role: { key: 'CONSULTANT' } } })).toBeNull();
    await http.post(`/api/admin/consultants/${consultantId}/suspend`).set(as(adminToken)).expect(409);
    await http.post(`/api/admin/consultants/${consultantId}/approve`).set(as(adminToken)).expect(201);
    expect(await prisma.userRole.findFirst({ where: { userId: customerId, role: { key: 'CONSULTANT' } } })).not.toBeNull();
    const actions = await prisma.auditLog.findMany({ where: { entityType: 'Consultant', entityId: consultantId } });
    expect(actions.map((entry) => entry.action)).toEqual(expect.arrayContaining(['consultant.profile.update', 'consultant.rejected', 'consultant.approved', 'consultant.suspended']));
  });
});
