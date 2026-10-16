import { randomBytes } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import {
  customerApplicationListSchema,
  formatApplicationCode,
  formatOrderCode,
  GENERIC_SERVICE_FORM,
} from '@biznexa/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Customer My Services API (M5.3)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  const runId = randomBytes(4).toString('hex');
  const numSuffix = (parseInt(runId.slice(0, 7), 16) % 9000000) + 1000000;

  let aliceToken: string;
  let aliceId: string;
  let bobToken: string;
  let bobId: string;

  let serviceId: string;
  let packageId: string;
  let requirementId: string;

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
        formSchemas: {
          create: [{ version: 1, schema: JSON.parse(JSON.stringify(GENERIC_SERVICE_FORM)), isCurrent: true }],
        },
      },
      select: {
        id: true,
        packages: { select: { id: true } },
        documents: { select: { id: true } },
      },
    });
    serviceId = svc.id;
    packageId = svc.packages[0].id;
    requirementId = svc.documents[0].id;

    const baseSeq = (parseInt(runId, 16) % 800000) + 100000;

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
    }) {
      const order = await prisma.order.create({
        data: {
          code: formatOrderCode(baseSeq + opts.seqOffset),
          customerId: opts.customerId,
          subtotal: opts.total,
          total: opts.total,
          amountPaid: opts.amountPaid,
          status: opts.amountPaid >= opts.total ? 'PAID' : opts.amountPaid > 0 ? 'PARTIALLY_PAID' : 'CREATED',
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

    // 4. Alice IN_PROGRESS fully paid -> nextAction: 'view'
    await seedApp({
      customerId: aliceId,
      seqOffset: 4,
      status: 'IN_PROGRESS',
      total: 118000,
      amountPaid: 118000,
      withUploadedDoc: true,
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

    // Ensure DRAFT, COMPLETED, CANCELLED, and Bob's application are not present
    const statuses = parsed.items.map((i) => i.status);
    expect(statuses).not.toContain('DRAFT');
    expect(statuses).not.toContain('COMPLETED');
    expect(statuses).not.toContain('CANCELLED');

    const actions = parsed.items.map((i) => i.nextAction).sort();
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
});
