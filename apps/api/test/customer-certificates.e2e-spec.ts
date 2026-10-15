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

let userA: { token: string; id: string };
let userB: { token: string; id: string };
let admin: string;

const run = Date.now().toString().slice(-7);
const prefix = `CUST-CERT-${run}`;
const as = (token: string) => ({ authorization: `Bearer ${token}` });

async function registerUser(n: number) {
  const res = await http
    .post('/api/auth/register')
    .send({
      name: `Cust Cert User ${n}`,
      mobile: `8${run}${String(10 + n).padStart(2, '0')}`,
      email: `e2e-custcert-${run}-${n}@example.com`,
      password: 'secretPassword123!',
      consent: true,
    });
  if (res.status !== 201) {
    throw new Error(`Register failed with ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return { token: res.body.accessToken as string, id: res.body.user.id as string };
}

let testBody: { id: string; name: string };
let entityA: { id: string };

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
  await app.init();
  http = request(app.getHttpServer()) as unknown as ReturnType<typeof request>;
  prisma = app.get(PrismaService);

  userA = await registerUser(1);
  userB = await registerUser(2);

  admin = (await staffSession(http, prisma, 'ADMIN', `cust-admin-${run}@example.com`)).accessToken;

  testBody = await prisma.certificationBody.create({
    data: { name: `${prefix}-Body` },
  });

  entityA = await prisma.businessEntity.create({
    data: {
      ownerId: userA.id,
      legalName: `${prefix} Acme Pvt Ltd`,
      entityType: 'PRIVATE_LIMITED',
    },
  });
});

afterAll(async () => {
  const certs = await prisma.certificate.findMany({
    where: {
      OR: [
        { certificateNumber: { startsWith: prefix } },
        { certificationBody: { name: { startsWith: prefix } } },
      ],
    },
    select: { id: true },
  });
  const certIds = certs.map((c) => c.id);
  if (certIds.length) {
    await prisma.certificateLookup.deleteMany({ where: { certificateId: { in: certIds } } });
    await prisma.certificate.deleteMany({ where: { id: { in: certIds } } });
  }
  await prisma.businessEntity.deleteMany({ where: { legalName: { startsWith: prefix } } });
  await prisma.certificationBody.deleteMany({ where: { name: { startsWith: prefix } } });
  await prisma.user.deleteMany({ where: { email: { contains: run } } });
  await app.close();
});

describe('customer certificates page API (M7.6)', () => {
  let certA1: { id: string; certificateNumber: string };
  let certExpiring: { id: string; certificateNumber: string };
  let certB: { id: string; certificateNumber: string };

  it('sets up certificates for customer A (active + expiring soon) and customer B', async () => {
    // Cert A1: Active, valid for 2 years
    const c1 = await prisma.certificate.create({
      data: {
        certificateNumber: `${prefix}-A1`,
        verificationId: `V${run}A1`,
        type: 'ISO 9001:2015',
        organizationName: `${prefix} Acme Pvt Ltd`,
        issueDate: new Date('2026-01-01'),
        validFrom: new Date('2026-01-01'),
        validUntil: new Date(Date.now() + 365 * 24 * 3600 * 1000),
        certificationBodyId: testBody.id,
        businessEntityId: entityA.id,
      },
    });
    certA1 = { id: c1.id, certificateNumber: c1.certificateNumber };

    // Cert A2: Expiring in 15 days
    const c2 = await prisma.certificate.create({
      data: {
        certificateNumber: `${prefix}-EXP`,
        verificationId: `V${run}EXP`,
        type: 'ISO 27001:2022',
        organizationName: `${prefix} Acme Pvt Ltd`,
        issueDate: new Date('2023-01-01'),
        validFrom: new Date('2023-01-01'),
        validUntil: new Date(Date.now() + 15 * 24 * 3600 * 1000),
        certificationBodyId: testBody.id,
        businessEntityId: entityA.id,
      },
    });
    certExpiring = { id: c2.id, certificateNumber: c2.certificateNumber };

    // Cert B: Belongs to user B
    const entityB = await prisma.businessEntity.create({
      data: {
        ownerId: userB.id,
        legalName: `${prefix} Beta Ltd`,
        entityType: 'PRIVATE_LIMITED',
      },
    });
    const cb = await prisma.certificate.create({
      data: {
        certificateNumber: `${prefix}-B1`,
        verificationId: `V${run}B1`,
        type: 'ISO 14001:2015',
        organizationName: `${prefix} Beta Ltd`,
        issueDate: new Date('2026-01-01'),
        validFrom: new Date('2026-01-01'),
        validUntil: new Date(Date.now() + 365 * 24 * 3600 * 1000),
        certificationBodyId: testBody.id,
        businessEntityId: entityB.id,
      },
    });
    certB = { id: cb.id, certificateNumber: cb.certificateNumber };
  });

  it('GET /api/certificates returns only customer A certificates with expiry flags and QR', async () => {
    const res = await http.get('/api/certificates').set(as(userA.token));
    expect(res.status).toBe(200);

    const items = res.body.items as Array<{
      certificateNumber: string;
      isExpiringSoon: boolean;
      daysUntilExpiry: number;
      qrUrl: string;
      qrDataUrl: string;
    }>;
    const certNums = items.map((c) => c.certificateNumber);

    expect(certNums).toContain(certA1.certificateNumber);
    expect(certNums).toContain(certExpiring.certificateNumber);
    expect(certNums).not.toContain(certB.certificateNumber);

    const expiringItem = items.find((c) => c.certificateNumber === certExpiring.certificateNumber);
    expect(expiringItem?.isExpiringSoon).toBe(true);
    expect(expiringItem?.daysUntilExpiry).toBeLessThanOrEqual(30);
    expect(expiringItem?.daysUntilExpiry).toBeGreaterThan(0);
    expect(expiringItem?.qrUrl).toContain(`/verify/`);
    expect(expiringItem?.qrDataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it('GET /api/certificates/:id returns certificate detail for owner, 404 for other customer', async () => {
    const resA = await http.get(`/api/certificates/${certA1.id}`).set(as(userA.token));
    expect(resA.status).toBe(200);
    expect(resA.body.certificateNumber).toBe(certA1.certificateNumber);
    expect(resA.body.certificationBody.name).toBe(testBody.name);

    const resB = await http.get(`/api/certificates/${certA1.id}`).set(as(userB.token));
    expect(resB.status).toBe(404);
  });

  it('naming a business entity like someone else\'s company does not reveal their certificates', async () => {
    await prisma.businessEntity.create({
      data: { ownerId: userB.id, legalName: `${prefix} Acme Pvt Ltd`, entityType: 'PRIVATE_LIMITED' },
    });

    const list = await http.get('/api/certificates').set(as(userB.token)).expect(200);
    const ids = (list.body.items as { id: string }[]).map((c) => c.id);
    expect(ids).not.toContain(certA1.id);
    await http.get(`/api/certificates/${certA1.id}`).set(as(userB.token)).expect(404);
    await http.post(`/api/certificates/${certA1.id}/link`).set(as(userB.token)).expect(404);
  });

  it('GET /api/certificates requires authentication (401 without token)', async () => {
    const res = await http.get('/api/certificates');
    expect(res.status).toBe(401);
  });
});
