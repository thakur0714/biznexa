import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { staffSession } from './staff';

let app: NestExpressApplication;
let http: ReturnType<typeof request>;
let prisma: PrismaService;
let admin: string;
let ops: string;

const run = `${Date.now().toString().slice(-7)}${Math.floor(Math.random() * 100)}`;
const prefix = `E2E-CERT-${run}`;
const email = (n: number) => `e2e-cert-${run}-${n}@example.com`;
const as = (token: string) => ({ authorization: `Bearer ${token}` });

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
  await app.init();
  http = request(app.getHttpServer()) as unknown as ReturnType<typeof request>;
  prisma = app.get(PrismaService);
  admin = (await staffSession(http, prisma, 'ADMIN', email(1))).accessToken;
  ops = (await staffSession(http, prisma, 'OPERATIONS', email(2))).accessToken;
});

afterAll(async () => {
  const certs = await prisma.certificate.findMany({ where: { certificateNumber: { startsWith: prefix } }, select: { id: true } });
  const certIds = certs.map((c) => c.id);
  if (certIds.length) {
    await prisma.certificateLookup.deleteMany({ where: { certificateId: { in: certIds } } });
    await prisma.certificate.deleteMany({ where: { id: { in: certIds } } });
  }
  await prisma.certificationBody.deleteMany({ where: { name: { startsWith: prefix } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: `e2e-cert-${run}` } } });
  await app.close();
});

describe('admin certificates (M7.1)', () => {
  it('GET /api/admin/certificates/:id returns certificate detail with body name and lookup count', async () => {
    const body = await prisma.certificationBody.create({
      data: { name: `${prefix}-Body` },
    });

    const cert = await prisma.certificate.create({
      data: {
        certificateNumber: `${prefix}-001`,
        verificationId: `VERIFY${run}1`,
        type: 'ISO 9001:2015',
        organizationName: 'ACME Corp',
        issueDate: new Date('2026-01-01'),
        validFrom: new Date('2026-01-01'),
        validUntil: new Date('2029-01-01'),
        certificationBodyId: body.id,
      },
    });

    await prisma.certificateLookup.create({
      data: { certificateId: cert.id, query: cert.certificateNumber, method: 'NUMBER', found: true },
    });

    const res = await http.get(`/api/admin/certificates/${cert.id}`).set(as(admin)).expect(200);

    expect(res.body).toMatchObject({
      id: cert.id,
      certificateNumber: cert.certificateNumber,
      organizationName: 'ACME Corp',
      status: 'ACTIVE',
      certificationBody: { name: `${prefix}-Body` },
      _count: { lookups: 1 },
    });
  });

  it('GET /api/admin/certificates/:id returns 404 when missing', async () => {
    await http.get(`/api/admin/certificates/${randomUUID()}`).set(as(admin)).expect(404);
  });

  it('GET /api/admin/certificates/:id returns 403 for user without certificates.manage', async () => {
    await http.get(`/api/admin/certificates/${randomUUID()}`).set(as(ops)).expect(403);
  });
});
