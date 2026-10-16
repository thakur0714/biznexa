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

  const cat = await prisma.category.create({
    data: { name: `${prefix}-Cat`, slug: `${prefix.toLowerCase()}-cat` },
  });
  const svc = await prisma.service.create({
    data: {
      name: `${prefix}-Svc`,
      slug: `${prefix.toLowerCase()}-svc`,
      categoryId: cat.id,
      shortDescription: 'test desc',
    },
  });
  const pkg = await prisma.servicePackage.create({
    data: {
      serviceId: svc.id,
      name: 'Standard',
      professionalFee: 50000,
    },
  });

  servicePackageId = pkg.id;
  serviceId = svc.id;
  categoryId = cat.id;
});

let servicePackageId: string;
let serviceId: string;
let categoryId: string;

afterAll(async () => {
  const certs = await prisma.certificate.findMany({
    where: {
      OR: [
        { certificateNumber: { startsWith: prefix } },
        { certificationBody: { name: { startsWith: prefix } } },
        { organizationName: { contains: prefix } },
      ],
    },
    select: { id: true },
  });
  const certIds = certs.map((c) => c.id);
  if (certIds.length) {
    await prisma.certificateLookup.deleteMany({ where: { certificateId: { in: certIds } } });
    await prisma.certificate.deleteMany({ where: { id: { in: certIds } } });
  }

  await prisma.notification.deleteMany({ where: { user: { email: { contains: run } } } });

  await prisma.applicationDocument.deleteMany({ where: { application: { code: { startsWith: prefix } } } });
  await prisma.applicationStageHistory.deleteMany({ where: { application: { code: { startsWith: prefix } } } });
  await prisma.application.deleteMany({ where: { code: { startsWith: prefix } } });

  if (servicePackageId) await prisma.servicePackage.deleteMany({ where: { id: servicePackageId } });
  if (serviceId) await prisma.service.deleteMany({ where: { id: serviceId } });
  if (categoryId) await prisma.category.deleteMany({ where: { id: categoryId } });

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

  describe('issue certificate from application (M7.5)', () => {
    let appWithEntity: { id: string; code: string };
    let appNoEntity: { id: string; code: string };
    let certFromAppWithEntity: { id: string; certificateNumber: string };
    let certFromAppNoEntity: { id: string; certificateNumber: string };
    let certViaDirectAdminPost: { id: string; certificateNumber: string };
    let supportToken: string;

    beforeAll(async () => {
      supportToken = (await staffSession(http, prisma, 'SUPPORT', `cust-supp-${run}@example.com`)).accessToken;

      appWithEntity = await prisma.application.create({
        data: {
          code: `${prefix}-APP-ENT`,
          customerId: userA.id,
          serviceId,
          packageId: servicePackageId,
          businessEntityId: entityA.id,
          status: 'COMPLETED',
        },
      });

      appNoEntity = await prisma.application.create({
        data: {
          code: `${prefix}-APP-NOENT`,
          customerId: userA.id,
          serviceId,
          packageId: servicePackageId,
          status: 'DELIVERED',
        },
      });
    });

    it('permission checks: 401 without token, 403 for customer, 403 for staff without PERMS.CERTIFICATES_MANAGE', async () => {
      const payload = {
        type: 'ISO 9001:2015',
        certificationBodyId: testBody.id,
        issueDate: '2026-01-01T00:00:00.000Z',
        validFrom: '2026-01-01T00:00:00.000Z',
        validUntil: '2029-01-01T00:00:00.000Z',
      };

      // 401 unauthenticated
      await http.post(`/api/admin/applications/${appWithEntity.id}/certificate`).send(payload).expect(401);

      // 403 customer
      await http
        .post(`/api/admin/applications/${appWithEntity.id}/certificate`)
        .set(as(userA.token))
        .send(payload)
        .expect(403);

      // 403 support staff without certificates.manage permission
      await http
        .post(`/api/admin/applications/${appWithEntity.id}/certificate`)
        .set(as(supportToken))
        .send(payload)
        .expect(403);
    });

    it('refuses an application that is not completed or delivered (409)', async () => {
      const draft = await prisma.application.create({
        data: { code: `${prefix}-APP-WIP`, customerId: userA.id, serviceId, packageId: servicePackageId, status: 'IN_PROGRESS' },
      });
      await http
        .post(`/api/admin/applications/${draft.id}/certificate`)
        .set(as(admin))
        .send({ type: 'ISO 9001', certificationBodyId: testBody.id, issueDate: '2026-01-01T00:00:00.000Z', validFrom: '2026-01-01T00:00:00.000Z', validUntil: '2029-01-01T00:00:00.000Z' })
        .expect(409);
    });

    it('admin creates certificate from application with prefilled org name and business entity', async () => {
      const res = await http
        .post(`/api/admin/applications/${appWithEntity.id}/certificate`)
        .set(as(admin))
        .send({
          type: 'ISO 9001:2015 — Quality Management System',
          certificationBodyId: testBody.id,
          issueDate: '2026-01-01T00:00:00.000Z',
          validFrom: '2026-01-01T00:00:00.000Z',
          validUntil: '2029-01-01T00:00:00.000Z',
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.applicationId).toBe(appWithEntity.id);
      expect(res.body.businessEntityId).toBe(entityA.id);
      expect(res.body.organizationName).toBe(`${prefix} Acme Pvt Ltd`);
      expect(res.body.status).toBe('ACTIVE');

      certFromAppWithEntity = { id: res.body.id, certificateNumber: res.body.certificateNumber };
    });

    it('admin creates certificate from application without entity (prefilled from customer name)', async () => {
      const res = await http
        .post(`/api/admin/applications/${appNoEntity.id}/certificate`)
        .set(as(admin))
        .send({
          type: 'ISO 27001:2022 — Information Security',
          certificationBodyId: testBody.id,
          issueDate: '2026-02-01T00:00:00.000Z',
          validFrom: '2026-02-01T00:00:00.000Z',
          validUntil: '2029-02-01T00:00:00.000Z',
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.applicationId).toBe(appNoEntity.id);
      expect(res.body.businessEntityId).toBeNull();
      expect(res.body.organizationName).toBe('Cust Cert User 1');

      certFromAppNoEntity = { id: res.body.id, certificateNumber: res.body.certificateNumber };
    });

    it('POST /api/admin/certificates with applicationId also prefills and stores links', async () => {
      const res = await http
        .post('/api/admin/certificates')
        .set(as(admin))
        .send({
          type: 'ISO 14001:2015 — Environmental Management',
          applicationId: appWithEntity.id,
          certificationBodyId: testBody.id,
          issueDate: '2026-03-01T00:00:00.000Z',
          validFrom: '2026-03-01T00:00:00.000Z',
          validUntil: '2029-03-01T00:00:00.000Z',
        });

      expect(res.status).toBe(201);
      expect(res.body.applicationId).toBe(appWithEntity.id);
      expect(res.body.businessEntityId).toBe(entityA.id);
      expect(res.body.organizationName).toBe(`${prefix} Acme Pvt Ltd`);

      certViaDirectAdminPost = { id: res.body.id, certificateNumber: res.body.certificateNumber };
    });

    it('customer A sees all certificates linked to their applications in GET /api/certificates', async () => {
      const res = await http.get('/api/certificates').set(as(userA.token)).expect(200);
      const items = res.body.items as Array<{ id: string; certificateNumber: string; applicationId?: string | null }>;
      const certIds = items.map((c) => c.id);

      expect(certIds).toContain(certFromAppWithEntity.id);
      expect(certIds).toContain(certFromAppNoEntity.id);
      expect(certIds).toContain(certViaDirectAdminPost.id);

      // Can also view details
      const detail1 = await http.get(`/api/certificates/${certFromAppWithEntity.id}`).set(as(userA.token)).expect(200);
      expect(detail1.body.applicationId).toBe(appWithEntity.id);

      const detail2 = await http.get(`/api/certificates/${certFromAppNoEntity.id}`).set(as(userA.token)).expect(200);
      expect(detail2.body.applicationId).toBe(appNoEntity.id);
    });

    it('customer B does NOT see customer A application-linked certificates (never matched by org name)', async () => {
      const list = await http.get('/api/certificates').set(as(userB.token)).expect(200);
      const ids = (list.body.items as { id: string }[]).map((c) => c.id);

      expect(ids).not.toContain(certFromAppWithEntity.id);
      expect(ids).not.toContain(certFromAppNoEntity.id);
      expect(ids).not.toContain(certViaDirectAdminPost.id);

      // Attempting direct access to any of customer A's certificates yields 404
      await http.get(`/api/certificates/${certFromAppWithEntity.id}`).set(as(userB.token)).expect(404);
      await http.get(`/api/certificates/${certFromAppNoEntity.id}`).set(as(userB.token)).expect(404);
      await http.get(`/api/certificates/${certViaDirectAdminPost.id}`).set(as(userB.token)).expect(404);
    });
  });
});
