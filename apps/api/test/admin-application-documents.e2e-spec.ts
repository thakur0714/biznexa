import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { staffSession } from './staff';
import type { ApplicationStatus } from '@biznexa/types';

describe('Admin Application Documents (M4.8)', () => {
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;
  let prisma: PrismaService;
  let serviceId: string;
  let packageId: string;
  let requirementId: string;
  let customerId: string;
  let adminId: string;
  let opsId: string;
  let supportId: string;

  let adminToken: string;
  let opsToken: string;
  let supportToken: string;
  let customerToken: string;

  const run = Date.now().toString().slice(-7) + Math.floor(Math.random() * 900 + 100);
  const P = `BNDOC${run}`;

  let createdService = false;
  let createdPackage = false;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();

    http = request(app.getHttpServer());
    prisma = app.get(PrismaService);

    // Create users
    const adminSess = await staffSession(http, prisma, 'ADMIN', `admin-${run}@example.com`);
    adminToken = adminSess.accessToken;
    adminId = (await prisma.user.findUniqueOrThrow({ where: { email: `admin-${run}@example.com` } })).id;

    const opsSess = await staffSession(http, prisma, 'OPERATIONS', `ops-${run}@example.com`);
    opsToken = opsSess.accessToken;
    opsId = (await prisma.user.findUniqueOrThrow({ where: { email: `ops-${run}@example.com` } })).id;

    const supportSess = await staffSession(http, prisma, 'SUPPORT', `support-${run}@example.com`);
    supportToken = supportSess.accessToken;
    supportId = (await prisma.user.findUniqueOrThrow({ where: { email: `support-${run}@example.com` } })).id;

    // Login for customer token
    const customerLogin = await http.post('/api/auth/register').send({
      name: `Customer ${run}`,
      email: `customer-${run}@example.com`,
      mobile: `9${run.padStart(9, '0')}`.substring(0, 10),
      password: 'Password@123',
      consent: true,
    }).expect(201);

    customerToken = customerLogin.body.accessToken;
    customerId = customerLogin.body.user.id;

    const existingPkg = await prisma.servicePackage.findFirst({
      include: { service: { select: { id: true, categoryId: true } } },
    });

    if (existingPkg) {
      serviceId = existingPkg.serviceId;
      packageId = existingPkg.id;
    } else {
      let category = await prisma.category.findFirst();
      if (!category) {
        category = await prisma.category.create({ data: { name: 'Test Category', slug: 'test-cat-' + run } });
      }

      const srv = await prisma.service.create({
        data: {
          name: 'M4.8 Test Service',
          slug: 'm48-test-service-' + run,
          categoryId: category.id,
          shortDescription: 'desc',
        }
      });
      serviceId = srv.id;
      createdService = true;

      const pkg = await prisma.servicePackage.create({
        data: {
          serviceId,
          name: 'Basic',
          professionalFee: 1000,
          governmentFee: 0,
        }
      });
      packageId = pkg.id;
      createdPackage = true;
    }

    const req = await prisma.serviceDocumentRequirement.create({
      data: {
        serviceId,
        name: 'Mandatory Doc',
        isMandatory: true,
        sortOrder: 1,
      }
    });
    requirementId = req.id;
  });

  afterAll(async () => {
    const apps = (await prisma.application.findMany({ where: { code: { startsWith: P } }, select: { id: true } })).map((a) => a.id);
    await prisma.applicationDocument.deleteMany({ where: { applicationId: { in: apps } } });
    await prisma.applicationStageHistory.deleteMany({ where: { applicationId: { in: apps } } });
    await prisma.application.deleteMany({ where: { id: { in: apps } } });

    await prisma.storedFile.deleteMany({ where: { ownerId: customerId } });
    await prisma.serviceDocumentRequirement.deleteMany({ where: { id: requirementId } });

    if (createdPackage) {
      await prisma.servicePackage.deleteMany({ where: { id: packageId } });
    }
    if (createdService) {
      await prisma.service.deleteMany({ where: { id: serviceId } });
    }

    await prisma.user.deleteMany({ where: { email: { contains: `-${run}@example.com` } } });

    await app.close();
  });

  const createTestApp = async (n: number, status: ApplicationStatus, assignedToId: string | null = null) => {
    return prisma.application.create({
      data: {
        customerId,
        serviceId,
        packageId,
        status,
        code: `${P}${n}`,
        assignedToId,
      }
    });
  };

  const createTestDoc = async (appId: string, status: any = 'UPLOADED', uploadedAtOffset: number = 0) => {
    const fKey = 'test-key-' + Math.random();
    await prisma.storedFile.create({
      data: {
        fileKey: fKey,
        ownerId: customerId,
        requirementId,
        originalName: 'test.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 100,
        sha256: 'abcde' + Math.random(),
      }
    });

    return prisma.applicationDocument.create({
      data: {
        applicationId: appId,
        requirementId,
        name: 'Mandatory Doc',
        status,
        version: 1,
        isLatest: true,
        fileKey: fKey,
        fileName: 'test.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 100,
        uploadedAt: new Date(Date.now() + uploadedAtOffset),
      }
    });
  };

  it('lists uploaded documents waiting for review, oldest first, with paging', async () => {
    const a1 = await createTestApp(1, 'DOCUMENTS_UNDER_REVIEW');
    const a2 = await createTestApp(2, 'DOCUMENTS_UNDER_REVIEW');
    const d1 = await createTestDoc(a1.id, 'UPLOADED', -10000);
    const d2 = await createTestDoc(a2.id, 'UPLOADED', 0);

    const res = await http.get('/api/admin/documents/review-queue')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.items.length).toBeGreaterThanOrEqual(2);
    const d1Item = res.body.items.find((d: any) => d.id === d1.id);
    const d2Item = res.body.items.find((d: any) => d.id === d2.id);
    expect(d1Item).toBeDefined();
    expect(d2Item).toBeDefined();

    const d1Idx = res.body.items.indexOf(d1Item);
    const d2Idx = res.body.items.indexOf(d2Item);
    expect(d1Idx).toBeLessThan(d2Idx); // oldest first
  });

  it('unassigned ops -> 404/empty for review queue, customer -> 403', async () => {
    const app2 = await createTestApp(3, 'DOCUMENTS_UNDER_REVIEW', adminId); // Assigned to someone else
    const d1 = await createTestDoc(app2.id);

    const resOps = await http.get('/api/admin/documents/review-queue')
      .set('Authorization', `Bearer ${opsToken}`)
      .expect(200);
    expect(resOps.body.items.some((d: any) => d.id === d1.id)).toBeFalsy(); // Should not see it

    await http.get('/api/admin/documents/review-queue')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(403);
  });

  it('approve works; all approved -> DOCUMENTS_APPROVED', async () => {
    const a = await createTestApp(4, 'DOCUMENTS_UNDER_REVIEW');
    const d = await createTestDoc(a.id);

    await http.post(`/api/admin/documents/${d.id}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);

    const updatedApp = await prisma.application.findUnique({ where: { id: a.id } });
    expect(updatedApp?.status).toBe('DOCUMENTS_APPROVED');

    const updatedDoc = await prisma.applicationDocument.findUnique({ where: { id: d.id } });
    expect(updatedDoc?.status).toBe('APPROVED');
  });

  it('support cannot approve -> 403', async () => {
    const a = await createTestApp(5, 'DOCUMENTS_UNDER_REVIEW');
    const d = await createTestDoc(a.id);

    await http.post(`/api/admin/documents/${d.id}/approve`)
      .set('Authorization', `Bearer ${supportToken}`)
      .expect(403);
  });

  it('reject without reason -> 400; reject -> DOCUMENTS_PENDING', async () => {
    const a = await createTestApp(6, 'DOCUMENTS_UNDER_REVIEW');
    const d = await createTestDoc(a.id);

    await http.post(`/api/admin/documents/${d.id}/reject`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({})
      .expect(400);

    await http.post(`/api/admin/documents/${d.id}/reject`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Blurry' })
      .expect(201);

    const updatedApp = await prisma.application.findUnique({ where: { id: a.id } });
    expect(updatedApp?.status).toBe('DOCUMENTS_PENDING');

    const updatedDoc = await prisma.applicationDocument.findUnique({ where: { id: d.id } });
    expect(updatedDoc?.status).toBe('REJECTED');
    expect(updatedDoc?.rejectionReason).toBe('Blurry');
  });

  it('request an additional document for an application', async () => {
    const a = await createTestApp(7, 'DOCUMENTS_APPROVED');

    await http.post(`/api/admin/applications/${a.id}/documents`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Extra ID' })
      .expect(201);

    const extraDocs = await prisma.applicationDocument.findMany({
      where: { applicationId: a.id, name: 'Extra ID' }
    });
    expect(extraDocs.length).toBe(1);
    expect(extraDocs[0].status).toBe('REQUIRED');

    // Because a document is REQUIRED, application should move to DOCUMENTS_PENDING
    const updatedApp = await prisma.application.findUnique({ where: { id: a.id } });
    expect(updatedApp?.status).toBe('DOCUMENTS_PENDING');
  });
});
