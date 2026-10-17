import { randomInt, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { staffSession } from './staff';

const registerSchema = z.object({ accessToken: z.string() });

describe('Featured consultants (Public & Admin API)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const runId = randomUUID();
  const userIds: string[] = [];
  const consultantIds: string[] = [];
  const http = () => request(app.getHttpServer());

  let adminSession: { Authorization: string };

  async function makeConsultant(label: string, status: 'APPROVED' | 'PENDING', isFeatured: boolean = false) {
    const email = `featured-${runId}-${label}@example.com`;
    await http().post('/api/auth/register').send({
      name: `${label} consultant`, email,
      mobile: `7${randomInt(100_000_000, 1_000_000_000)}`,
      password: 'Customer@12345', consent: true,
    }).expect(201).then((response) => registerSchema.parse(response.body));
    const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
    userIds.push(user.id);
    const consultant = await prisma.consultant.create({
      data: {
        userId: user.id, slug: `featured-${runId}-${label}`, category: 'CA',
        qualification: 'Verified qualification', experienceYears: 10,
        expertise: ['Tax'], languages: ['English'], city: 'Pune', state: 'Maharashtra',
        area: 'Kothrud', feePerSession: 150_000, consultationTypes: ['AUDIO', 'VIDEO'],
        rating: 5, reviewCount: 10, verificationStatus: status, isFeatured,
        minNoticeMinutes: 0,
      },
      select: { id: true },
    });
    consultantIds.push(consultant.id);
    return consultant.id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
    await app.init();
    prisma = app.get(PrismaService);
    const http = () => request(app.getHttpServer());
    const session = await staffSession(http(), prisma, 'ADMIN', `admin-featured-${runId}@example.com`);
    adminSession = { Authorization: `Bearer ${session.accessToken}` };
  });

  afterAll(async () => {
    try {
      if (consultantIds.length) await prisma.consultant.deleteMany({ where: { id: { in: consultantIds } } });
      if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    } finally {
      await app.close();
    }
  });

  it('admin can set featured on APPROVED consultant', async () => {
    const approvedId = await makeConsultant('approved-for-featured', 'APPROVED', false);

    // Set featured
    await http()
      .patch(`/api/admin/consultants/${approvedId}/featured`)
      .set(adminSession)
      .send({ isFeatured: true })
      .expect(200);

    // Verify in db
    const updated = await prisma.consultant.findUnique({ where: { id: approvedId } });
    expect(updated?.isFeatured).toBe(true);

    // Un-feature
    await http()
      .patch(`/api/admin/consultants/${approvedId}/featured`)
      .set(adminSession)
      .send({ isFeatured: false })
      .expect(200);

    const unfeatured = await prisma.consultant.findUnique({ where: { id: approvedId } });
    expect(unfeatured?.isFeatured).toBe(false);
  });

  it('admin cannot set featured on PENDING consultant', async () => {
    const pendingId = await makeConsultant('pending-for-featured', 'PENDING', false);

    await http()
      .patch(`/api/admin/consultants/${pendingId}/featured`)
      .set(adminSession)
      .send({ isFeatured: true })
      .expect(409); // Conflict
  });

  it('public directory correctly filters by featured', async () => {
    await makeConsultant('public-featured-1', 'APPROVED', true);
    await makeConsultant('public-not-featured-1', 'APPROVED', false);

    const resFeatured = await http()
      .get(`/api/public/consultants?featured=true`)
      .expect(200);

    const featuredNames = resFeatured.body.items.map((item: { name: string }) => item.name);
    expect(featuredNames).toContain('public-featured-1 consultant');
    expect(featuredNames).not.toContain('public-not-featured-1 consultant');

    const resNotFeatured = await http()
      .get(`/api/public/consultants?featured=false`)
      .expect(200);

    const notFeaturedNames = resNotFeatured.body.items.map((item: { name: string }) => item.name);
    expect(notFeaturedNames).not.toContain('public-featured-1 consultant');
    expect(notFeaturedNames).toContain('public-not-featured-1 consultant');
  });
});
