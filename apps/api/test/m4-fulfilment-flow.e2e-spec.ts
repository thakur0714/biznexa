import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { GENERIC_SERVICE_FORM } from '@biznexa/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { staffSession } from './staff';

describe('M4.17 fulfilment integration flow', () => {
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;
  let prisma: PrismaService;
  const run = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const prefix = `BNM417${run.replaceAll(/\D/g, '')}`;
  let customerId = '';
  let opsId = '';
  let customerToken = '';
  let opsToken = '';
  let applicationId = '';
  let serviceId = '';
  let packageId = '';
  let requirementId = '';
  const fileIds: string[] = [];

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    http = request(app.getHttpServer());
    prisma = app.get(PrismaService);

    opsToken = (await staffSession(http, prisma, 'OPERATIONS', `m417-ops-${run}@example.com`)).accessToken;
    opsId = (await prisma.user.findUniqueOrThrow({ where: { email: `m417-ops-${run}@example.com` } })).id;
    const customer = await http.post('/api/auth/register').send({
      name: `M4.17 Customer ${run}`,
      email: `m417-customer-${run}@example.com`,
      mobile: `8${run.replaceAll(/\D/g, '').slice(-9).padStart(9, '0')}`,
      password: 'Password@123',
      consent: true,
    }).expect(201);
    customerId = customer.body.user.id as string;
    customerToken = customer.body.accessToken as string;

    const category = await prisma.category.create({ data: { name: `M4.17 ${run}`, slug: `m417-${run}` } });
    const service = await prisma.service.create({
      data: {
        name: `M4.17 ${run}`, slug: `m417-service-${run}`, categoryId: category.id,
        shortDescription: 'Fulfilment integration',
        formSchemas: { create: [{ version: 1, schema: GENERIC_SERVICE_FORM as object, isCurrent: true }] },
      },
    });
    serviceId = service.id;
    const pkg = await prisma.servicePackage.create({ data: { serviceId, name: `M4.17 ${run}`, professionalFee: 1000, governmentFee: 0, gstRate: 18 } });
    packageId = pkg.id;
    const requirement = await prisma.serviceDocumentRequirement.create({ data: { serviceId, name: 'Identity proof', isMandatory: true, sortOrder: 1 } });
    requirementId = requirement.id;
    const application = await prisma.application.create({
      data: {
        code: `${prefix}-1`, customerId, serviceId, packageId,
        status: 'DOCUMENTS_UNDER_REVIEW', assignedToId: opsId, formSchemaVersion: 1,
      },
    });
    applicationId = application.id;
    await makeFile(customerId, `initial-${run}.pdf`);
    const firstFile = await prisma.storedFile.findFirstOrThrow({ where: { ownerId: customerId, originalName: `initial-${run}.pdf` } });
    await prisma.applicationDocument.create({
      data: {
        applicationId, requirementId, name: 'Identity proof', status: 'UPLOADED', version: 1,
        isLatest: true, fileKey: firstFile.fileKey, fileName: firstFile.originalName,
        mimeType: firstFile.mimeType, sizeBytes: firstFile.sizeBytes, uploadedAt: new Date(),
      },
    });
  });

  afterAll(async () => {
    if (applicationId) {
      await prisma.auditLog.deleteMany({ where: { entityType: 'Application', entityId: applicationId } });
      await prisma.auditLog.deleteMany({ where: { entityType: 'ApplicationDocument', entityId: { in: (await prisma.applicationDocument.findMany({ where: { applicationId }, select: { id: true } })).map((d) => d.id) } } });
      await prisma.applicationDocument.deleteMany({ where: { applicationId } });
      await prisma.finalDeliverable.deleteMany({ where: { applicationId } });
      await prisma.applicationStageHistory.deleteMany({ where: { applicationId } });
      await prisma.application.delete({ where: { id: applicationId } });
    }
    await prisma.notification.deleteMany({ where: { userId: customerId } });
    await prisma.storedFile.deleteMany({ where: { id: { in: fileIds } } });
    if (requirementId) await prisma.serviceDocumentRequirement.deleteMany({ where: { id: requirementId } });
    if (packageId) await prisma.servicePackage.deleteMany({ where: { id: packageId } });
    if (serviceId) {
      const service = await prisma.service.findUnique({ where: { id: serviceId }, select: { categoryId: true } });
      await prisma.service.deleteMany({ where: { id: serviceId } });
      if (service) await prisma.category.deleteMany({ where: { id: service.categoryId } });
    }
    await prisma.user.deleteMany({ where: { email: { contains: run } } });
    await app.close();
  });

  async function makeFile(ownerId: string, originalName: string) {
    const file = await prisma.storedFile.create({
      data: {
        fileKey: `m417/${run}/${originalName}`, originalName, mimeType: 'application/pdf',
        sizeBytes: 1024, sha256: `${run.replaceAll(/\D/g, '').padStart(64, '0').slice(-64)}`,
        ownerId, scanStatus: 'CLEAN', ...(ownerId === customerId && requirementId ? { requirementId } : {}),
      },
    });
    fileIds.push(file.id);
    return file;
  }

  async function waitForNotifications(events: string[]) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const rows = await prisma.notification.findMany({ where: { userId: customerId, channel: 'IN_APP', event: { in: events } } }); // NOSONAR: tests run steps in order
      if (events.every((event) => rows.some((row) => row.event === event))) return rows;
      await new Promise((resolve) => setTimeout(resolve, 50)); // NOSONAR: tests run steps in order
    }
    return prisma.notification.findMany({ where: { userId: customerId, channel: 'IN_APP', event: { in: events } } });
  }

  it('rejects, accepts a customer re-upload, approves, progresses and delivers with history, audit and notifications', async () => {
    const document = await prisma.applicationDocument.findFirstOrThrow({ where: { applicationId, isLatest: true } });
    await http.post(`/api/admin/documents/${document.id}/reject`).set('authorization', `Bearer ${opsToken}`).send({ reason: 'Image is unclear' }).expect(201);
    expect((await prisma.application.findUniqueOrThrow({ where: { id: applicationId } })).status).toBe('DOCUMENTS_PENDING');

    const replacement = await makeFile(customerId, `replacement-${run}.pdf`);
    await http.post(`/api/applications/${applicationId}/documents/${requirementId}`)
      .set('authorization', `Bearer ${customerToken}`).send({ fileId: replacement.id }).expect(201);
    const latest = await prisma.applicationDocument.findFirstOrThrow({ where: { applicationId, isLatest: true } });
    expect(latest.version).toBe(2);
    await http.post(`/api/admin/documents/${latest.id}/approve`).set('authorization', `Bearer ${opsToken}`).expect(201);
    await http.post(`/api/admin/applications/${applicationId}/status`).set('authorization', `Bearer ${opsToken}`).send({ to: 'IN_PROGRESS' }).expect(201);

    const deliverableFile = await makeFile(opsId, `deliverable-${run}.pdf`);
    await http.post(`/api/admin/applications/${applicationId}/deliverables`).set('authorization', `Bearer ${opsToken}`)
      .send({ title: 'Completed registration', fileId: deliverableFile.id }).expect(201);
    await http.post(`/api/admin/applications/${applicationId}/status`).set('authorization', `Bearer ${opsToken}`).send({ to: 'COMPLETED' }).expect(201);
    await http.post(`/api/admin/applications/${applicationId}/status`).set('authorization', `Bearer ${opsToken}`).send({ to: 'DELIVERED' }).expect(201);

    const history = await prisma.applicationStageHistory.findMany({ where: { applicationId }, orderBy: { changedAt: 'asc' } });
    expect(history.map((row) => row.status)).toEqual(['DOCUMENTS_PENDING', 'DOCUMENTS_UNDER_REVIEW', 'DOCUMENTS_APPROVED', 'IN_PROGRESS', 'COMPLETED', 'DELIVERED']);
    const audits = await prisma.auditLog.findMany({ where: { entityId: applicationId } });
    expect(audits.map((row) => row.action)).toEqual(expect.arrayContaining(['application.status_change', 'deliverable.add']));
    expect(await prisma.auditLog.count({ where: { entityType: 'ApplicationDocument', entityId: document.id, action: 'document.reject' } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityType: 'ApplicationDocument', entityId: latest.id, action: 'document.approve' } })).toBe(1);
    const notifications = await waitForNotifications(['document.rejected', 'document.approved', 'application.status_changed']);
    expect(notifications.map((row) => row.event)).toEqual(expect.arrayContaining(['document.rejected', 'document.approved', 'application.status_changed']));
    expect(notifications.filter((row) => row.event === 'application.status_changed')).toHaveLength(6);
    expect((await prisma.application.findUniqueOrThrow({ where: { id: applicationId } })).status).toBe('DELIVERED');
  });
});
