import { randomBytes } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import {
  customerApplicationListSchema,
  customerApplicationTimelineSchema,
  dashboardSummarySchema,
  formatApplicationCode,
  formatOrderCode,
  GENERIC_SERVICE_FORM,
} from '@biznexa/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { ApplicationDocumentsService } from '../src/applications/application-documents.service';

/** The order status that matches what has been paid so far. */
function orderStatusFor(amountPaid: number, total: number) {
  if (amountPaid >= total) return 'PAID' as const;
  if (amountPaid > 0) return 'PARTIALLY_PAID' as const;
  return 'CREATED' as const;
}

describe('Customer Applications API (M5.3 My Services & M5.4 Timeline)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  const runId = randomBytes(4).toString('hex');
  const numSuffix = (Number.parseInt(runId.slice(0, 7), 16) % 9000000) + 1000000;

  let aliceToken: string;
  let aliceId: string;
  let bobToken: string;
  let bobId: string;

  let serviceId: string;
  let packageId: string;
  let requirementId: string;
  let stageIds: string[] = [];
  let aliceInProgressAppId: string;

  const createdAppIds: string[] = [];
  const createdOrderIds: string[] = [];
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
    await app.init();
    prisma = app.get(PrismaService);

    const server = app.getHttpServer();

    const regAlice = await request(server)
      .post('/api/auth/register')
      .send({
        name: `Alice ${runId}`,
        mobile: `71${numSuffix}1`.slice(0, 10),
        email: `alice-mysvc-${runId}@example.com`,
        password: 'Password123!',
        consent: true,
      })
      .expect(201);
    aliceToken = regAlice.body.accessToken;
    aliceId = regAlice.body.user.id;
    createdUserIds.push(aliceId);

    const regBob = await request(server)
      .post('/api/auth/register')
      .send({
        name: `Bob ${runId}`,
        mobile: `72${numSuffix}2`.slice(0, 10),
        email: `bob-mysvc-${runId}@example.com`,
        password: 'Password123!',
        consent: true,
      })
      .expect(201);
    bobToken = regBob.body.accessToken;
    bobId = regBob.body.user.id;
    createdUserIds.push(bobId);

    const cat = await prisma.category.findUniqueOrThrow({ where: { slug: 'licenses' } });
    const svc = await prisma.service.create({
      data: {
        slug: `e2e-mysvc-${runId}`,
        categoryId: cat.id,
        name: `My Services Test ${runId}`,
        shortDescription: 'Service for testing My Services list.',
        packages: { create: [{ name: 'Standard', professionalFee: 100000 }] },
        documents: {
          create: [{ name: 'PAN Card', isMandatory: true, sortOrder: 1 }],
        },
        stages: {
          create: [
            { name: 'Document Verification', description: 'Checking uploaded documents', sortOrder: 1 },
            { name: 'Application Filing', description: 'Filing with authority', sortOrder: 2 },
            { name: 'Certificate Delivery', description: 'Delivering final certificate', sortOrder: 3 },
          ],
        },
        formSchemas: {
          create: [{ version: 1, schema: structuredClone(GENERIC_SERVICE_FORM), isCurrent: true }],
        },
      },
      select: {
        id: true,
        packages: { select: { id: true } },
        documents: { select: { id: true } },
        stages: { select: { id: true, sortOrder: true }, orderBy: { sortOrder: 'asc' } },
      },
    });
    serviceId = svc.id;
    packageId = svc.packages[0].id;
    requirementId = svc.documents[0].id;
    stageIds = svc.stages.map((s) => s.id);

    const baseSeq = (Number.parseInt(runId, 16) % 800000) + 100000;

    async function seedApp(opts: {
      customerId: string;
      seqOffset: number;
      status:
        | 'DRAFT'
        | 'SUBMITTED'
        | 'DOCUMENTS_PENDING'
        | 'IN_PROGRESS'
        | 'COMPLETED'
        | 'DELIVERED'
        | 'CANCELLED';
      total: number;
      amountPaid: number;
      withUploadedDoc?: boolean;
      currentStageId?: string;
    }) {
      const order = await prisma.order.create({
        data: {
          code: formatOrderCode(baseSeq + opts.seqOffset),
          customerId: opts.customerId,
          subtotal: opts.total,
          total: opts.total,
          amountPaid: opts.amountPaid,
          status: orderStatusFor(opts.amountPaid, opts.total),
        },
      });
      createdOrderIds.push(order.id);

      const createdApp = await prisma.application.create({
        data: {
          code: formatApplicationCode(baseSeq + opts.seqOffset),
          orderId: order.id,
          customerId: opts.customerId,
          serviceId,
          packageId,
          formSchemaVersion: 1,
          status: opts.status,
          currentStageId: opts.currentStageId,
        },
      });
      createdAppIds.push(createdApp.id);

      if (opts.withUploadedDoc) {
        const sf = await prisma.storedFile.create({
          data: {
            fileKey: `e2e-mysvc-${runId}-${opts.seqOffset}`,
            ownerId: opts.customerId,
            requirementId,
            originalName: 'pan.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 1024,
            sha256: '0'.repeat(64),
            scanStatus: 'CLEAN',
          },
        });
        await prisma.applicationDocument.create({
          data: {
            applicationId: createdApp.id,
            requirementId,
            name: 'PAN Card',
            fileKey: sf.fileKey,
            fileName: 'pan.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 1024,
            version: 1,
            isLatest: true,
            status: 'APPROVED',
            uploadedAt: new Date(),
          },
        });
      }

      return createdApp;
    }

    // 1. Alice DRAFT (must not appear in any tab)
    await seedApp({
      customerId: aliceId,
      seqOffset: 1,
      status: 'DRAFT',
      total: 118000,
      amountPaid: 0,
    });

    // 2. Alice DOCUMENTS_PENDING -> nextAction: 'upload_documents'
    await seedApp({
      customerId: aliceId,
      seqOffset: 2,
      status: 'DOCUMENTS_PENDING',
      total: 118000,
      amountPaid: 118000,
      withUploadedDoc: false,
    });

    // 3. Alice IN_PROGRESS with balance due -> nextAction: 'pay_balance'
    await seedApp({
      customerId: aliceId,
      seqOffset: 3,
      status: 'IN_PROGRESS',
      total: 118000,
      amountPaid: 59000,
      withUploadedDoc: true,
    });

    // 4. Alice IN_PROGRESS fully paid -> nextAction: 'view', at stage 2 (index 1)
    const app4 = await seedApp({
      customerId: aliceId,
      seqOffset: 4,
      status: 'IN_PROGRESS',
      total: 118000,
      amountPaid: 118000,
      withUploadedDoc: true,
      currentStageId: stageIds[1],
    });
    aliceInProgressAppId = app4.id;

    // Seed visible and hidden history rows + an internal note on app4
    await prisma.applicationStageHistory.createMany({
      data: [
        {
          applicationId: app4.id,
          stageId: stageIds[0],
          status: 'DOCUMENTS_APPROVED',
          note: 'Customer visible: documents verified',
          visibleToCustomer: true,
          changedAt: new Date(Date.now() - 60_000),
        },
        {
          applicationId: app4.id,
          stageId: stageIds[1],
          status: 'IN_PROGRESS',
          note: 'SECRET STAFF HISTORY NOTE',
          visibleToCustomer: false,
          changedAt: new Date(Date.now() - 30_000),
        },
        {
          applicationId: app4.id,
          stageId: stageIds[1],
          status: 'IN_PROGRESS',
          note: 'Customer visible: filing started with portal',
          visibleToCustomer: true,
          changedAt: new Date(),
        },
      ],
    });

    await prisma.internalNote.create({
      data: {
        applicationId: app4.id,
        authorId: aliceId,
        body: 'TOP SECRET INTERNAL NOTE',
      },
    });

    // 5. Alice COMPLETED -> tab=completed, nextAction: 'download'
    await seedApp({
      customerId: aliceId,
      seqOffset: 5,
      status: 'COMPLETED',
      total: 118000,
      amountPaid: 118000,
      withUploadedDoc: true,
    });

    // 6. Alice CANCELLED -> tab=cancelled, nextAction: 'view'
    await seedApp({
      customerId: aliceId,
      seqOffset: 6,
      status: 'CANCELLED',
      total: 118000,
      amountPaid: 0,
    });

    // 7. Bob SUBMITTED -> must never appear for Alice
    await seedApp({
      customerId: bobId,
      seqOffset: 7,
      status: 'SUBMITTED',
      total: 118000,
      amountPaid: 118000,
    });
  });

  afterAll(async () => {
    try {
      if (prisma) {
        await prisma.internalNote.deleteMany({
          where: { applicationId: { in: createdAppIds } },
        });
        await prisma.applicationStageHistory.deleteMany({
          where: { applicationId: { in: createdAppIds } },
        });
        await prisma.applicationDocument.deleteMany({
          where: { applicationId: { in: createdAppIds } },
        });
        await prisma.storedFile.deleteMany({
          where: { ownerId: { in: createdUserIds } },
        });
        await prisma.application.deleteMany({
          where: { id: { in: createdAppIds } },
        });
        await prisma.order.deleteMany({
          where: { id: { in: createdOrderIds } },
        });
        if (serviceId) {
          await prisma.service.deleteMany({ where: { id: serviceId } });
        }
        await prisma.user.deleteMany({
          where: { id: { in: createdUserIds } },
        });
      }
    } finally {
      if (app) {
        await app.close();
      }
    }
  });

  it('rejects unauthenticated requests with 401', async () => {
    await request(app.getHttpServer()).get('/api/applications').expect(401);
  });

  it('lists only the customer’s active non-DRAFT applications by default with derived nextAction', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/applications')
      .set('Authorization', `Bearer ${aliceToken}`)
      .expect(200);

    const parsed = customerApplicationListSchema.parse(res.body);
    expect(parsed.total).toBe(3);
    expect(parsed.items).toHaveLength(3);

    const statuses = parsed.items.map((i) => i.status);
    expect(statuses).not.toContain('DRAFT');
    expect(statuses).not.toContain('COMPLETED');
    expect(statuses).not.toContain('CANCELLED');

    const actions = parsed.items.map((i) => i.nextAction).sort((a, b) => a.localeCompare(b));
    expect(actions).toEqual(['pay_balance', 'upload_documents', 'view']);
  });

  it('lists completed applications on tab=completed with nextAction=download', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/applications?tab=completed')
      .set('Authorization', `Bearer ${aliceToken}`)
      .expect(200);

    const parsed = customerApplicationListSchema.parse(res.body);
    expect(parsed.total).toBe(1);
    expect(parsed.items[0].status).toBe('COMPLETED');
    expect(parsed.items[0].nextAction).toBe('download');
  });

  it('lists cancelled applications on tab=cancelled with nextAction=view', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/applications?tab=cancelled')
      .set('Authorization', `Bearer ${aliceToken}`)
      .expect(200);

    const parsed = customerApplicationListSchema.parse(res.body);
    expect(parsed.total).toBe(1);
    expect(parsed.items[0].status).toBe('CANCELLED');
    expect(parsed.items[0].nextAction).toBe('view');
  });

  it('isolates data between customers', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/applications')
      .set('Authorization', `Bearer ${bobToken}`)
      .expect(200);

    const parsed = customerApplicationListSchema.parse(res.body);
    expect(parsed.total).toBe(1);
    expect(parsed.items[0].status).toBe('SUBMITTED');
    expect(parsed.items[0].nextAction).toBe('upload_documents');
  });

  describe('pendingMandatoryMany query count', () => {
    it('executes a constant number of queries regardless of application count', async () => {
      const apps = await prisma.application.findMany({
        where: { id: { in: createdAppIds } },
        select: { id: true, status: true, serviceId: true, packageId: true },
        take: 2,
      });
      const apps10 = await prisma.application.findMany({
        where: { id: { in: createdAppIds } },
        select: { id: true, status: true, serviceId: true, packageId: true },
        take: 10,
      });

      const docsService = app.get(ApplicationDocumentsService);

      const spyReq = jest.spyOn(prisma.serviceDocumentRequirement, 'findMany');
      const spyDoc = jest.spyOn(prisma.applicationDocument, 'findMany');

      spyReq.mockClear();
      spyDoc.mockClear();

      await docsService.pendingMandatoryMany(apps);
      const queryCount2 = spyReq.mock.calls.length + spyDoc.mock.calls.length;
      expect(queryCount2).toBeGreaterThan(0);

      spyReq.mockClear();
      spyDoc.mockClear();

      const result10 = await docsService.pendingMandatoryMany(apps10);
      const queryCount10 = spyReq.mock.calls.length + spyDoc.mock.calls.length;

      expect(queryCount10).toBe(queryCount2);

      // Verify identical results one by one vs many
      for (const a of apps10) {
        const one = await docsService.pendingMandatory(a); // NOSONAR: tests run steps in order
        expect(result10.get(a.id)).toBe(one);
      }
    });
  });

  it('uses batched checklist counts in the dashboard without changing summary values', async () => {
    const documents = app.get(ApplicationDocumentsService);
    const batchSpy = jest.spyOn(documents, 'pendingMandatoryMany');
    const response = await request(app.getHttpServer())
      .get('/api/dashboard/summary')
      .set('Authorization', `Bearer ${aliceToken}`)
      .expect(200);

    const summary = dashboardSummarySchema.parse(response.body);
    expect(summary).toMatchObject({ activeApplications: 3, pendingActions: 3, unpaidBalance: 59000 });
    expect(summary.recentActivity).toHaveLength(2);
    expect(batchSpy).toHaveBeenCalledTimes(1);
    expect(batchSpy.mock.calls[0][0]).toHaveLength(2);
    batchSpy.mockRestore();
  });

  describe('GET /api/applications/:id/timeline (M5.4)', () => {
    it('rejects unauthenticated requests with 401', async () => {
      await request(app.getHttpServer())
        .get(`/api/applications/${aliceInProgressAppId}/timeline`)
        .expect(401);
    });

    it('returns 404 when another customer requests the timeline', async () => {
      await request(app.getHttpServer())
        .get(`/api/applications/${aliceInProgressAppId}/timeline`)
        .set('Authorization', `Bearer ${bobToken}`)
        .expect(404);
    });

    it('returns header, stage stepper (done/current/upcoming), and ONLY visibleToCustomer=true history rows', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/applications/${aliceInProgressAppId}/timeline`)
        .set('Authorization', `Bearer ${aliceToken}`)
        .expect(200);

      const parsed = customerApplicationTimelineSchema.parse(res.body);
      expect(parsed.id).toBe(aliceInProgressAppId);
      expect(parsed.serviceName).toBe(`My Services Test ${runId}`);
      expect(parsed.packageName).toBe('Standard');
      expect(parsed.status).toBe('IN_PROGRESS');

      expect(parsed.stages).toHaveLength(3);
      expect(parsed.stages[0].state).toBe('done');
      expect(parsed.stages[0].reachedAt).not.toBeNull();
      expect(parsed.stages[1].state).toBe('current');
      expect(parsed.stages[1].reachedAt).not.toBeNull();
      expect(parsed.stages[2].state).toBe('upcoming');
      expect(parsed.stages[2].reachedAt).toBeNull();

      // Only visibleToCustomer = true rows returned; hidden note and internal notes never present
      expect(parsed.history).toHaveLength(2);
      const notes = parsed.history.map((h) => h.note);
      expect(notes).toContain('Customer visible: documents verified');
      expect(notes).toContain('Customer visible: filing started with portal');
      expect(notes).not.toContain('SECRET STAFF HISTORY NOTE');
      expect(JSON.stringify(res.body)).not.toContain('SECRET STAFF HISTORY NOTE');
      expect(JSON.stringify(res.body)).not.toContain('TOP SECRET INTERNAL NOTE');
    });
  });
});
