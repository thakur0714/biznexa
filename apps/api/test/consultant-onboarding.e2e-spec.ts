import { randomInt, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { consultantApplicationInputSchema, consultantApplicationResponseSchema } from '@biznexa/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { StorageService } from '../src/files/storage.service';

const registerResponseSchema = z.object({ accessToken: z.string() });
const storedFileResponseSchema = z.object({ id: z.string().uuid() });

describe('Consultant onboarding API (M8.1)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let token: string;
  let otherToken: string;
  let crossToken: string;
  let userId: string;
  const userIds: string[] = [];
  const runId = randomUUID().slice(0, 8);
  const mobileRun = randomInt(100_000, 1_000_000);
  const fileIds: string[] = [];
  const otherFileIds: string[] = [];
  const as = (accessToken: string) => ({ authorization: `Bearer ${accessToken}` });

  async function register(label: string, index: number) {
    const response = await request(app.getHttpServer()).post('/api/auth/register').send({
      name: `Consultant ${label} ${runId}`,
      email: `consultant-apply-${label}-${runId}@example.com`,
      mobile: `7${mobileRun}${String(index).padStart(3, '0')}`,
      password: 'Password123!',
      consent: true,
    }).expect(201);
    const id = await prisma.user.findUniqueOrThrow({ where: { email: `consultant-apply-${label}-${runId}@example.com` }, select: { id: true } });
    userIds.push(id.id);
    return { token: registerResponseSchema.parse(response.body).accessToken, id: id.id };
  }

  async function upload(accessToken: string, label: string): Promise<string> {
    const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(512, 0x20)]);
    const response = await request(app.getHttpServer()).post('/api/files').set(as(accessToken)).attach('file', pdf, `${label}.pdf`).expect(201);
    return storedFileResponseSchema.parse(response.body).id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
    await app.init();
    prisma = app.get(PrismaService);
    const applicant = await register('applicant', 1);
    const other = await register('other', 2);
    const cross = await register('cross', 3);
    token = applicant.token;
    userId = applicant.id;
    otherToken = other.token;
    crossToken = cross.token;
  });

  afterAll(async () => {
    try {
      const files = await prisma.storedFile.findMany({ where: { ownerId: { in: userIds } }, select: { fileKey: true } });
      const storage = app.get(StorageService);
      await Promise.all(files.map(({ fileKey }) => storage.remove(fileKey).catch(() => undefined)));
      await prisma.consultant.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.storedFile.deleteMany({ where: { ownerId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    } finally {
      await app.close();
    }
  });

  it('requires sign-in, stores the profile and three private proof files as PENDING, and refuses a second application', async () => {
    await request(app.getHttpServer()).post('/api/consultants').send({}).expect(401);

    fileIds.push(
      await upload(token, 'qualification-proof'),
      await upload(token, 'membership-proof'),
      await upload(token, 'id-proof'),
    );
    const input = consultantApplicationInputSchema.parse({
      category: 'CA',
      qualification: 'Chartered Accountant',
      membershipNo: 'ICAI-12345',
      experienceYears: 8,
      expertise: ['GST', 'Company law'],
      languages: ['English', 'Hindi'],
      city: 'Ludhiana',
      state: 'Punjab',
      area: 'Civil Lines',
      bio: 'Business and tax advisor.',
      feePerSession: 150_000,
      consultationTypes: ['AUDIO', 'VIDEO'],
      documents: {
        qualificationProofId: fileIds[0],
        membershipProofId: fileIds[1],
        idProofId: fileIds[2],
      },
    });

    const response = await request(app.getHttpServer()).post('/api/consultants').set(as(token)).send(input).expect(201);
    const application = consultantApplicationResponseSchema.parse(response.body);
    expect(application.verificationStatus).toBe('PENDING');
    const consultant = await prisma.consultant.findUniqueOrThrow({
      where: { id: application.id },
      include: { documents: { orderBy: { kind: 'asc' } } },
    });
    expect(consultant).toMatchObject({ userId, category: 'CA', feePerSession: 150_000, verificationStatus: 'PENDING' });
    expect(consultant.documents.map((document) => document.fileId).sort((a, b) => a.localeCompare(b))).toEqual([...fileIds].sort((a, b) => a.localeCompare(b)));
    expect(await prisma.userRole.findFirst({ where: { userId, role: { key: 'CONSULTANT' } } })).toBeNull();

    await request(app.getHttpServer()).post('/api/consultants').set(as(token)).send(input).expect(409);
  });

  it('refuses proof files uploaded by a different user', async () => {
    otherFileIds.push(
      await upload(otherToken, 'other-qualification-proof'),
      await upload(otherToken, 'other-membership-proof'),
      await upload(otherToken, 'other-id-proof'),
    );
    const input = consultantApplicationInputSchema.parse({
      category: 'LAWYER',
      qualification: 'LLB',
      experienceYears: 5,
      expertise: ['Contracts'],
      languages: ['English'],
      city: 'Delhi',
      state: 'Delhi',
      feePerSession: 90_000,
      consultationTypes: ['CHAT'],
      documents: {
        qualificationProofId: otherFileIds[0],
        membershipProofId: otherFileIds[1],
        idProofId: otherFileIds[2],
      },
    });
    await request(app.getHttpServer()).post('/api/consultants').set(as(crossToken)).send(input).expect(400);
    expect(await prisma.consultant.findUnique({ where: { userId }, select: { id: true } })).not.toBeNull();
  });
});
