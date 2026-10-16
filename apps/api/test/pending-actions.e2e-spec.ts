import { randomInt, randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { formatApplicationCode, formatOrderCode, pendingActionsResponseSchema } from '@biznexa/types';
import { z } from 'zod';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';

const sessionSchema = z.object({
  accessToken: z.string(),
  user: z.object({ id: z.string().uuid() }),
});

describe('Customer pending actions API (M5.8)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const runId = randomUUID().slice(0, 8);
  const runNumber = randomInt(1_000_000, 10_000_000);
  const mobileRun = randomInt(100_000, 1_000_000);
  const userIds: string[] = [];
  const applicationIds: string[] = [];
  const orderIds: string[] = [];
  let serviceId: string;
  let aliceToken: string;
  let bobToken: string;
  let newCustomerToken: string;
  let aliceAppId: string;
  let bobAppId: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  async function register(label: string, index: number) {
    const response = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        name: `Pending ${label} ${runId}`,
        mobile: `7${mobileRun}${String(index).padStart(3, '0')}`,
        email: `pending-${label}-${runId}@example.com`,
        password: 'Password123!',
        consent: true,
      })
      .expect(201);
    const session = sessionSchema.parse(response.body);
    userIds.push(session.user.id);
    return { token: session.accessToken, id: session.user.id };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
    await app.init();
    prisma = app.get(PrismaService);

    const alice = await register('alice', 1);
    const bob = await register('bob', 2);
    const newCustomer = await register('new', 3);
    const adminRole = await prisma.role.findUniqueOrThrow({ where: { key: 'ADMIN' }, select: { id: true } });
    const staff = await prisma.user.create({
      data: {
        name: `Pending Staff ${runId}`,
        email: `pending-staff-${runId}@example.com`,
        roles: { create: { roleId: adminRole.id } },
      },
      select: { id: true },
    });
    userIds.push(staff.id);
    aliceToken = alice.token;
    bobToken = bob.token;
    newCustomerToken = newCustomer.token;

    const category = await prisma.category.findUniqueOrThrow({ where: { slug: 'licenses' } });
    const service = await prisma.service.create({
      data: {
        slug: `e2e-pending-${runId}`,
        categoryId: category.id,
        name: `Pending Actions Test ${runId}`,
        shortDescription: 'Service for the pending actions endpoint test.',
        packages: { create: [{ name: 'Standard', professionalFee: 100_000 }] },
        documents: {
          create: [
            { name: 'PAN card', isMandatory: true, sortOrder: 1 },
            { name: 'Address proof', isMandatory: true, sortOrder: 2 },
            { name: 'Identity proof', isMandatory: true, sortOrder: 3 },
          ],
        },
      },
      select: { id: true, packages: { select: { id: true } }, documents: { select: { id: true }, orderBy: { sortOrder: 'asc' } } },
    });
    serviceId = service.id;
    const packageId = service.packages[0].id;
    const [panRequirementId, addressRequirementId, identityRequirementId] = service.documents.map((document) => document.id);

    const order = await prisma.order.create({
      data: {
        code: formatOrderCode(runNumber),
        customerId: alice.id,
        subtotal: 100_000,
        total: 118_000,
        amountPaid: 50_000,
        status: 'PARTIALLY_PAID',
      },
      select: { id: true },
    });
    orderIds.push(order.id);

    async function createApplication(customerId: string, sequence: number, orderId?: string) {
      const created = await prisma.application.create({
        data: {
          code: formatApplicationCode(sequence),
          customerId,
          serviceId,
          packageId,
          orderId,
          status: 'DRAFT',
        },
        select: { id: true },
      });
      applicationIds.push(created.id);
      return created.id;
    }

    aliceAppId = await createApplication(alice.id, runNumber, order.id);
    bobAppId = await createApplication(bob.id, runNumber + 1);

    const rejectedFileKey = `pending-rejected-${runId}`;
    await prisma.storedFile.create({
      data: {
        fileKey: rejectedFileKey,
        ownerId: alice.id,
        requirementId: addressRequirementId,
        originalName: 'address-proof.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1_024,
        sha256: randomUUID().replaceAll('-', ''),
        scanStatus: 'CLEAN',
      },
    });
    await prisma.applicationDocument.create({
      data: {
        applicationId: aliceAppId,
        requirementId: addressRequirementId,
        name: 'Address proof',
        fileKey: rejectedFileKey,
        fileName: 'address-proof.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1_024,
        status: 'REJECTED',
        rejectionReason: 'The address is not readable.',
        uploadedAt: new Date(),
      },
    });

    const infectedFileKey = `pending-infected-${runId}`;
    await prisma.storedFile.create({
      data: {
        fileKey: infectedFileKey,
        ownerId: alice.id,
        requirementId: identityRequirementId,
        originalName: 'identity-proof.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1_024,
        sha256: randomUUID().replaceAll('-', ''),
        scanStatus: 'INFECTED',
      },
    });
    await prisma.applicationDocument.create({
      data: {
        applicationId: aliceAppId,
        requirementId: identityRequirementId,
        name: 'Identity proof',
        fileKey: infectedFileKey,
        fileName: 'identity-proof.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1_024,
        status: 'UPLOADED',
        uploadedAt: new Date(),
      },
    });

    await prisma.applicationDocument.create({
      data: {
        applicationId: aliceAppId,
        requestId: randomUUID(),
        name: 'Recent bank statement',
        description: 'Please provide a recent statement.',
        status: 'REQUIRED',
        version: 1,
      },
    });

    const conversation = await prisma.conversation.create({
      data: { applicationId: aliceAppId },
      select: { id: true },
    });
    await prisma.message.create({
      data: { conversationId: conversation.id, senderId: staff.id, body: 'Please review the updated application.' },
    });

    // Bob has a separate missing document; his response must contain only his application.
    expect(panRequirementId).toBeTruthy();
  });

  afterAll(async () => {
    try {
      if (applicationIds.length) {
        await prisma.conversation.deleteMany({ where: { applicationId: { in: applicationIds } } });
        await prisma.applicationDocument.deleteMany({ where: { applicationId: { in: applicationIds } } });
        await prisma.application.deleteMany({ where: { id: { in: applicationIds } } });
      }
      if (orderIds.length) await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
      if (userIds.length) await prisma.storedFile.deleteMany({ where: { ownerId: { in: userIds } } });
      if (serviceId) await prisma.service.deleteMany({ where: { id: serviceId } });
      if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    } finally {
      await app.close();
    }
  });

  it('requires a token and returns only the signed-in customer’s actions', async () => {
    await request(app.getHttpServer()).get('/api/pending-actions').expect(401);

    const aliceResponse = await request(app.getHttpServer()).get('/api/pending-actions').set(auth(aliceToken)).expect(200);
    const aliceResult = pendingActionsResponseSchema.parse(aliceResponse.body);
    expect(aliceResult.items.map((item) => item.kind).sort()).toEqual([
      'pay_balance',
      'read_message',
      'reupload_document',
      'reupload_document',
      'upload_document',
      'upload_document',
    ]);
    expect(aliceResult.items.every((item) => item.applicationId === aliceAppId && item.applicationCode === formatApplicationCode(runNumber))).toBe(true);
    expect(aliceResult.items.some((item) => item.title === 'Upload Recent bank statement' && item.kind === 'upload_document')).toBe(true);
    expect(aliceResult.items.find((item) => item.kind === 'pay_balance')?.href).toBe(`/dashboard/applications/${aliceAppId}?tab=payments`);
    expect(aliceResult.items.find((item) => item.kind === 'read_message')?.href).toBe(`/dashboard/applications/${aliceAppId}?tab=messages`);
    expect(aliceResult.items.filter((item) => item.kind === 'reupload_document').map((item) => item.title)).toEqual([
      'Re-upload Address proof',
      'Re-upload Identity proof',
    ]);

    const bobResponse = await request(app.getHttpServer()).get('/api/pending-actions').set(auth(bobToken)).expect(200);
    const bobResult = pendingActionsResponseSchema.parse(bobResponse.body);
    expect(bobResult.items).toHaveLength(3);
    expect(bobResult.items.every((item) => item.kind === 'upload_document' && item.applicationId === bobAppId)).toBe(true);
    expect(bobResult.items.some((item) => item.applicationId === aliceAppId)).toBe(false);
  });

  it('returns an empty list for a new customer', async () => {
    const response = await request(app.getHttpServer()).get('/api/pending-actions').set(auth(newCustomerToken)).expect(200);
    expect(pendingActionsResponseSchema.parse(response.body)).toEqual({ items: [] });
  });
});
