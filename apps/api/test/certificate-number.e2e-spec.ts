import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { staffSession } from './staff';

describe('Certificate number generation', () => {
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;
  let prisma: PrismaService;
  let token: string;
  let bodyId: string;

  const run = Date.now().toString().slice(-7) + Math.floor(Math.random() * 900 + 100);
  const email = `cert-num-${run}@example.com`;
  const prefix = `BNC-${new Date().getFullYear()}-`;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    http = request(app.getHttpServer());
    prisma = app.get(PrismaService);

    token = (await staffSession(http, prisma, 'ADMIN', email)).accessToken;
    bodyId = (await prisma.certificationBody.create({ data: { name: `Cert Number Body ${run}` } })).id;
  });

  afterAll(async () => {
    await prisma.certificate.deleteMany({ where: { certificationBodyId: bodyId } });
    await prisma.certificationBody.delete({ where: { id: bodyId } });
    await prisma.user.deleteMany({ where: { email } });
    await app.close();
  });

  const issue = (n: number, certificateNumber?: string) =>
    http
      .post('/api/admin/certificates')
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'ISO 9001',
        organizationName: `Cert Number Org ${run}-${n}`,
        issueDate: '2026-01-01',
        validFrom: '2026-01-01',
        validUntil: '2029-01-01',
        certificationBodyId: bodyId,
        ...(certificateNumber ? { certificateNumber } : {}),
      });

  const seq = (n: string) => Number(n.slice(prefix.length));

  it('continues after the highest number even when an older certificate was deleted', async () => {
    const a = (await issue(1).expect(201)).body;
    const b = (await issue(2).expect(201)).body;
    expect(seq(b.certificateNumber)).toBeGreaterThan(seq(a.certificateNumber));

    await prisma.certificate.delete({ where: { id: a.id } });
    const c = (await issue(3).expect(201)).body;
    expect(c.certificateNumber).toMatch(/^BNC-\d{4}-\d{6,}$/);
    expect(seq(c.certificateNumber)).toBeGreaterThan(seq(b.certificateNumber));
  });

  it('ignores hand-typed numbers that are not numeric', async () => {
    await issue(4, `${prefix}X${run}`).expect(201);
    const next = (await issue(5).expect(201)).body;
    expect(next.certificateNumber).toMatch(/^BNC-\d{4}-\d{6,}$/);
  });

  it('gives distinct numbers to certificates issued at the same time', async () => {
    const responses = await Promise.all([6, 7, 8].map((n) => issue(n)));
    for (const r of responses) expect(r.status).toBe(201);
    expect(new Set(responses.map((r) => r.body.certificateNumber)).size).toBe(3);
  });
});
