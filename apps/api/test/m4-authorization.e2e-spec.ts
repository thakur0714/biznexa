/**
 * M4 Fulfilment Authorization & Scoping Suite (M4.17)
 *
 * Verifies authorization and tenant/assignment scoping across all M4 fulfilment routes:
 * - Unauthenticated requests receive 401 Unauthorized
 * - Customer role receives 403 Forbidden on staff/admin routes
 * - Support role (missing applications/documents/certificates permissions) receives 403 Forbidden
 * - Operations role without view_all receives 403 on global staff actions (bulk-assign, assignee)
 * - Operations role without certificates.manage receives 403 on certificate creation
 * - Operations role sees 404 Not Found on unassigned applications, documents, notes, deliverables
 * - Customer data isolation: customer B cannot access customer A's applications, documents, or deliverables
 */
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { staffSession } from './staff';
import { GENERIC_SERVICE_FORM } from '@biznexa/types';

describe('M4 Fulfilment Authorization & Scoping (M4.17)', () => {
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;
  let prisma: PrismaService;

  const run = `${Date.now().toString().slice(-7)}${Math.floor(Math.random() * 900 + 100)}`;
  const P = `BNAUTH${run}`;

  let adminToken = '';
  let assignedOpsToken = '';
  let unassignedOpsToken = '';
  let supportToken = '';
  let customer1Token = '';
  let customer2Token = '';

  let assignedOpsId = '';
  let customer1Id = '';
  let customer2Id = '';
  let app1Id = '';
  let doc1Id = '';
  let note1Id = '';
  let file1Id = '';
  let file2Id = '';

  const as = (token?: string) => (token ? { authorization: `Bearer ${token}` } : {});

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    http = request(app.getHttpServer());
    prisma = app.get(PrismaService);

    // 1. Staff users
    adminToken = (await staffSession(http, prisma, 'ADMIN', `admin-${run}@example.com`)).accessToken;
    assignedOpsToken = (await staffSession(http, prisma, 'OPERATIONS', `ops-assigned-${run}@example.com`)).accessToken;
    unassignedOpsToken = (await staffSession(http, prisma, 'OPERATIONS', `ops-unassigned-${run}@example.com`)).accessToken;
    supportToken = (await staffSession(http, prisma, 'SUPPORT', `support-${run}@example.com`)).accessToken;

    assignedOpsId = (await prisma.user.findUniqueOrThrow({ where: { email: `ops-assigned-${run}@example.com` } })).id;

    // 2. Customer users
    const c1Res = await http.post('/api/auth/register').send({
      name: `Customer 1 ${run}`,
      email: `cust1-${run}@example.com`,
      mobile: `9${run.padStart(9, '0')}`.substring(0, 10),
      password: 'Password@123',
      consent: true,
    }).expect(201);
    customer1Token = c1Res.body.accessToken;
    customer1Id = c1Res.body.user.id;

    const altMobile = String(Number(`9${run.padStart(9, '0')}`.substring(0, 10)) + 1);
    const c2Res = await http.post('/api/auth/register').send({
      name: `Customer 2 ${run}`,
      email: `cust2-${run}@example.com`,
      mobile: altMobile.substring(0, 10),
      password: 'Password@123',
      consent: true,
    }).expect(201);
    customer2Token = c2Res.body.accessToken;
    customer2Id = c2Res.body.user.id;

    // 3. Catalogue & applications
    const cat = await prisma.category.create({ data: { name: `M4 Auth Cat ${run}`, slug: `m4-cat-${run}` } });
    const svc = await prisma.service.create({
      data: {
        slug: `m4-svc-${run}`,
        categoryId: cat.id,
        name: `M4 Service ${run}`,
        shortDescription: 'M4 Auth testing',
        sacCode: '998231',
        formSchemas: {
          create: [{ version: 1, schema: GENERIC_SERVICE_FORM as object, isCurrent: true }],
        },
      },
    });
    const pkg = await prisma.servicePackage.create({
      data: {
        name: 'Auth Standard',
        serviceId: svc.id,
        professionalFee: 50000,
        governmentFee: 0,
        gstRate: 18,
      },
    });

    const app1 = await prisma.application.create({
      data: {
        code: `${P}1`,
        customerId: customer1Id,
        serviceId: svc.id,
        packageId: pkg.id,
        status: 'IN_PROGRESS',
        assignedToId: assignedOpsId,
        formSchemaVersion: 1,
      },
    });
    app1Id = app1.id;

    await prisma.application.create({
      data: {
        code: `${P}2`,
        customerId: customer2Id,
        serviceId: svc.id,
        packageId: pkg.id,
        status: 'DOCUMENTS_UNDER_REVIEW',
        assignedToId: null, // unassigned
      },
    });

    // 4. Stored files & document on app1
    const storedFile1 = await prisma.storedFile.create({
      data: {
        fileKey: `auth-test-${run}-1.pdf`,
        originalName: 'doc1.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        sha256: 'a'.repeat(64),
        ownerId: customer1Id,
        scanStatus: 'CLEAN',
      },
    });
    file1Id = storedFile1.id;

    const doc1 = await prisma.applicationDocument.create({
      data: {
        applicationId: app1Id,
        name: 'PAN Card',
        status: 'UPLOADED',
        version: 1,
        fileKey: storedFile1.fileKey,
      },
    });
    doc1Id = doc1.id;

    // 5. Internal note on app1
    const note1 = await prisma.internalNote.create({
      data: {
        applicationId: app1Id,
        authorId: assignedOpsId,
        body: 'Confidential review note',
      },
    });
    note1Id = note1.id;

    // 6. Deliverable on app1
    const storedFile2 = await prisma.storedFile.create({
      data: {
        fileKey: `auth-test-${run}-2.pdf`,
        originalName: 'deliverable.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2048,
        sha256: 'b'.repeat(64),
        ownerId: assignedOpsId,
        scanStatus: 'CLEAN',
      },
    });
    file2Id = storedFile2.id;

    await prisma.finalDeliverable.create({
      data: {
        applicationId: app1Id,
        title: 'Completion Report',
        fileKey: storedFile2.fileKey,
        fileName: 'deliverable.pdf',
        uploadedById: assignedOpsId,
      },
    });
  });

  afterAll(async () => {
    const apps = await prisma.application.findMany({ where: { code: { startsWith: P } }, select: { id: true } });
    const appIds = apps.map((a) => a.id);

    if (appIds.length) {
      await prisma.auditLog.deleteMany({ where: { entityType: 'Application', entityId: { in: appIds } } });
      await prisma.finalDeliverable.deleteMany({ where: { applicationId: { in: appIds } } });
      await prisma.internalNote.deleteMany({ where: { applicationId: { in: appIds } } });
      await prisma.applicationDocument.deleteMany({ where: { applicationId: { in: appIds } } });
      await prisma.applicationStageHistory.deleteMany({ where: { applicationId: { in: appIds } } });
      await prisma.application.deleteMany({ where: { id: { in: appIds } } });
    }

    if (file1Id || file2Id) {
      await prisma.storedFile.deleteMany({ where: { id: { in: [file1Id, file2Id] } } });
    }

    await prisma.servicePackage.deleteMany({ where: { name: 'Auth Standard' } });
    await prisma.service.deleteMany({ where: { slug: `m4-svc-${run}` } });
    await prisma.category.deleteMany({ where: { slug: `m4-cat-${run}` } });
    await prisma.user.deleteMany({ where: { email: { contains: run } } });
    await app.close();
  });

  describe('1. Applications Management Routes (AdminApplicationsController)', () => {
    describe('GET /api/admin/applications/staff', () => {
      it('rejects unauthenticated request with 401', async () => {
        await http.get('/api/admin/applications/staff').expect(401);
      });

      it('rejects customer with 403', async () => {
        await http.get('/api/admin/applications/staff').set(as(customer1Token)).expect(403);
      });

      it('rejects support role with 403', async () => {
        await http.get('/api/admin/applications/staff').set(as(supportToken)).expect(403);
      });

      it('allows assigned operations staff (has applications.view_assigned)', async () => {
        await http.get('/api/admin/applications/staff').set(as(assignedOpsToken)).expect(200);
      });

      it('allows admin (has applications.view_all)', async () => {
        await http.get('/api/admin/applications/staff').set(as(adminToken)).expect(200);
      });
    });

    describe('POST /api/admin/applications/bulk-assign', () => {
      it('rejects unauthenticated request with 401', async () => {
        await http.post('/api/admin/applications/bulk-assign').send({ applicationIds: [app1Id], assigneeId: assignedOpsId }).expect(401);
      });

      it('rejects customer with 403', async () => {
        await http.post('/api/admin/applications/bulk-assign').set(as(customer1Token)).send({ applicationIds: [app1Id], assigneeId: assignedOpsId }).expect(403);
      });

      it('rejects support role with 403', async () => {
        await http.post('/api/admin/applications/bulk-assign').set(as(supportToken)).send({ applicationIds: [app1Id], assigneeId: assignedOpsId }).expect(403);
      });

      it('rejects operations staff (missing applications.view_all) with 403', async () => {
        await http.post('/api/admin/applications/bulk-assign').set(as(assignedOpsToken)).send({ applicationIds: [app1Id], assigneeId: assignedOpsId }).expect(403);
      });
    });

    describe('PATCH /api/admin/applications/:id/assignee', () => {
      it('rejects unauthenticated request with 401', async () => {
        await http.patch(`/api/admin/applications/${app1Id}/assignee`).send({ assigneeId: assignedOpsId }).expect(401);
      });

      it('rejects customer with 403', async () => {
        await http.patch(`/api/admin/applications/${app1Id}/assignee`).set(as(customer1Token)).send({ assigneeId: assignedOpsId }).expect(403);
      });

      it('rejects support role with 403', async () => {
        await http.patch(`/api/admin/applications/${app1Id}/assignee`).set(as(supportToken)).send({ assigneeId: assignedOpsId }).expect(403);
      });

      it('rejects operations staff with 403', async () => {
        await http.patch(`/api/admin/applications/${app1Id}/assignee`).set(as(assignedOpsToken)).send({ assigneeId: assignedOpsId }).expect(403);
      });
    });

    describe('POST /api/admin/applications/:id/certificate', () => {
      it('rejects unauthenticated request with 401', async () => {
        await http.post(`/api/admin/applications/${app1Id}/certificate`).send({ certificateNumber: 'CERT-001' }).expect(401);
      });

      it('rejects customer with 403', async () => {
        await http.post(`/api/admin/applications/${app1Id}/certificate`).set(as(customer1Token)).send({ certificateNumber: 'CERT-001' }).expect(403);
      });

      it('rejects support role with 403', async () => {
        await http.post(`/api/admin/applications/${app1Id}/certificate`).set(as(supportToken)).send({ certificateNumber: 'CERT-001' }).expect(403);
      });

      it('rejects operations staff lacking certificates.manage with 403', async () => {
        await http.post(`/api/admin/applications/${app1Id}/certificate`).set(as(assignedOpsToken)).send({ certificateNumber: 'CERT-001' }).expect(403);
      });
    });

    describe('POST /api/admin/applications/:id/status scoping', () => {
      it('rejects unauthenticated request with 401', async () => {
        await http.post(`/api/admin/applications/${app1Id}/status`).send({ to: 'ON_HOLD', note: 'Customer waiting' }).expect(401);
      });

      it('rejects customer with 403', async () => {
        await http.post(`/api/admin/applications/${app1Id}/status`).set(as(customer1Token)).send({ to: 'ON_HOLD', note: 'Customer waiting' }).expect(403);
      });

      it('rejects support role with 403', async () => {
        await http.post(`/api/admin/applications/${app1Id}/status`).set(as(supportToken)).send({ to: 'ON_HOLD', note: 'Customer waiting' }).expect(403);
      });

      it('returns 404 to unassigned operations staff on application they do not own', async () => {
        await http.post(`/api/admin/applications/${app1Id}/status`).set(as(unassignedOpsToken)).send({ to: 'ON_HOLD', note: 'Customer waiting' }).expect(404);
      });
    });

    describe('GET /api/admin/applications/:id scoping', () => {
      it('rejects unauthenticated request with 401', async () => {
        await http.get(`/api/admin/applications/${app1Id}`).expect(401);
      });

      it('rejects customer with 403', async () => {
        await http.get(`/api/admin/applications/${app1Id}`).set(as(customer1Token)).expect(403);
      });

      it('rejects support role with 403', async () => {
        await http.get(`/api/admin/applications/${app1Id}`).set(as(supportToken)).expect(403);
      });

      it('returns 404 to unassigned operations staff', async () => {
        await http.get(`/api/admin/applications/${app1Id}`).set(as(unassignedOpsToken)).expect(404);
      });

      it('allows assigned operations staff', async () => {
        await http.get(`/api/admin/applications/${app1Id}`).set(as(assignedOpsToken)).expect(200);
      });
    });
  });

  describe('2. Document Review Queue Routes (AdminApplicationDocumentsController)', () => {
    describe('POST /api/admin/documents/:id/reject', () => {
      it('rejects unauthenticated request with 401', async () => {
        await http.post(`/api/admin/documents/${doc1Id}/reject`).send({ reason: 'Blurry copy' }).expect(401);
      });

      it('rejects customer with 403', async () => {
        await http.post(`/api/admin/documents/${doc1Id}/reject`).set(as(customer1Token)).send({ reason: 'Blurry copy' }).expect(403);
      });

      it('rejects support role with 403', async () => {
        await http.post(`/api/admin/documents/${doc1Id}/reject`).set(as(supportToken)).send({ reason: 'Blurry copy' }).expect(403);
      });

      it('returns 404 when unassigned operations staff attempts to reject', async () => {
        await http.post(`/api/admin/documents/${doc1Id}/reject`).set(as(unassignedOpsToken)).send({ reason: 'Blurry copy' }).expect(404);
      });
    });

    describe('POST /api/admin/applications/:applicationId/documents', () => {
      it('rejects unauthenticated request with 401', async () => {
        await http.post(`/api/admin/applications/${app1Id}/documents`).send({ name: 'Additional Utility Bill' }).expect(401);
      });

      it('rejects customer with 403', async () => {
        await http.post(`/api/admin/applications/${app1Id}/documents`).set(as(customer1Token)).send({ name: 'Additional Utility Bill' }).expect(403);
      });

      it('rejects support role with 403', async () => {
        await http.post(`/api/admin/applications/${app1Id}/documents`).set(as(supportToken)).send({ name: 'Additional Utility Bill' }).expect(403);
      });

      it('returns 404 when unassigned operations staff attempts to request document', async () => {
        await http.post(`/api/admin/applications/${app1Id}/documents`).set(as(unassignedOpsToken)).send({ name: 'Additional Utility Bill' }).expect(404);
      });
    });
  });

  describe('3. Internal Notes Routes (InternalNotesController)', () => {
    describe('GET /api/admin/applications/:applicationId/notes', () => {
      it('rejects unauthenticated request with 401', async () => {
        await http.get(`/api/admin/applications/${app1Id}/notes`).expect(401);
      });

      it('rejects customer with 403', async () => {
        await http.get(`/api/admin/applications/${app1Id}/notes`).set(as(customer1Token)).expect(403);
      });

      it('rejects support role with 403', async () => {
        await http.get(`/api/admin/applications/${app1Id}/notes`).set(as(supportToken)).expect(403);
      });

      it('returns 404 to unassigned operations staff', async () => {
        await http.get(`/api/admin/applications/${app1Id}/notes`).set(as(unassignedOpsToken)).expect(404);
      });

      it('allows assigned operations staff', async () => {
        const res = await http.get(`/api/admin/applications/${app1Id}/notes`).set(as(assignedOpsToken)).expect(200);
        expect(res.body).toHaveLength(1);
      });
    });

    describe('POST /api/admin/applications/:applicationId/notes', () => {
      it('rejects unauthenticated request with 401', async () => {
        await http.post(`/api/admin/applications/${app1Id}/notes`).send({ content: 'Unauth note' }).expect(401);
      });

      it('rejects customer with 403', async () => {
        await http.post(`/api/admin/applications/${app1Id}/notes`).set(as(customer1Token)).send({ content: 'Customer hack' }).expect(403);
      });

      it('rejects support role with 403', async () => {
        await http.post(`/api/admin/applications/${app1Id}/notes`).set(as(supportToken)).send({ content: 'Support note' }).expect(403);
      });

      it('returns 404 to unassigned operations staff', async () => {
        await http.post(`/api/admin/applications/${app1Id}/notes`).set(as(unassignedOpsToken)).send({ content: 'Sneak note' }).expect(404);
      });
    });

    describe('PUT /api/admin/applications/:applicationId/notes/:id', () => {
      it('rejects unauthenticated request with 401', async () => {
        await http.put(`/api/admin/applications/${app1Id}/notes/${note1Id}`).send({ content: 'Edited unauth' }).expect(401);
      });

      it('rejects customer with 403', async () => {
        await http.put(`/api/admin/applications/${app1Id}/notes/${note1Id}`).set(as(customer1Token)).send({ content: 'Customer edit' }).expect(403);
      });

      it('rejects support role with 403', async () => {
        await http.put(`/api/admin/applications/${app1Id}/notes/${note1Id}`).set(as(supportToken)).send({ content: 'Support edit' }).expect(403);
      });

      it('returns 404 to unassigned operations staff', async () => {
        await http.put(`/api/admin/applications/${app1Id}/notes/${note1Id}`).set(as(unassignedOpsToken)).send({ content: 'Ops edit' }).expect(404);
      });
    });

    describe('DELETE /api/admin/applications/:applicationId/notes/:id', () => {
      it('rejects unauthenticated request with 401', async () => {
        await http.delete(`/api/admin/applications/${app1Id}/notes/${note1Id}`).expect(401);
      });

      it('rejects customer with 403', async () => {
        await http.delete(`/api/admin/applications/${app1Id}/notes/${note1Id}`).set(as(customer1Token)).expect(403);
      });

      it('rejects support role with 403', async () => {
        await http.delete(`/api/admin/applications/${app1Id}/notes/${note1Id}`).set(as(supportToken)).expect(403);
      });

      it('returns 404 to unassigned operations staff', async () => {
        await http.delete(`/api/admin/applications/${app1Id}/notes/${note1Id}`).set(as(unassignedOpsToken)).expect(404);
      });
    });
  });

  describe('4. Final Deliverables Routes (DeliverablesController)', () => {
    describe('POST /api/admin/applications/:applicationId/deliverables', () => {
      it('rejects unauthenticated request with 401', async () => {
        await http.post(`/api/admin/applications/${app1Id}/deliverables`).send({ title: 'Report', fileId: file2Id }).expect(401);
      });

      it('rejects customer with 403', async () => {
        await http.post(`/api/admin/applications/${app1Id}/deliverables`).set(as(customer1Token)).send({ title: 'Report', fileId: file2Id }).expect(403);
      });

      it('rejects support role with 403', async () => {
        await http.post(`/api/admin/applications/${app1Id}/deliverables`).set(as(supportToken)).send({ title: 'Report', fileId: file2Id }).expect(403);
      });

      it('returns 404 when unassigned operations staff attempts to add deliverable', async () => {
        await http.post(`/api/admin/applications/${app1Id}/deliverables`).set(as(unassignedOpsToken)).send({ title: 'Report', fileId: file2Id }).expect(404);
      });
    });

    describe('GET /api/admin/applications/:applicationId/deliverables', () => {
      it('rejects unauthenticated request with 401', async () => {
        await http.get(`/api/admin/applications/${app1Id}/deliverables`).expect(401);
      });

      it('rejects customer with 403', async () => {
        await http.get(`/api/admin/applications/${app1Id}/deliverables`).set(as(customer1Token)).expect(403);
      });

      it('rejects support role with 403', async () => {
        await http.get(`/api/admin/applications/${app1Id}/deliverables`).set(as(supportToken)).expect(403);
      });

      it('returns 404 to unassigned operations staff', async () => {
        await http.get(`/api/admin/applications/${app1Id}/deliverables`).set(as(unassignedOpsToken)).expect(404);
      });

      it('allows assigned operations staff', async () => {
        const res = await http.get(`/api/admin/applications/${app1Id}/deliverables`).set(as(assignedOpsToken)).expect(200);
        expect(res.body).toHaveLength(1);
      });
    });

    describe('GET /api/applications/:id/deliverables (Customer)', () => {
      it('rejects unauthenticated request with 401', async () => {
        await http.get(`/api/applications/${app1Id}/deliverables`).expect(401);
      });

      it('returns 404 to a different customer (Customer 2 cannot see Customer 1 deliverables)', async () => {
        await http.get(`/api/applications/${app1Id}/deliverables`).set(as(customer2Token)).expect(404);
      });

      it('allows owning customer (Customer 1)', async () => {
        const res = await http.get(`/api/applications/${app1Id}/deliverables`).set(as(customer1Token)).expect(200);
        expect(res.body).toHaveLength(1);
        expect(res.body[0].title).toBe('Completion Report');
      });
    });
  });

  describe('5. Customer Isolation (ApplicationsController)', () => {
    describe('GET /api/applications/:id', () => {
      it('returns 404 when Customer 2 tries to access Customer 1 application', async () => {
        await http.get(`/api/applications/${app1Id}`).set(as(customer2Token)).expect(404);
      });

      it('returns 200 to Customer 1 for own application', async () => {
        await http.get(`/api/applications/${app1Id}`).set(as(customer1Token)).expect(200);
      });
    });

    describe('GET /api/applications/:id/timeline', () => {
      it('returns 404 when Customer 2 tries to access Customer 1 timeline', async () => {
        await http.get(`/api/applications/${app1Id}/timeline`).set(as(customer2Token)).expect(404);
      });

      it('returns 200 to Customer 1 for own timeline', async () => {
        await http.get(`/api/applications/${app1Id}/timeline`).set(as(customer1Token)).expect(200);
      });
    });
  });
});
